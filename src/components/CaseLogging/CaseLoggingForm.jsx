import { useState, useEffect, useRef } from 'react';
import { vmm } from '../../api/vmm';
import { useAuth } from '../../context/AuthContext';

const ATTACHMENT_MANDATORY = ['Breakdown', 'Repair'];

// The VMM complaint workflow, shown step by step below Source of Complaint
// Verify + Employee are combined into one step because they use the same search.
const COMPLAINT_STEPS = [
  { name: 'Verify & Employee', sub: 'Employee code, store code or mobile' },
  { name: 'Category',       sub: 'Select the category' },
  { name: 'Product',        sub: 'Select specific item' },
  { name: 'Complaint',      sub: 'Nature of issue' },
  { name: 'Warranty',       sub: 'AMC/Warranty status' },
  { name: 'Vendor',         sub: 'Brand or vendor name' },
  { name: 'Location',       sub: 'Where in the store?' },
  { name: 'Photos',         sub: 'Photos / files' },
  { name: 'Remarks',        sub: 'Describe the problem' },
  { name: 'Review',         sub: 'Check & submit' },
];

// Products whose AMC vendor varies by store — auto-fetched via the AC-AMC / Lift-AMC webhooks
const AMC_LOOKUP_PRODUCTS = new Set(['ac', 'server room ac', 'lift', 'escalator']);

// Products with one fixed, known vendor — no per-store lookup needed
const FIXED_VENDOR_PRODUCTS = { sensormatic: 'Adtech' };
const getFixedVendor = (name) => FIXED_VENDOR_PRODUCTS[norm(name)] || null;

// Products routed straight to Facility Manager / HO Team — no vendor needed
const HO_DIRECT_PRODUCTS = new Set([
  'acp', 'baggage rack', 'carpet', 'cash drawer', 'cctv', 'chair', 'civil work',
  'diesel motor', 'digital video recorder', 'door', 'drainage', 'drawer',
  'electrical', 'emergency bulb', 'exhaust fan', 'fan', 'fire equipment', 'fire hydrant',
  'fly catcher', 'genset battery', 'glass', 'glass door', 'glow sign board', 'lift battery',
  'lights', 'lock', 'mirror', 'mobile', 'music system', 'paint work',
  'queue manager', 'railing', 'ramp', 'shutter', 'speaker', 'submersible pump',
  'table', 'tiles', 'transformer', 'trial room', 'trolley', 'washroom',
  'water meter', 'water motor', 'water pipe', 'water tank', 'wooden work',
]);

// Products where vendor is optional — agent checks a sticker on the unit
const FIRE_PRODUCTS = new Set([
  'fire alarm', 'fire exit door', 'fire exit key box', 'fire extinguisher',
  'fire hooter', 'fire panel', 'fire alarm panel', 'fire pump',
  'fire sprinkler', 'sprinkler system', 'fire water motor', 'fire water tank',
  'hose reel', 'smoke detector',
]);

// Warranty brand lists — same product→brand mapping used by the facility portal.
const WARRANTY_VENDORS = [
  'Adtech', 'Ahuja', 'Arihant Infocoom', 'Blue Star', 'Carrier', 'Consul Neowatt',
  'Ece', 'Euronics', 'Fuji Tech', 'Godrej', 'Gunnebo', 'Hitachi', 'Hublit',
  'Jindal Electric', 'Johnson', 'Kirloskar', 'Kone', 'Krykard Atandra', 'Mitsubishi',
  'Mitzvah', 'Neptune', 'Omega', 'Otis Elevator', 'Pie Industries', 'Schindler',
  'Tk Elevator', 'Viewon', 'Western Control And Automation',
];

const PRODUCT_VENDORS = {
  'ac':                        ['Blue Star', 'Carrier', 'Hitachi', 'Mitsubishi'],
  'air curtain':               ['Euronics', 'Mitzvah'],
  'amplifier':                 ['Ahuja', 'Arihant Infocoom'],
  'drainage':                  ['Adtech'],
  'electrical panel':          ['Neptune', 'Western Control And Automation'],
  'escalator':                 ['Ece', 'Kone'],
  'fly catcher':               ['Mitzvah'],
  'genset':                    ['Kirloskar'],
  'led light':                 ['Hublit', 'Viewon'],
  'lift':                      ['Ece', 'Fuji Tech', 'Johnson', 'Kone', 'Omega', 'Otis Elevator', 'Schindler', 'Tk Elevator'],
  'mic':                       ['Ahuja', 'Arihant Infocoom'],
  'safe lock':                 ['Godrej', 'Gunnebo'],
  'sensormatic':               ['Adtech'],
  'server room ac':            ['Blue Star', 'Carrier', 'Hitachi', 'Mitsubishi'],
  'servo':                     ['Consul Neowatt', 'Krykard Atandra', 'Jindal Electric'],
  'shampoo dispenser machine': ['Pie Industries'],
  'track light':               ['Hublit', 'Viewon'],
};

function norm(s) { return (s || '').trim().toLowerCase(); }
const getVendorsForProduct = (name) => PRODUCT_VENDORS[norm(name)] || WARRANTY_VENDORS;
const isAmcLookupProduct = (name) => AMC_LOOKUP_PRODUCTS.has(norm(name));
const isHoDirectProduct  = (name) => HO_DIRECT_PRODUCTS.has(norm(name));
const isFireProductName  = (name) => FIRE_PRODUCTS.has(norm(name));
const isGensetProduct    = (name) => norm(name) === 'genset';

// Portal rule: temperature nature applies only to AC/Server Room AC.
const TEMP_PRODUCTS = new Set(['ac', 'server room ac']);
const showsTemperatureOption = (name) => TEMP_PRODUCTS.has(norm(name));
const isTemperatureNature = (name) => norm(name).includes('temperature');

// Portal routing after the Complaint step — these products skip the normal
// Warranty/Vendor path (same as confirmComplaintType() in index (47).html).
function getAutoWarranty(name) {
  if (getFixedVendor(name))   return 'N/A — Fixed Vendor';
  if (isHoDirectProduct(name)) return 'N/A — HO Direct';
  if (isGensetProduct(name))   return 'N/A — Genset';
  if (isFireProductName(name)) return 'N/A — Local Vendor';
  return '';
}
const isAutoRoutedProduct = (name) => !!getAutoWarranty(name);
const isVendorOwnedProduct = (name) => isAutoRoutedProduct(name) || isAmcLookupProduct(name);
const AUTO_WARRANTY_VALUES = new Set([
  'N/A — Fixed Vendor', 'N/A — HO Direct', 'N/A — Genset', 'N/A — Local Vendor',
]);

function bufStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data))
    return new TextDecoder().decode(new Uint8Array(v.data));
  return String(v);
}

// The PHP API uses snake_case column names while older helpers used camelCase.
// Accept either so every detail fills regardless of the response shape.
function pick(obj, ...keys) {
  for (const k of keys) {
    const v = bufStr(obj?.[k]);
    if (v) return v;
  }
  return '';
}

function ProductSearch({ products, value, onChange, error, disabled }) {
  const [query,    setQuery]    = useState(value || '');
  const [open,     setOpen]     = useState(false);
  const [focused,  setFocused]  = useState(false);
  const wrapRef = useRef(null);

  // Portal product search matches product names only. SQL has one row per
  // vendor, so collapse to one entry per product name as the HTML list does.
  const matched = query.trim().length > 0
    ? products.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
    : products;

  const seen = new Set();
  const filtered = [];
  for (const p of matched) {
    const key = norm(p.name);
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push(p);
  }

  useEffect(() => {
    if (!focused) setQuery(value || '');
  }, [value, focused]);

  useEffect(() => {
    const handler = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (product) => {
    setQuery(product.name);
    setOpen(false);
    setFocused(false);
    onChange(product);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        className={error ? 'err' : ''}
        placeholder={disabled ? 'Loading…' : 'Type to search product…'}
        value={query}
        disabled={disabled}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setFocused(true); setOpen(true); }}
        onBlur={() => setFocused(false)}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="product-dropdown">
          {filtered.slice(0, 30).map((p, i) => (
            <div key={i} className="product-option" onMouseDown={() => select(p)}>
              <span className="product-option-name">{p.name}</span>
              <span className="product-option-vendor">{isAmcLookupProduct(p.name) ? 'AMC vendor by store' : (p.category || '—')}</span>
            </div>
          ))}
        </div>
      )}
      {open && query.trim().length > 0 && filtered.length === 0 && (
        <div className="product-dropdown">
          <div className="product-option-empty">No products found for "{query}"</div>
        </div>
      )}
    </div>
  );
}

function WorkflowStep({ n, title, sub, wide, children }) {
  return (
    <div className={`wf-field ${wide ? 'wf-wide' : ''}`}>
      <div className="wf-label">
        <span className="wf-num">{n}</span>
        <span className="wf-label-text">
          <span className="wf-title">{title}</span>
          <span className="wf-sub">{sub}</span>
        </span>
      </div>
      <div className="wf-control">{children}</div>
    </div>
  );
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date) {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const emptyWf = { category: '', warranty: '', vendorQuery: '', vendorFreeText: '', noneBrand: '' };

const emptyForm = {
  storeCode: '', storeName: '', storeEmail: '', smEmail: '', fmEmail: '', hoEmail: '', vendorEmail: '', contractType: '', city: '', region: '', state: '', zone: '',
  fmName: '', managerName: '', managerMobile: '',
  asmName: '', asmMobile: '',
  employeeCode: '', employeeName: '', contactNumber: '', designation: '',
  productName: '', productShortName: '', vendorName: '', productType: '',
  natureOfComplaint: '', complaintType: '', tatDays: '',
  productLocation: '', remarks: '', attachments: [],
  source: '', emailSubject: '', callTxnId: '',
};

export default function CaseLoggingForm() {
  const { currentUser } = useAuth();
  const [form, setForm]           = useState(emptyForm);
  const [errors, setErrors]       = useState({});
  const [storeErr, setStoreErr]   = useState('');
  const [memberErr, setMemberErr] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState('');
  const [result, setResult]       = useState(null);
  const [noImage,   setNoImage]   = useState(false);
  const [quantity,  setQuantity]  = useState(1);
  const [unitLocations,    setUnitLocations]    = useState([]);
  const [unitNatures,      setUnitNatures]      = useState([]);
  const [results,          setResults]          = useState([]);
  const [recentComplaints, setRecentComplaints] = useState([]);
  const [loadingRecent,    setLoadingRecent]    = useState(false);
  const [autoFillNote,     setAutoFillNote]     = useState('');
  const [warrantyQty,      setWarrantyQty]      = useState(0);
  const [warrantyVendor,   setWarrantyVendor]   = useState('');
  const [showConfirm,      setShowConfirm]      = useState(false);
  const [amcStatus,        setAmcStatus]        = useState('idle'); // idle|loading|found|not-applicable|error
  const [gensetChoice,     setGensetChoice]     = useState('');
  const [resolvedTo,       setResolvedTo]       = useState([]);
  const [resolvedCc,       setResolvedCc]       = useState([]);
  const [extraTo,          setExtraTo]          = useState('');
  const [extraCc,          setExtraCc]          = useState('');
  const [polishing,        setPolishing]        = useState(false);
  const amcLookupKeyRef = useRef('');
  const amcRequestIdRef = useRef(0);

  const [products, setProducts]   = useState([]);
  const [natures, setNatures]     = useState([]);
  const [loadingRef, setLoadingRef] = useState(true);
  const [refError, setRefError]   = useState('');
  const lookupTimer = useRef(null);

  // One smart search accepts employee code, store code or mobile number
  const [lookupQuery, setLookupQuery]     = useState('');
  const [lookupMsg, setLookupMsg]         = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [wf, setWf] = useState(emptyWf);

  // Mirrors used by async lookups so they can see the latest warranty/product
  // selection even if the user changes it while a network request is in flight.
  const formRef = useRef(form);
  formRef.current = form;
  const wfRef = useRef(wf);
  wfRef.current = wf;
  const isPortalAmcActive = (product = formRef.current.productName) =>
    wfRef.current.warranty === 'Under AMC' && isAmcLookupProduct(product);

  const today = new Date();
  const edc   = form.tatDays ? addDays(today, Number(form.tatDays)) : null;

  // Dropdowns are driven entirely by the live SQL reference data.
  useEffect(() => {
    Promise.all([vmm.getProducts(), vmm.getNatures()])
      .then(([pRes, nRes]) => {
        setProducts(pRes.products || []);
        setNatures(nRes.natures || []);
        if (!pRes.products?.length || !nRes.natures?.length)
          setRefError('SQL reference data returned no rows — please check the API.');
      })
      .catch(() => setRefError('Unable to load dropdown data from the SQL API. Please try again.'))
      .finally(() => setLoadingRef(false));
  }, []);

  // Clear any pending debounced lookups when the form unmounts
  useEffect(() => () => {
    clearTimeout(lookupTimer.current);
  }, []);

  // Options for the interactive workflow controls, derived from the loaded reference lists
  const categoryOptions = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
  const sqlVendorOptions = [...new Set(products.map(p => p.vendor).filter(Boolean))].sort();

  // Portal-derived view state for the Complaint → Vendor steps.
  const visibleNatures   = natures.filter(n =>
    !isTemperatureNature(n.nature) || showsTemperatureOption(form.productName)
  );
  const autoWarranty     = getAutoWarranty(form.productName);
  const isFixedVendor    = !!getFixedVendor(form.productName);
  const isHoDirect       = isHoDirectProduct(form.productName);
  const isGenset         = isGensetProduct(form.productName);
  const isFireProduct    = isFireProductName(form.productName);
  const isAutoRouted     = !!autoWarranty;
  const isAmcWebhookMode = wf.warranty === 'Under AMC' && isAmcLookupProduct(form.productName) && !isAutoRouted;
  const isAmcManualMode  = wf.warranty === 'Under AMC' && !isAutoRouted && !isAmcWebhookMode;
  const isBrandMode      = wf.warranty === 'Under Warranty' && !isAutoRouted;
  const isPlainVendorMode = !!wf.warranty && !isAutoRouted && !isAmcWebhookMode && !isAmcManualMode && !isBrandMode;

  // "Under Warranty" uses the portal's product→brand map; AMC is filled from the
  // store webhook, and other statuses keep the full live SQL vendor list.
  // The search box filters the brand dropdown too (while always keeping the
  // current selection visible so the <select> never goes blank mid-typing).
  const brandOptions    = getVendorsForProduct(form.productName);
  const filteredBrands  = brandOptions.filter(v =>
    !wf.vendorQuery.trim() || v.toLowerCase().includes(wf.vendorQuery.toLowerCase()) || v === form.vendorName
  );
  const vendorOptions   = sqlVendorOptions;
  const filteredVendors = vendorOptions.filter(v => v.toLowerCase().includes(wf.vendorQuery.toLowerCase()));

  // One fill routine for all three search boxes — picks camelCase or snake_case
  // field names so every detail populates whatever the API returns.
  const applyDetails = (employee, store) => {
    setForm(f => ({
      ...f,
      employeeCode:  pick(employee, 'code', 'empcode', 'employeeCode') || f.employeeCode,
      employeeName:  pick(employee, 'name', 'empname', 'employeeName') || f.employeeName,
      contactNumber: pick(employee, 'mobile', 'mobileno', 'empmobileno', 'contactNumber') || f.contactNumber,
      designation:   pick(employee, 'designation', 'empdesignation') || f.designation,
      storeCode:     pick(store, 'code', 'storecode') || pick(employee, 'storeCode', 'storecode') || f.storeCode,
      storeName:     pick(store, 'name', 'storename') || pick(employee, 'storeName', 'storename') || f.storeName,
      storeEmail:    pick(store, 'email', 'storeemail') || f.storeEmail,
      city:          pick(store, 'city', 'fmcity') || f.city,
      region:        pick(store, 'region', 'regionname') || f.region,
      state:         pick(store, 'state', 'statename') || f.state,
      zone:          pick(store, 'zone') || f.zone,
      fmName:        pick(store, 'fmName', 'fmname') || f.fmName,
      fmEmail:       pick(store, 'fmEmail', 'fmemail') || f.fmEmail,
      fmMobile:      pick(store, 'fmMobile', 'fmmobileno') || f.fmMobile,
      managerName:   pick(store, 'managerName', 'managername') || f.managerName,
      managerMobile: pick(store, 'managerMobile', 'managermobileno') || f.managerMobile,
      asmName:       pick(store, 'asmName', 'asmname') || f.asmName,
      asmMobile:     pick(store, 'asmMobile', 'asmmobileno') || f.asmMobile,
    }));
  };

  // Fetch the complete store record for a store code discovered via employee/phone.
  const enrichStore = async (storeCode) => {
    if (!storeCode) return;
    try {
      const sr = await vmm.lookupStore(storeCode);
      if (sr?.store) applyDetails(null, sr.store);
    } catch { /* store enrichment is best-effort */ }
  };

  // Each helper returns true when a record was found so the smart search can
  // try the remaining identifier types when the first guess misses.
  const tryEmployee = async (code) => {
    const res = await vmm.lookupEmployee(code);
    const e = res?.employee;
    if (!e) return false;
    applyDetails(e, null);
    let storeCode = pick(e, 'storeCode', 'storecode');
    if (storeCode) await enrichStore(storeCode);
    const finalStore = storeCode || form.storeCode;
    if (finalStore) fetchRecentComplaints(finalStore);
    setLookupMsg(`✓ ${pick(e, 'name')} · ${pick(e, 'code')} · ${storeCode || ''} — details filled`);
    return true;
  };

  const tryStore = async (code) => {
    const res = await vmm.lookupStore(code);
    const s = res?.store;
    if (!s) return false;
    applyDetails(null, s);
    setForm(f => ({ ...f, smEmail: pick(s, 'smEmail', 'email', 'storeemail') || f.smEmail }));
    const storeCode = pick(s, 'code', 'storecode') || code;
    fetchRecentComplaints(storeCode);
    setLookupMsg(`✓ ${pick(s, 'name', 'storename')} · ${storeCode} — details filled`);
    return true;
  };

  const tryPhone = async (mobile) => {
    let employee = null, store = null;
    try {
      const r = await vmm.lookupCaller(mobile);
      employee = r?.employee || null;
      store = r?.store || null;
    } catch { /* fall back to the employee-by-mobile lookup */ }
    if (!employee) {
      const r = await vmm.lookupEmployeeByMobile(mobile);
      employee = r?.employee || null;
    }
    if (!employee && !store) return false;

    const employeeStore = pick(employee, 'storeCode', 'storecode');
    applyDetails(employee, employeeStore ? null : store);
    const storeCode = employeeStore || pick(store, 'code', 'storecode') || pick(store, 'storeCode');
    if (storeCode) { await enrichStore(storeCode); fetchRecentComplaints(storeCode); }
    setLookupMsg(`✓ ${mobile} · ${pick(employee, 'name') || storeCode} — details filled`);
    return true;
  };

  // One input handles all three identifiers — detect by shape, then fall back
  // to the other lookup types if the first guess does not match.
  const runSmartLookup = async (raw) => {
    const q = String(raw || '').trim();
    if (!q) { setLookupMsg('Enter an employee code, store code or 10-digit mobile.'); return; }
    setLookupLoading(true);
    setLookupMsg('');
    setMemberErr('');
    setStoreErr('');
    setAutoFillNote('');

    const digits = q.replace(/\D/g, '');
    const candidates = /^\d{10}$/.test(q) ? ['phone', 'employee', 'store']
                     : /^\d+$/.test(q)    ? ['employee', 'phone', 'store']
                     :                      ['store', 'employee', 'phone'];
    let matched = false;
    for (const kind of candidates) {
      try {
        const ok = kind === 'employee' ? await tryEmployee(q)
                 : kind === 'phone'    ? await tryPhone(digits)
                 :                       await tryStore(q);
        if (ok) { matched = true; break; }
      } catch { /* try the next identifier type */ }
    }
    if (!matched) setLookupMsg('No matching employee, store or mobile found. Please check the value.');
    setLookupLoading(false);
  };

  // Auto-fetch the store's AMC vendor only when the warranty is "Under AMC"
  // (Under Warranty uses the brand map instead). The guard is cleared whenever
  // AMC is left so switching Warranty → AMC always performs a fresh lookup.
  useEffect(() => {
    const product   = form.productName;
    const storeCode = form.storeCode;
    if (!product || !storeCode || wf.warranty !== 'Under AMC' || !isAmcLookupProduct(product)) {
      amcLookupKeyRef.current = '';
      amcRequestIdRef.current += 1;
      setAmcStatus('idle');
      return;
    }
    const key = `${storeCode}|${norm(product)}`;
    if (amcLookupKeyRef.current === key) return;
    amcLookupKeyRef.current = key;
    const requestId = ++amcRequestIdRef.current;
    setAmcStatus('loading');
    vmm.getPortalAmcVendor(storeCode, product)
      .then(res => {
        if (requestId !== amcRequestIdRef.current || !isPortalAmcActive(product)) return;
        if (res.found && res.vendor) {
          setForm(f => ({ ...f, vendorName: res.vendor }));
          setAmcStatus(res.notApplicable ? 'not-applicable' : 'found');
        } else {
          setForm(f => ({ ...f, vendorName: '' }));
          setAmcStatus('error');
        }
      })
      .catch(() => {
        if (requestId !== amcRequestIdRef.current || !isPortalAmcActive(product)) return;
        setForm(f => ({ ...f, vendorName: '' }));
        setAmcStatus('error');
      });
  }, [form.productName, form.storeCode, wf.warranty]);

  const fetchRecentComplaints = async (storeCode) => {
    setLoadingRecent(true);
    setRecentComplaints([]);
    setAutoFillNote('');
    try {
      const res = await vmm.getRecentComplaints(storeCode);
      const list = res.complaints || [];
      setRecentComplaints(list.map(c => ({
        ...c,
        complaintno:     bufStr(c.complaintno),
        empname:         bufStr(c.empname),
        empcode:         bufStr(c.empcode || c.empCode),
        productname:     bufStr(c.productname),
        natureofproblem: bufStr(c.natureofproblem),
        typeofcomplaint: bufStr(c.typeofcomplaint),
        status:          bufStr(c.status || c.current_status),
      })));

      // Auto-fill empty fields from the store's latest SQL complaint.
      // The search row carries employee/TAT data; the detail row carries location/remarks.
      if (list.length) {
        try {
          const latest    = list[0];
          const latestNo  = bufStr(latest.complaintno);
          const detailRes = await vmm.getComplaint(latestNo);
          const c         = detailRes?.complaint || {};
          const productName = bufStr(c.productname || latest.productname);
          const natureName  = bufStr(c.natureofproblem || latest.natureofproblem);
          const natureMeta  = natures.find(n => norm(n.nature) === norm(natureName));
          const productMeta = products.find(p => norm(p.name) === norm(productName));
          // AMC, genset, fire and HO-direct products own the vendor field —
          // never seed it from the previous complaint, or a slow response can
          // overwrite the portal-routed value.
          const vendorOwned = isVendorOwnedProduct(productName) || isVendorOwnedProduct(formRef.current.productName);
          const rawTat      = parseInt(String(bufStr(latest.tat || c.tat) || ''), 10);
          const fallbackTat = Number.isFinite(rawTat) ? rawTat : '';

          // SQL complaint rows carry the employee mobile but not the code —
          // resolve the registered employee so every employee field fills too.
          let complaintEmployee = null;
          const complaintMobile = bufStr(latest.empmobileno);
          if (!form.employeeCode && complaintMobile) {
            try {
              const er = await vmm.lookupEmployeeByMobile(complaintMobile);
              complaintEmployee = er?.employee || null;
            } catch { /* employee resolution is best-effort */ }
          }

          setForm(f => ({
            ...f,
            employeeCode:      f.employeeCode      || bufStr(complaintEmployee?.code || latest.empcode) || '',
            employeeName:      f.employeeName      || bufStr(complaintEmployee?.name || latest.empname) || '',
            contactNumber:     f.contactNumber     || bufStr(complaintMobile) || '',
            designation:       f.designation       || pick(complaintEmployee, 'designation') || '',
            productName:        f.productName        || productName || '',
            productShortName:   f.productShortName   || bufStr(c.productmodel) || '',
            productType:        f.productType        || productMeta?.category || bufStr(latest.producttype) || '',
            vendorName:         vendorOwned ? f.vendorName : (f.vendorName || bufStr(c.vendorname || latest.vendorname) || ''),
            natureOfComplaint:  f.natureOfComplaint  || natureName || '',
            complaintType:      f.complaintType      || natureMeta?.type || bufStr(c.typeofcomplaint || latest.typeofcomplaint) || '',
            tatDays:            f.tatDays !== '' && f.tatDays != null ? f.tatDays : (natureMeta?.tatDays ?? fallbackTat),
            productLocation:    f.productLocation    || bufStr(c.productlocation) || '',
            remarks:            f.remarks            || bufStr(c.remarks || c.description) || '',
          }));
          setAutoFillNote(`Form auto-filled from last SQL complaint ${latestNo} — please review before submitting.`);
        } catch { /* auto-fill is best-effort */ }
      }
    } catch { setRecentComplaints([]); }
    finally { setLoadingRecent(false); }
  };

  const handleNatureChange = (e) => {
    const nature = natures.find(n => n.nature === e.target.value);
    setForm(f => ({
      ...f,
      natureOfComplaint: e.target.value,
      complaintType:     nature?.type    || '',
      tatDays:           nature?.tatDays ?? '',
    }));
  };

  const polishRemarks = async () => {
    if (!form.remarks.trim()) return;
    setPolishing(true);
    try {
      const res = await vmm.polishRemarks(form.remarks);
      if (res?.success && res.polishedText)
        setForm(f => ({ ...f, remarks: res.polishedText }));
    } catch { /* keep the original text if polishing is unavailable */ }
    finally { setPolishing(false); }
  };

  const validate = () => {
    const e = {};
    if (!form.storeCode || !form.storeName)                  e.storeCode      = 'Valid store code is required';
    if (!form.employeeCode || !form.employeeName)            e.employeeCode   = 'Valid registered employee code is required';
    if (!form.contactNumber || !/^\d{10}$/.test(form.contactNumber)) e.contactNumber = 'Valid 10-digit contact number required';
    if (!form.productName)                                   e.productName    = 'Select a product';
    if (!form.natureOfComplaint)                             e.natureOfComplaint = 'Select nature of complaint';
    if (!autoWarranty && !wf.warranty)                        e.warranty       = 'Select warranty / AMC status';
    if ((isBrandMode || isGenset || isAmcManualMode || isPlainVendorMode) && !form.vendorName)
      e.vendor = isBrandMode ? 'Select a brand (or choose None of the above)'
               : isAmcManualMode ? 'Select or enter the AMC vendor'
               : 'Enter the vendor name';
    if (isAmcWebhookMode && amcStatus !== 'found' && amcStatus !== 'not-applicable' && !form.vendorName)
      e.vendor = 'Enter the AMC vendor manually (store lookup unavailable)';
    if (!form.productLocation.trim())                        e.productLocation = 'Product location is required';
    if (!form.remarks.trim())                                e.remarks         = 'Complaint description is required';
    if (ATTACHMENT_MANDATORY.includes(form.complaintType) && form.attachments.length === 0 && !noImage)
      e.attachments = `At least 1 attachment is mandatory for ${form.complaintType} complaints (or check "No image available")`;
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    // Resolve escalation recipients so user can preview/edit in confirm modal
    try {
      const resolved = vmm.resolveEscalationRecipients({
        storeCode:  form.storeCode,
        storeEmail: form.storeEmail,
        storeName:  form.storeName,
        fmEmail:    form.fmEmail,
        fmName:     form.fmName,
        vendorName: form.vendorName,
        productName: form.productName,
        storeState: form.state,
        storeCity:  form.city,
      });
      setResolvedTo(resolved.toAddresses || []);
      setResolvedCc(resolved.ccAddresses || []);
    } catch { setResolvedTo([]); setResolvedCc([]); }
    setShowConfirm(true);
  };

  const doSubmit = async () => {
    setShowConfirm(false);
    setSubmitErr('');
    setSubmitting(true);
    const payload = {
      storeCode:         form.storeCode,
      storeName:         form.storeName,
      city:              form.city,
      region:            form.region,
      state:             form.state,
      zone:              form.zone,
      storeEmail:        form.storeEmail,
      fmName:            form.fmName,
      managerName:       form.managerName,
      managerMobile:     form.managerMobile,
      asmName:           form.asmName,
      asmMobile:         form.asmMobile,
      employeeCode:      form.employeeCode,
      employeeName:      form.employeeName,
      contactNumber:     form.contactNumber,
      designation:       form.designation,
      productName:       form.productName,
      productShortName:  form.productShortName,
      vendorName:        form.vendorName,
      productType:       form.productType,
      natureOfComplaint: form.natureOfComplaint,
      complaintType:     form.complaintType,
      warrantyStatus:    wf.warranty,
      tatDays:           form.tatDays,
      productLocation:   form.productLocation,
      remarks:           wf.noneBrand ? `Brand info: ${wf.noneBrand}. ${form.remarks}` : form.remarks,
      source:            form.source,
      emailSubject:      form.emailSubject,
      callTxnId:         form.callTxnId,
      uid: currentUser?.id ?? 1,
      agentName: currentUser?.name || '',
    };
    try {
      const qty         = Math.max(1, Math.min(quantity, 20));
      const wQty        = Math.max(0, Math.min(warrantyQty, qty - 1));
      const regularQty  = qty - wQty;
      const allResults  = [];

      const getUnitLoc = (i) => (unitLocations[i] && unitLocations[i].trim()) || form.productLocation;
      const fallbackWarrantyNature = () =>
        natures.find(n => /warranty/i.test(n.nature) && /hvac|ac/i.test(n.nature)) || { nature: 'AC - Warranty', type: 'Warranty', tatDays: 30 };

      // Log one complaint per unit — nature can be overridden per unit, vendor follows the warranty/regular split
      for (let i = 0; i < qty; i++) {
        const isWarrantyUnit = i >= regularQty;
        const loc            = getUnitLoc(i);
        const overrideName   = (unitNatures[i] || '').trim();
        const natureObj       = overrideName
          ? (natures.find(n => n.nature === overrideName) || { nature: overrideName, type: 'Repair', tatDays: 7 })
          : isWarrantyUnit
            ? fallbackWarrantyNature()
            : { nature: form.natureOfComplaint, type: form.complaintType, tatDays: form.tatDays };

        const unitPayload = {
          ...payload,
          vendorName:        isWarrantyUnit ? (warrantyVendor.trim() || payload.vendorName) : payload.vendorName,
          natureOfComplaint: natureObj.nature,
          complaintType:     natureObj.type,
          tatDays:           natureObj.tatDays,
          productLocation:   loc,
        };
        const res = await vmm.logComplaint(unitPayload);
        if (res.success) allResults.push({ ...res, _type: isWarrantyUnit ? 'warranty' : 'regular', productLocation: loc, _vendorName: unitPayload.vendorName, _nature: natureObj.nature });
        else { setSubmitErr(`Failed on complaint ${i + 1}: ${res.message || 'Unknown error'}`); break; }
      }

      if (allResults.length === qty) {
        // Send ONE consolidated escalation email for all units
        vmm.sendEscalationEmail({
          storeCode:        form.storeCode,
          storeName:        form.storeName,
          storeEmail:       form.storeEmail       || '',
          fmName:           form.fmName           || '',
          fmEmail:          form.fmEmail          || '',
          vendorName:       form.vendorName        || '',
          productName:      form.productName       || '',
          natureOfComplaint: form.natureOfComplaint || '',
          storeState:       form.state             || '',
          storeCity:        form.city              || '',
          complaints: allResults.map(r => ({
            complaintno:     r.complaintno,
            productLocation: r.productLocation,
            natureOfProblem: r._nature        || '',
            edcDate:         r.edcDate,
            description:     form.remarks     || '',
          })),
          extraToEmails: extraTo.split(/[;,]/).map(s => s.trim()).filter(Boolean),
          extraCcEmails: extraCc.split(/[;,]/).map(s => s.trim()).filter(Boolean),
        }).catch(() => {});
        setResults(allResults);
        setResult(allResults[0]);
        setSubmitted(true);
      }
    } catch (err) {
      setSubmitErr('Could not reach server. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setForm(emptyForm);
    setErrors({});
    setStoreErr('');
    setMemberErr('');
    setSubmitted(false);
    setResult(null);
    setResults([]);
    setSubmitErr('');
    setNoImage(false);
    setQuantity(1);
    setWarrantyQty(0);
    setWarrantyVendor('');
    setUnitLocations([]);
    setUnitNatures([]);
    setRecentComplaints([]);
    setWf(emptyWf);
    wfRef.current = emptyWf;
    amcLookupKeyRef.current = '';
    amcRequestIdRef.current += 1;
    setAmcStatus('idle');
    setGensetChoice('');
    setLookupQuery('');
    setLookupMsg('');
    setAutoFillNote('');
    setExtraTo('');
    setExtraCc('');
    setPolishing(false);
    setResolvedTo([]);
    setResolvedCc([]);
  };

  // AC/HVAC product detection — quantity and warranty only apply to these
  const isAcProduct = norm(form.productName) === 'ac';

  // Duplicate warning — same product logged for this store within recent complaints
  const duplicateWarning = recentComplaints.find(c =>
    c.productname && form.productName &&
    c.productname.toLowerCase() === form.productName.toLowerCase() &&
    new Date(c.created) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  );

  if (submitted && result) {
    return (
      <div className="success-wrap">
        <div className="success-card">
          <div className="success-check">✓</div>
          <h2>{results.length > 1 ? `${results.length} Cases Logged!` : 'Case Logged Successfully'}</h2>

          {results.length > 1 ? (
            <>
              <p className="case-id-label">{results.length} Complaint IDs Generated</p>
              <div className="multi-ids">
                {results.map((r, i) => (
                  <div key={i} className="multi-id-row">
                    <span className="multi-id-num">#{i + 1}</span>
                    <span className="multi-id-val">{r.complaintno}</span>
                    {r._type === 'warranty' && <span className="multi-id-tag warranty">Warranty</span>}
                    {r._type === 'regular'  && warrantyQty > 0 && <span className="multi-id-tag regular">Regular</span>}
                    {r._nature && <span className="multi-id-tag" style={{ background: '#f1f5f9', color: '#475569' }}>{r._nature}</span>}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="case-id-label">Case ID</p>
              <p className="case-id-value">{result.complaintno}</p>
            </>
          )}

          <div className="success-grid">
            <div><span>Store</span><strong>{form.storeName}</strong></div>
            <div><span>Complainant</span><strong>{form.employeeName}</strong></div>
            <div><span>Product</span><strong>{form.productName}</strong></div>
            <div><span>Complaint Type</span><strong>{form.complaintType}</strong></div>
            <div><span>TAT</span><strong>{form.tatDays} day{form.tatDays > 1 ? 's' : ''}</strong></div>
            <div><span>Expected Closure</span><strong>{result.edcDate || (edc ? formatDate(edc) : '-')}</strong></div>
          </div>
          <p className="escalation-note">
            {results.length > 1
              ? `1 escalation email sent with all ${results.length} units.`
              : 'Escalation email has been triggered automatically.'}
          </p>
          <button className="btn-primary" onClick={handleReset}>Log New Case</button>
        </div>
      </div>
    );
  }

  return (
    <div className="form-page">
      <div className="form-heading">
        <div>
          <h2>New Case</h2>
          <p>Facility Complaint — VMM</p>
        </div>
        <span className="draft-badge">Draft</span>
      </div>

      {/* Confirmation modal — shown before actual submission */}
      {showConfirm && (
        <div className="clf-confirm-overlay" onClick={() => setShowConfirm(false)}>
          <div className="clf-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="clf-confirm-title">Confirm before logging</div>
            <div className="clf-confirm-subtitle">Verify all details are correct:</div>

            {/* Duplicate warning */}
            {duplicateWarning && (
              <div className="clf-dup-warn">
                ⚠ Similar complaint already exists for this store:<br/>
                <strong>{duplicateWarning.complaintno || `#${duplicateWarning.complaintid}`}</strong> — {duplicateWarning.productname} ({new Date(duplicateWarning.created).toLocaleDateString('en-IN')})
                <br/><span style={{ fontSize: 11 }}>Confirm only if this is a NEW complaint for a different unit.</span>
              </div>
            )}

            {/* WIP warning — check if same product/store is in WIP */}
            <div className="clf-confirm-grid">
              {[
                { label: 'Store',           val: `${form.storeCode} — ${form.storeName}` },
                { label: 'Employee',        val: `${form.employeeCode} — ${form.employeeName}` },
                { label: 'Contact',         val: form.contactNumber },
                { label: 'Product',         val: form.productName },
                { label: 'Warranty',        val: wf.warranty },
                { label: 'Vendor',          val: form.vendorName },
                { label: 'Nature',          val: form.natureOfComplaint },
                { label: 'Type / TAT',      val: `${form.complaintType} · ${form.tatDays}d` },
                { label: 'Location',        val: form.productLocation },
                { label: 'Units',           val: quantity + (warrantyQty > 0 ? ` (${quantity - warrantyQty} regular + ${warrantyQty} warranty)` : '') },
              ].map(({ label, val }) => (
                <div key={label} className="clf-confirm-row">
                  <span className="clf-confirm-label">{label}</span>
                  <span className="clf-confirm-val">{val || '—'}</span>
                </div>
              ))}
            </div>
            {/* Escalation email recipients preview + extra To/CC */}
            <div className="clf-email-section">
              <div className="clf-email-section-title">Escalation Email</div>

              <div className="clf-recip-row">
                <span className="clf-recip-label">To</span>
                <div className="clf-recip-tags">
                  {resolvedTo.length > 0
                    ? resolvedTo.map((r, i) => (
                        <span key={i} className="clf-recip-tag clf-recip-tag-to">
                          {r.emailAddress.name || r.emailAddress.address}
                        </span>
                      ))
                    : <span className="clf-recip-none">No recipient resolved — add one below</span>
                  }
                </div>
              </div>

              <div className="clf-recip-row">
                <span className="clf-recip-label">CC</span>
                <div className="clf-recip-tags">
                  {resolvedCc.length > 0
                    ? resolvedCc.map((r, i) => (
                        <span key={i} className="clf-recip-tag clf-recip-tag-cc">
                          {r.emailAddress.name || r.emailAddress.address}
                        </span>
                      ))
                    : <span className="clf-recip-none">None</span>
                  }
                </div>
              </div>

              <div className="clf-recip-row clf-recip-extra">
                <span className="clf-recip-label">+ Add To</span>
                <input
                  type="text"
                  className="clf-extra-input"
                  placeholder="email1@domain.com, email2@domain.com"
                  value={extraTo}
                  onChange={e => setExtraTo(e.target.value)}
                />
              </div>

              <div className="clf-recip-row clf-recip-extra">
                <span className="clf-recip-label">+ Add CC</span>
                <input
                  type="text"
                  className="clf-extra-input"
                  placeholder="email1@domain.com, email2@domain.com"
                  value={extraCc}
                  onChange={e => setExtraCc(e.target.value)}
                />
              </div>
            </div>

            <div className="clf-confirm-actions">
              <button type="button" className="clf-confirm-cancel" onClick={() => setShowConfirm(false)}>Go Back &amp; Edit</button>
              <button type="button" className="clf-confirm-ok" onClick={doSubmit}>
                {quantity > 1 ? `Confirm — Log ${quantity} Cases` : 'Confirm — Log Case'}
              </button>
            </div>
          </div>
        </div>
      )}

      {submitErr && <div className="alert-banner" style={{ marginBottom: 8 }}>⚠ {submitErr}</div>}

      <form onSubmit={handleSubmit} noValidate>

        {/* ── Search Bar ── */}
        <div className="search-card">
          <div className="search-card-title">
            Identify Complainant &amp; Store
            <span className="search-card-sub">Both store and employee details are required to log a complaint</span>
          </div>
          <div className="search-bar-row">

            {/* One smart search box for all three identifiers */}
            <div className="search-block search-block-single">
              <label className="search-label">
                Employee Code / Store Code / Phone No
                <span className="search-badge recommended">Smart search</span>
                {(form.employeeName || form.storeName) && <span className="search-badge filled">✓ Filled</span>}
                {!form.employeeName && !form.storeName && (errors.employeeCode || errors.storeCode) && (
                  <span className="search-badge missing">Required</span>
                )}
              </label>
              <div className="search-input-wrap">
                <input
                  type="text"
                  className={`search-input ${lookupMsg && !lookupMsg.startsWith('✓') ? 'err' : (form.employeeName || form.storeName) ? 'filled' : ''}`}
                  placeholder="Enter employee code, store code or 10-digit mobile"
                  value={lookupQuery}
                  onChange={e => {
                    const val = e.target.value;
                    setLookupQuery(val);
                    setLookupMsg('');
                    setForm(f => ({ ...f, employeeName: '', storeName: '', contactNumber: '' }));
                    clearTimeout(lookupTimer.current);
                    if (val.trim().length >= 4) lookupTimer.current = setTimeout(() => runSmartLookup(val), 600);
                  }}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), runSmartLookup(lookupQuery))}
                />
                <button type="button" className="search-btn" onClick={() => runSmartLookup(lookupQuery)} disabled={lookupLoading}>
                  {lookupLoading ? 'Searching…' : 'Search'}
                </button>
              </div>
              {lookupMsg && (
                <p className="search-err" style={{ color: lookupMsg.startsWith('✓') ? '#15803d' : '#b91c1c' }}>{lookupMsg}</p>
              )}
              {(errors.employeeCode || errors.storeCode || memberErr || storeErr) && (
                <p className="search-err">{errors.employeeCode || errors.storeCode || memberErr || storeErr}</p>
              )}
              <p className="search-hint">One search fills employee, store and complaint details automatically</p>
            </div>

          </div>

          {/* Inline warning when store filled but complainant still missing */}
          {form.storeName && !form.employeeName && (
            <div className="search-warning">
              ⚠ Store found — search again with the employee code or mobile to fill complainant details.
            </div>
          )}
        </div>

        {/* ── Confirmation Card ── */}
        {(form.storeName || form.employeeName) && (
          <div className="confirm-card">
            <div className="confirm-sections">

              {form.storeName && (
                <div className="confirm-section">
                  <div className="confirm-section-title">Store Details</div>
                  <div className="confirm-grid">
                    <div className="confirm-item">
                      <span>Store Code</span>
                      <strong>{form.storeCode}</strong>
                    </div>
                    <div className="confirm-item">
                      <span>Store Name</span>
                      <strong>{form.storeName}</strong>
                    </div>
                    <div className="confirm-item">
                      <span>City</span>
                      <strong>{form.city || '—'}</strong>
                    </div>
                    <div className="confirm-item">
                      <span>Region / Zone</span>
                      <strong>{[form.region, form.zone].filter(Boolean).join(' · ') || '—'}</strong>
                    </div>
                    <div className="confirm-item">
                      <span>State</span>
                      <strong>{form.state || '—'}</strong>
                    </div>
                    <div className="confirm-item">
                      <span>FM Name</span>
                      <strong>{form.fmName || '—'}</strong>
                    </div>
                    {form.managerName && (
                      <div className="confirm-item">
                        <span>Manager</span>
                        <strong>{form.managerName}</strong>
                      </div>
                    )}
                    {form.asmName && (
                      <div className="confirm-item">
                        <span>ASM</span>
                        <strong>{form.asmName}</strong>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {form.employeeName && (
                <div className="confirm-section">
                  <div className="confirm-section-title">Complainant Details</div>
                  <div className="confirm-grid">
                    <div className="confirm-item">
                      <span>Employee Code</span>
                      <strong>{form.employeeCode}</strong>
                    </div>
                    <div className="confirm-item">
                      <span>Employee Name</span>
                      <strong>{form.employeeName}</strong>
                    </div>
                    {form.designation && (
                      <div className="confirm-item">
                        <span>Designation</span>
                        <strong>{form.designation}</strong>
                      </div>
                    )}
                    <div className="confirm-item confirm-item-input">
                      <span>Contact Number <span className="req">*</span></span>
                      <input
                        type="text"
                        placeholder="10-digit mobile"
                        value={form.contactNumber}
                        maxLength={10}
                        onChange={e => setForm(f => ({ ...f, contactNumber: e.target.value }))}
                        className={errors.contactNumber ? 'err' : ''}
                      />
                      {errors.contactNumber && <p className="err-msg">{errors.contactNumber}</p>}
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

        {/* Complaint workflow — clean, aligned form layout */}
        <div className="card workflow-card">
          <div className="wf-header">
            <h3 className="card-title">Complaint Workflow</h3>
            <span className="wf-count">10 steps</span>
          </div>
          {loadingRef && <p className="hint">Loading product and nature lists from SQL…</p>}
          {!loadingRef && refError && (
            <div className="wf-notice warn">⚠ {refError}</div>
          )}
          {autoFillNote && (
            <div className="wf-notice ok">✓ {autoFillNote}</div>
          )}
          <div className="wf-grid">
            {COMPLAINT_STEPS.map((step, i) => (
              <WorkflowStep key={step.name} n={i + 1} title={step.name} sub={step.sub} wide={i === 0 || i === 9}>
                {i === 0 && (
                  <>
                    <div className="wf-inline">
                      <input
                        type="text"
                        className="wf-input"
                        placeholder="Employee code, store code or mobile"
                        value={lookupQuery}
                        onChange={e => {
                          const val = e.target.value;
                          setLookupQuery(val);
                          setLookupMsg('');
                          clearTimeout(lookupTimer.current);
                          if (val.trim().length >= 4) lookupTimer.current = setTimeout(() => runSmartLookup(val), 600);
                        }}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), runSmartLookup(lookupQuery))}
                      />
                      <button type="button" className="wf-btn" onClick={() => runSmartLookup(lookupQuery)} disabled={lookupLoading}>
                        {lookupLoading ? 'Searching…' : 'Verify'}
                      </button>
                    </div>
                    {lookupMsg && (
                      <p className={`wf-msg ${lookupMsg.startsWith('✓') ? 'ok' : 'bad'}`}>{lookupMsg}</p>
                    )}
                    {form.employeeName ? (
                      <div className="wf-verified">
                        <span className="wf-verified-dot" />
                        <strong>{form.employeeName}</strong>
                        <span>{form.employeeCode}</span>
                        <span>{form.storeName || form.storeCode}</span>
                      </div>
                    ) : (
                      <p className="wf-help">Your name, employee code and store details will appear here after verification.</p>
                    )}
                    <div className="wf-subfield">
                      <label>Contact number</label>
                      <input
                        type="tel"
                        className={`wf-input ${errors.contactNumber ? 'err' : ''}`}
                        value={form.contactNumber}
                        onChange={e => setForm(f => ({ ...f, contactNumber: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                        placeholder="10-digit mobile"
                      />
                      {errors.contactNumber && <p className="err-msg">{errors.contactNumber}</p>}
                    </div>
                  </>
                )}
                {i === 1 && (
                  <select className="wf-input" value={wf.category} onChange={e => setWf(w => ({ ...w, category: e.target.value }))}>
                    <option value="">— Select category —</option>
                    {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                {i === 2 && (
                  <>
                    <ProductSearch
                      products={products}
                      value={form.productName}
                      error={!!errors.productName}
                      onChange={p => {
                        const fixedVendor = getFixedVendor(p.name);
                        const hoDirect    = isHoDirectProduct(p.name);
                        const amcLookup   = isAmcLookupProduct(p.name);
                        const autoWarranty = getAutoWarranty(p.name);
                        // Keep a manually chosen warranty (e.g. Under AMC) when
                        // changing between ordinary products. Only auto-routed
                        // products replace it, and leaving one clears it.
                        const previousWarranty = wfRef.current.warranty;
                        const warranty = autoWarranty ||
                          (AUTO_WARRANTY_VALUES.has(previousWarranty) ? '' : previousWarranty);

                        // HTML product selection sets the category from the
                        // chosen product and auto-routes special products.
                        let vendorName = p.vendor || '';
                        if (fixedVendor)      vendorName = fixedVendor;
                        else if (hoDirect)    vendorName = 'N/A — HO Direct';
                        else if (amcLookup || isGensetProduct(p.name) || isFireProductName(p.name)) vendorName = '';

                        const nextWf = {
                          ...wfRef.current,
                          category: p.category || '',
                          warranty,
                          vendorQuery: '',
                          vendorFreeText: '',
                          noneBrand: '',
                        };
                        amcLookupKeyRef.current = '';
                        amcRequestIdRef.current += 1;
                        formRef.current = { ...formRef.current, productName: p.name, vendorName };
                        wfRef.current = nextWf;
                        setWf(nextWf);
                        setGensetChoice('');
                        setAmcStatus('idle');
                        setForm(f => {
                          const next = {
                            ...f,
                            productName: p.name,
                            productShortName: p.shortName || '',
                            vendorName,
                            productType: p.category || '',
                          };
                          // Portal rule: temperature nature is AC-only.
                          if (!showsTemperatureOption(p.name) && isTemperatureNature(f.natureOfComplaint)) {
                            next.natureOfComplaint = '';
                            next.complaintType = '';
                            next.tatDays = '';
                          }
                          return next;
                        });
                      }}
                      disabled={loadingRef}
                    />
                    {errors.productName && <p className="err-msg">{errors.productName}</p>}
                  </>
                )}
                {i === 3 && (
                  <>
                    <select className={`wf-input ${errors.natureOfComplaint ? 'err' : ''}`} value={form.natureOfComplaint} onChange={handleNatureChange}>
                      <option value="">— Select Nature of Complaint —</option>
                      {visibleNatures.map(n => <option key={n.nature} value={n.nature}>{n.nature}</option>)}
                    </select>
                    {!showsTemperatureOption(form.productName) && (
                      <p className="wf-help">Temperature complaints are shown only for AC / Server Room AC (portal rule).</p>
                    )}
                    {errors.natureOfComplaint && <p className="err-msg">{errors.natureOfComplaint}</p>}
                  </>
                )}
                {i === 4 && (
                  isAutoRouted ? (
                    <p className={`wf-msg ${isFixedVendor || isHoDirect ? 'ok' : ''}`}>
                      {isFixedVendor && `Portal rule — vendor ${getFixedVendor(form.productName)} auto-assigned; warranty step skipped.`}
                      {isHoDirect && 'Portal rule — routed to Facility Manager / HO Team; warranty and vendor steps skipped.'}
                      {isGenset && 'Portal rule — genset skips warranty; choose the brand in the Vendor step.'}
                      {isFireProduct && 'Portal rule — fire products skip warranty; vendor from sticker is optional.'}
                    </p>
                  ) : (
                    <>
                      <select className={`wf-input ${errors.warranty ? 'err' : ''}`} value={wf.warranty || ''} onChange={e => {
                        const warranty = e.target.value;
                        const nextWf = {
                          ...wfRef.current,
                          warranty,
                          vendorQuery: '',
                          vendorFreeText: '',
                          noneBrand: '',
                        };
                        setWf(nextWf);
                        wfRef.current = nextWf;
                        // Portal buildVendorStep() resets the vendor on every
                        // warranty switch — never keep a value from the previous
                        // status (brand → AMC → plain text, etc.).
                        amcLookupKeyRef.current = '';
                        amcRequestIdRef.current += 1;
                        setAmcStatus('idle');
                        setGensetChoice('');
                        setForm(f => ({ ...f, vendorName: '' }));
                      }}>
                        <option value="">— Select warranty / AMC status —</option>
                        {['Under Warranty', 'Under AMC', 'Not Applicable'].map(x => <option key={x} value={x}>{x}</option>)}
                      </select>
                      {wf.warranty === 'Not Applicable' && (
                        <p className="wf-help">Not sure? Portal guidance says select Not Applicable — the team verifies during inspection.</p>
                      )}
                      {errors.warranty && <p className="err-msg">{errors.warranty}</p>}
                    </>
                  )
                )}
                {i === 5 && (
                  <div className="wf-stack">
                    {isFixedVendor && (
                      <p className="wf-msg ok">
                        Portal rule — {getFixedVendor(form.productName)} auto-assigned as the vendor.
                      </p>
                    )}
                    {isHoDirect && (
                      <p className="wf-msg ok">Portal rule — no vendor required; routed to HO / Facility Manager.</p>
                    )}
                    {isGenset && (
                      <>
                        <p className="wf-help">Portal rule — choose Kirloskar, or send other brands to HO.</p>
                        <div className="wf-inline">
                          <button
                            type="button"
                            className={`wf-btn ${gensetChoice === 'Kirloskar' ? 'active' : ''}`}
                            onClick={() => { setGensetChoice('Kirloskar'); setForm(f => ({ ...f, vendorName: 'Kirloskar' })); }}
                          >
                            Kirloskar
                          </button>
                          <button
                            type="button"
                            className={`wf-btn ${gensetChoice === 'other' ? 'active' : ''}`}
                            onClick={() => { setGensetChoice('other'); setForm(f => ({ ...f, vendorName: 'N/A — HO Direct' })); }}
                          >
                            Other brand (HO)
                          </button>
                        </div>
                        {errors.vendor && <p className="err-msg">{errors.vendor}</p>}
                      </>
                    )}
                    {isFireProduct && (
                      <>
                        <p className="wf-help">Portal rule — enter the vendor from the unit sticker. This is optional.</p>
                        <input
                          className="wf-input"
                          type="text"
                          placeholder="Sticker vendor (optional)"
                          value={wf.vendorFreeText}
                          onChange={e => {
                            const v = e.target.value;
                            setWf(w => ({ ...w, vendorFreeText: v }));
                            setForm(f => ({ ...f, vendorName: v.trim() }));
                          }}
                        />
                      </>
                    )}
                    {isAmcWebhookMode && (
                      <>
                        <p className={`wf-msg ${
                          amcStatus === 'found' || amcStatus === 'not-applicable' ? 'ok' :
                          amcStatus === 'error' ? 'bad' : ''
                        }`}>
                          {amcStatus === 'idle'            && 'Search a store to auto-fill the AMC vendor, or enter it below'}
                          {amcStatus === 'loading'         && 'Fetching your store’s AMC vendor…'}
                          {amcStatus === 'found'           && '✓ AMC vendor auto-filled from the store record'}
                          {amcStatus === 'not-applicable'  && '✓ No active AMC vendor — routed to HO / Facility Manager'}
                          {amcStatus === 'error'           && '⚠ Could not fetch AMC vendor — enter it manually below'}
                        </p>
                        {(amcStatus === 'found' || amcStatus === 'not-applicable') && (
                          <div className="wf-amc-card">
                            <span>Your AMC Vendor</span>
                            <strong>{form.vendorName || '—'}</strong>
                          </div>
                        )}
                        {(amcStatus === 'idle' || amcStatus === 'error') && (
                          <input
                            className={`wf-input ${errors.vendor ? 'err' : ''}`}
                            type="text"
                            placeholder="Enter AMC vendor manually"
                            value={wf.vendorFreeText}
                            onChange={e => {
                              const v = e.target.value;
                              setWf(w => ({ ...w, vendorFreeText: v }));
                              setForm(f => ({ ...f, vendorName: v.trim() }));
                            }}
                          />
                        )}
                        {errors.vendor && <p className="err-msg">{errors.vendor}</p>}
                      </>
                    )}
                    {isAmcManualMode && (
                      <>
                        <p className="wf-help">
                          Select the AMC vendor from the live SQL list, or type a custom vendor name.
                        </p>
                        <input
                          className="wf-input"
                          type="text"
                          placeholder="Search AMC vendor…"
                          value={wf.vendorQuery}
                          onChange={e => setWf(w => ({ ...w, vendorQuery: e.target.value }))}
                        />
                        <select
                          className={`wf-input ${errors.vendor ? 'err' : ''}`}
                          value={form.vendorName}
                          onChange={e => {
                            setWf(w => ({ ...w, vendorFreeText: '' }));
                            setForm(f => ({ ...f, vendorName: e.target.value }));
                          }}
                        >
                          <option value="">— Select AMC vendor —</option>
                          {filteredVendors.map(v => <option key={v} value={v}>{v}</option>)}
                          {form.vendorName && !filteredVendors.includes(form.vendorName) && (
                            <option value={form.vendorName}>{form.vendorName}</option>
                          )}
                        </select>
                        <input
                          className="wf-input"
                          type="text"
                          placeholder="Or enter AMC vendor manually"
                          value={wf.vendorFreeText}
                          onChange={e => {
                            const v = e.target.value;
                            setWf(w => ({ ...w, vendorFreeText: v, vendorQuery: '' }));
                            setForm(f => ({ ...f, vendorName: v.trim() }));
                          }}
                        />
                        {errors.vendor && <p className="err-msg">{errors.vendor}</p>}
                      </>
                    )}
                    {isBrandMode && (
                      <>
                        <input
                          className="wf-input"
                          type="text"
                          placeholder="Search brand…"
                          value={wf.vendorQuery}
                          onChange={e => setWf(w => ({ ...w, vendorQuery: e.target.value }))}
                        />
                        <select
                          className={`wf-input ${errors.vendor ? 'err' : ''}`}
                          value={form.vendorName === 'N/A — HO Direct' ? '__none__' : form.vendorName}
                          onChange={e => {
                            const v = e.target.value;
                            setWf(w => ({ ...w, noneBrand: '' }));
                            setForm(f => ({ ...f, vendorName: v === '__none__' ? 'N/A — HO Direct' : v }));
                          }}
                        >
                          <option value="">— Select brand —</option>
                          {filteredBrands.map(v => <option key={v} value={v}>{v}</option>)}
                          <option value="__none__">None of the above (HO team will handle)</option>
                          {form.vendorName && !filteredBrands.includes(form.vendorName) && form.vendorName !== 'N/A — HO Direct' && (
                            <option value={form.vendorName}>{form.vendorName}</option>
                          )}
                        </select>
                        {form.vendorName === 'N/A — HO Direct' && (
                          <input
                            className="wf-input"
                            type="text"
                            placeholder="Brand name (optional — added to remarks)"
                            value={wf.noneBrand}
                            onChange={e => setWf(w => ({ ...w, noneBrand: e.target.value }))}
                          />
                        )}
                        <p className="wf-help">
                          {brandOptions.length} brand(s) available for {form.productName || 'this product'}
                          {!PRODUCT_VENDORS[norm(form.productName)] && ' — showing the standard warranty brand list'}
                        </p>
                        {errors.vendor && <p className="err-msg">{errors.vendor}</p>}
                      </>
                    )}
                    {isPlainVendorMode && (
                      <>
                        <p className="wf-help">Portal rule — enter the vendor/company name manually.</p>
                        <input
                          className={`wf-input ${errors.vendor ? 'err' : ''}`}
                          type="text"
                          placeholder={wf.warranty === 'Under AMC'
                            ? 'e.g. BlueStar Services, Carrier AMC'
                            : 'e.g. LG, Samsung, Voltas, Daikin, or NA'}
                          value={wf.vendorFreeText}
                          onChange={e => {
                            const v = e.target.value;
                            setWf(w => ({ ...w, vendorFreeText: v }));
                            setForm(f => ({ ...f, vendorName: v.trim() }));
                          }}
                        />
                        {errors.vendor && <p className="err-msg">{errors.vendor}</p>}
                      </>
                    )}
                    {!wf.warranty && <p className="wf-help">Select a warranty status first.</p>}
                  </div>
                )}
                {i === 6 && (
                  <>
                    <input className={`wf-input ${errors.productLocation ? 'err' : ''}`} type="text" placeholder="e.g. Ground Floor near lift" value={form.productLocation} onChange={e => setForm(f => ({ ...f, productLocation: e.target.value }))} />
                    {errors.productLocation && <p className="err-msg">{errors.productLocation}</p>}
                  </>
                )}
                {i === 7 && (
                  <div className="wf-stack">
                    {ATTACHMENT_MANDATORY.includes(form.complaintType) && !noImage && (
                      <p className="wf-help">Mandatory for {form.complaintType} complaints.</p>
                    )}
                    {!noImage && (
                      <>
                        <input
                          className={`wf-input wf-file ${errors.attachments ? 'err' : ''}`}
                          type="file"
                          accept=".jpg,.jpeg,.png,.pdf"
                          multiple
                          onChange={e => setForm(f => ({ ...f, attachments: Array.from(e.target.files || []) }))}
                        />
                        <p className="wf-help">Accepted: JPG, PNG, PDF</p>
                        {form.attachments.length > 0 && (
                          <ul className="file-list">
                            {form.attachments.map((f, i) => <li key={i}>📎 {f.name}</li>)}
                          </ul>
                        )}
                      </>
                    )}
                    <label className="no-image-check">
                      <input
                        type="checkbox"
                        checked={noImage}
                        onChange={e => { setNoImage(e.target.checked); setForm(f => ({ ...f, attachments: e.target.checked ? [] : f.attachments })); }}
                      />
                      No image available / will be shared later
                    </label>
                    {errors.attachments && <p className="err-msg">{errors.attachments}</p>}
                  </div>
                )}
                {i === 8 && (
                  <>
                    <div className="wf-remarks-head">
                      <span>Describe the problem</span>
                      <button
                        type="button"
                        className={`btn-ai-polish ${polishing ? 'loading' : ''}`}
                        onClick={polishRemarks}
                        disabled={polishing || !form.remarks.trim()}
                        title="Let AI rewrite this professionally"
                      >
                        {polishing ? '✦ Polishing…' : '✦ AI Polish'}
                      </button>
                    </div>
                    <textarea className={`wf-input ${errors.remarks ? 'err' : ''}`} rows={3} placeholder="Describe the problem…" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
                    <p className="wf-help">You can write in English or Hinglish — AI Polish will rewrite it professionally.</p>
                    {errors.remarks && <p className="err-msg">{errors.remarks}</p>}
                  </>
                )}
                {i === 9 && (
                  <div className="wf-review">
                    {[
                      ['Type', form.complaintType],
                      ['Category', wf.category],
                      ['Product', form.productName],
                      ['Nature', form.natureOfComplaint],
                      ['Warranty', wf.warranty],
                      ['Vendor', form.vendorName],
                      ...(wf.noneBrand ? [['Brand info', wf.noneBrand]] : []),
                      ['Location', form.productLocation],
                      ['Attachments', form.attachments.length ? form.attachments.map(f => f.name).join(', ') : ''],
                      ['Remarks', form.remarks],
                    ].map(([label, value]) => (
                      <div key={label} className="wf-review-item">
                        <span>{label}</span>
                        <strong className={value ? '' : 'empty'}>{value || '—'}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </WorkflowStep>
            ))}
          </div>
        </div>

        {/* Auto-calculated */}
        {form.complaintType && (
          <div className="auto-card">
            <h3 className="card-title">Auto-Calculated</h3>
            <div className="auto-grid">
              <div className="auto-item">
                <span>Complaint Type</span>
                <strong className={`type-badge type-${form.complaintType.toLowerCase()}`}>{form.complaintType}</strong>
              </div>
              <div className="auto-item">
                <span>TAT</span>
                <strong>{form.tatDays} day{form.tatDays > 1 ? 's' : ''}</strong>
              </div>
              <div className="auto-item">
                <span>Case Logging Date</span>
                <strong>{formatDate(today)}</strong>
              </div>
              <div className="auto-item">
                <span>Expected Date of Closure (EDC)</span>
                <strong className="edc-value">{edc ? formatDate(edc) : '—'}</strong>
              </div>
            </div>
          </div>
        )}

        {/* Number of ACs — only shown when product is AC/HVAC */}
        {isAcProduct && (
          <div className="card">
            <h3 className="card-title">Number of AC Units</h3>
            <p className="hint" style={{ marginBottom: 12 }}>
              Each AC unit gets its own complaint number. Set the total count below.
            </p>
            <div className="qty-row">
              {[1,2,3,4,5,6,7,8,9,10].map(n => (
                <button
                  key={n}
                  type="button"
                  className={`qty-btn ${quantity === n ? 'active' : ''}`}
                  onClick={() => { setQuantity(n); setWarrantyQty(w => Math.min(w, n - 1)); }}
                >{n}</button>
              ))}
              <input
                type="number"
                min={1} max={20}
                value={quantity}
                onChange={e => {
                  const v = Math.max(1, Math.min(20, parseInt(e.target.value) || 1));
                  setQuantity(v);
                  setWarrantyQty(w => Math.min(w, v - 1));
                }}
                className="qty-input"
                title="Enter custom quantity (max 20)"
              />
            </div>

            {/* Warranty split — shown when more than 1 AC */}
            {quantity > 1 && (
              <div className="warranty-split">
                <div className="warranty-split-label">
                  Of these {quantity} ACs, how many are under warranty?
                </div>
                <div className="qty-row" style={{ marginTop: 8 }}>
                  {Array.from({ length: quantity }, (_, i) => i).map(n => (
                    <button
                      key={n}
                      type="button"
                      className={`qty-btn ${warrantyQty === n ? 'active warranty' : ''}`}
                      onClick={() => setWarrantyQty(n)}
                    >{n}</button>
                  ))}
                </div>
                {warrantyQty > 0 && (
                  <>
                    <div className="warranty-note">
                      {quantity - warrantyQty} regular complaint{quantity - warrantyQty !== 1 ? 's' : ''} + {warrantyQty} warranty complaint{warrantyQty !== 1 ? 's' : ''} will be logged.
                      Warranty complaints will use the AC Warranty nature automatically.
                    </div>
                    <div className="field" style={{ marginTop: 12 }}>
                      <label>Warranty Vendor <span style={{ color: '#64748b', fontWeight: 400 }}>(manufacturer handling the claim)</span></label>
                      <select
                        value={warrantyVendor}
                        onChange={e => setWarrantyVendor(e.target.value)}
                      >
                        <option value="">— Same as AMC vendor ({form.vendorName || 'none selected'}) —</option>
                        {[...new Set(products.map(p => p.vendor).filter(Boolean))].sort().map(v => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                      <p className="hint">Select the manufacturer handling the warranty claim.</p>
                    </div>
                  </>
                )}
                {warrantyQty === 0 && quantity > 1 && (
                  <p className="qty-note">{quantity} separate complaints will be logged — one per unit.</p>
                )}
              </div>
            )}
            {quantity === 1 && (
              <p className="qty-note" style={{ marginTop: 8 }}>1 complaint will be logged.</p>
            )}

            {/* Per-unit locations + nature — shown when logging multiple units */}
            {quantity > 1 && (
              <div className="unit-locations">
                <div className="unit-locations-title">
                  Unit Details
                  <span className="unit-locations-hint">Set location and, if different from the main selection above, the nature of complaint for each unit — shown in the escalation email</span>
                </div>
                <div className="unit-locations-grid">
                  {Array.from({ length: quantity }, (_, i) => (
                    <div key={i} className="unit-loc-row">
                      <span className="unit-loc-label">
                        Unit {i + 1}
                        {i >= quantity - warrantyQty && warrantyQty > 0 && <span className="unit-loc-warranty">W</span>}
                      </span>
                      <input
                        type="text"
                        className="unit-loc-input"
                        placeholder={form.productLocation || 'e.g. Ground Floor, Near Entrance…'}
                        value={unitLocations[i] !== undefined ? unitLocations[i] : ''}
                        onChange={e => {
                          const updated = Array.from({ length: quantity }, (_, j) =>
                            unitLocations[j] !== undefined ? unitLocations[j] : ''
                          );
                          updated[i] = e.target.value;
                          setUnitLocations(updated);
                        }}
                      />
                      <select
                        className="unit-loc-input"
                        style={{ marginTop: 6 }}
                        value={unitNatures[i] !== undefined ? unitNatures[i] : ''}
                        onChange={e => {
                          const updated = Array.from({ length: quantity }, (_, j) =>
                            unitNatures[j] !== undefined ? unitNatures[j] : ''
                          );
                          updated[i] = e.target.value;
                          setUnitNatures(updated);
                        }}
                      >
                        <option value="">— Same as main: {form.natureOfComplaint || 'none selected'} —</option>
                        {natures.map(n => (
                          <option key={n.nature} value={n.nature}>{n.nature}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <p className="unit-loc-hint-text">Leave blank to use the main location above for that unit.</p>
              </div>
            )}
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="btn-ghost" onClick={handleReset} disabled={submitting}>Clear Form</button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting
              ? (quantity > 1 ? `Logging ${quantity} cases…` : 'Logging…')
              : (quantity > 1 ? `Log ${quantity} Cases →` : 'Log Case →')}
          </button>
        </div>
      </form>
    </div>
  );
}
