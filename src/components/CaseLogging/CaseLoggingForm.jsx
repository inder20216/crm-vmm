import { useState, useEffect, useRef } from 'react';
import { vmm } from '../../api/vmm';

const ATTACHMENT_MANDATORY = ['Breakdown', 'Repair'];

function bufStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data))
    return new TextDecoder().decode(new Uint8Array(v.data));
  return String(v);
}

function ProductSearch({ products, value, vendorName, onChange, error, disabled }) {
  const [query,    setQuery]    = useState(value || '');
  const [open,     setOpen]     = useState(false);
  const [focused,  setFocused]  = useState(false);
  const wrapRef = useRef(null);

  const filtered = query.trim().length > 0
    ? products.filter(p =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        (p.vendor || '').toLowerCase().includes(query.toLowerCase())
      )
    : products;

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
              <span className="product-option-vendor">{p.vendor || '—'}</span>
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

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date) {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const emptyForm = {
  storeCode: '', storeName: '', storeEmail: '', fmEmail: '', city: '', region: '', state: '', zone: '',
  fmName: '', managerName: '', managerMobile: '',
  asmName: '', asmMobile: '',
  employeeCode: '', employeeName: '', contactNumber: '', designation: '',
  productName: '', vendorName: '', productType: '',
  natureOfComplaint: '', complaintType: '', tatDays: '',
  productLocation: '', remarks: '', attachments: [],
  source: '', emailSubject: '', callTxnId: '',
};

export default function CaseLoggingForm() {
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
  const [results,          setResults]          = useState([]);
  const [polishing,        setPolishing]        = useState(false);
  const [recentComplaints, setRecentComplaints] = useState([]);
  const [loadingRecent,    setLoadingRecent]    = useState(false);
  const [warrantyQty,      setWarrantyQty]      = useState(0);
  const [warrantyVendor,   setWarrantyVendor]   = useState('');
  const [showConfirm,      setShowConfirm]      = useState(false);

  const [products, setProducts]   = useState([]);
  const [natures, setNatures]     = useState([]);
  const [loadingRef, setLoadingRef] = useState(true);
  const storeTimer   = useRef(null);
  const employeeTimer = useRef(null);

  const today = new Date();
  const edc   = form.tatDays ? addDays(today, Number(form.tatDays)) : null;

  useEffect(() => {
    Promise.all([vmm.getProducts(), vmm.getNatures()])
      .then(([pRes, nRes]) => {
        setProducts(pRes.products || []);
        setNatures(nRes.natures   || []);
      })
      .catch(() => {})
      .finally(() => setLoadingRef(false));
  }, []);

  const fetchRecentComplaints = async (storeCode) => {
    setLoadingRecent(true);
    setRecentComplaints([]);
    try {
      const res = await vmm.getRecentComplaints(storeCode);
      setRecentComplaints((res.complaints || []).map(c => ({
        ...c,
        complaintno:     bufStr(c.complaintno),
        empname:         bufStr(c.empname),
        empcode:         bufStr(c.empcode),
        productname:     bufStr(c.productname),
        natureofproblem: bufStr(c.natureofproblem),
        typeofcomplaint: bufStr(c.typeofcomplaint),
        status:          bufStr(c.status),
      })));
    } catch { setRecentComplaints([]); }
    finally { setLoadingRecent(false); }
  };

  const lookupStore = async (codeOverride) => {
    const code = (codeOverride || form.storeCode || '').trim();
    if (!code) return;
    try {
      const res = await vmm.lookupStore(code);
      if (res.found && res.store) {
        const s = res.store;
        setForm(f => ({
          ...f,
          storeCode:     s.code,
          storeName:     s.name,
          storeEmail:    s.email          || '',
          fmEmail:       s.fmEmail        || '',
          city:          s.city           || '',
          region:        s.region         || '',
          state:         s.state          || '',
          zone:          s.zone           || '',
          fmName:        s.fmName         || '',
          managerName:   s.managerName    || '',
          managerMobile: s.managerMobile  || '',
          asmName:       s.asmName        || '',
          asmMobile:     s.asmMobile      || '',
        }));
        setStoreErr('');
        fetchRecentComplaints(s.code);
      } else {
        setForm(f => ({ ...f, storeName: '' }));
        setStoreErr('Store code not found. Please verify and try again.');
        setRecentComplaints([]);
      }
    } catch {
      setStoreErr('Unable to reach server. Please try again.');
    }
  };

  const lookupEmployee = async () => {
    if (!form.employeeCode.trim()) return;
    try {
      const res = await vmm.lookupEmployee(form.employeeCode.trim());
      if (res.found && res.employee) {
        const e = res.employee;
        // Fill employee fields + store fields available from the employee record
        setForm(f => ({
          ...f,
          employeeCode:  e.code,
          employeeName:  e.name,
          contactNumber: e.mobile      || '',
          designation:   e.designation || '',
          // Store fields from employee record
          storeCode:     e.storeCode   || f.storeCode,
          storeName:     e.storeName   || f.storeName,
          city:          e.city        || f.city,
          region:        e.region      || f.region,
          state:         e.state       || f.state,
          zone:          e.zone        || f.zone,
          managerName:   e.managerName || f.managerName,
          asmName:       e.asmName     || f.asmName,
          fmName:        e.fmName      || f.fmName,
        }));
        setStoreErr('');
        setMemberErr('');
        // If store code came from employee, fetch full store record + recent complaints
        const resolvedStoreCode = e.storeCode || form.storeCode;
        if (e.storeCode) {
          try {
            const sRes = await vmm.lookupStore(e.storeCode);
            if (sRes.found && sRes.store) {
              const s = sRes.store;
              setForm(f => ({
                ...f,
                fmEmail:       s.fmEmail       || f.fmEmail,
                fmMobile:      s.fmMobile      || f.fmMobile,
                managerMobile: s.managerMobile || f.managerMobile,
                asmMobile:     s.asmMobile     || f.asmMobile,
              }));
            }
          } catch {}
        }
        if (resolvedStoreCode) fetchRecentComplaints(resolvedStoreCode);
      } else {
        setForm(f => ({ ...f, employeeName: '', contactNumber: '' }));
        setMemberErr('Employee not found in registered member list. Cases can only be logged for registered members.');
      }
    } catch {
      setMemberErr('Unable to reach server. Please try again.');
    }
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
      if (res.success && res.polishedText) setForm(f => ({ ...f, remarks: res.polishedText }));
    } catch {}
    finally { setPolishing(false); }
  };

  const validate = () => {
    const e = {};
    if (!form.storeCode || !form.storeName)                  e.storeCode      = 'Valid store code is required';
    if (!form.employeeCode || !form.employeeName)            e.employeeCode   = 'Valid registered employee code is required';
    if (!form.contactNumber || !/^\d{10}$/.test(form.contactNumber)) e.contactNumber = 'Valid 10-digit contact number required';
    if (!form.productName)                                   e.productName    = 'Select a product';
    if (!form.natureOfComplaint)                             e.natureOfComplaint = 'Select nature of complaint';
    if (!form.productLocation.trim())                        e.productLocation = 'Product location is required';
    if (!form.remarks.trim())                                e.remarks         = 'Complaint description is required';
    if (!form.source)                                        e.source          = 'Select source of complaint';
    if (form.source === 'E-mail' && !form.emailSubject.trim()) e.emailSubject  = 'Email subject is required for E-mail complaints';
    if (form.source === 'Call'   && !form.callTxnId.trim())   e.callTxnId     = 'Call transaction ID is required for Call complaints';
    else if (form.source === 'Call' && !/^[A-Za-z0-9\-_]{4,40}$/.test(form.callTxnId.trim())) e.callTxnId = 'Transaction ID must be 4–40 alphanumeric characters (no spaces)';
    if (ATTACHMENT_MANDATORY.includes(form.complaintType) && form.attachments.length === 0 && !noImage)
      e.attachments = `At least 1 attachment is mandatory for ${form.complaintType} complaints (or check "No image available")`;
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    // Show confirmation step instead of submitting immediately
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
      vendorName:        form.vendorName,
      productType:       form.productType,
      natureOfComplaint: form.natureOfComplaint,
      complaintType:     form.complaintType,
      tatDays:           form.tatDays,
      productLocation:   form.productLocation,
      remarks:           form.remarks,
      source:            form.source,
      emailSubject:      form.emailSubject,
      callTxnId:         form.callTxnId,
      uid: 1,
    };
    try {
      const qty         = Math.max(1, Math.min(quantity, 20));
      const wQty        = Math.max(0, Math.min(warrantyQty, qty - 1));
      const regularQty  = qty - wQty;
      const allResults  = [];

      const getUnitLoc = (i) => (unitLocations[i] && unitLocations[i].trim()) || form.productLocation;

      // Log regular complaints
      for (let i = 0; i < regularQty; i++) {
        const res = await vmm.logComplaint({ ...payload, productLocation: getUnitLoc(i) });
        if (res.success) allResults.push({ ...res, _type: 'regular', productLocation: getUnitLoc(i), _vendorName: payload.vendorName });
        else { setSubmitErr(`Failed on complaint ${i + 1}: ${res.message || 'Unknown error'}`); break; }
      }
      // Log warranty complaints with AC Warranty nature (if any)
      if (allResults.length === regularQty && wQty > 0) {
        const warrantyNature = natures.find(n => /warranty/i.test(n.nature) && /hvac|ac/i.test(n.nature)) || {};
        const warrantyPayload = {
          ...payload,
          vendorName:        warrantyVendor.trim() || payload.vendorName,
          natureOfComplaint: warrantyNature.nature || 'AC - Warranty',
          complaintType:     warrantyNature.type   || 'Warranty',
          tatDays:           warrantyNature.tatDays || 30,
        };
        for (let i = 0; i < wQty; i++) {
          const loc = getUnitLoc(regularQty + i);
          const res = await vmm.logComplaint({ ...warrantyPayload, productLocation: loc });
          if (res.success) allResults.push({ ...res, _type: 'warranty', productLocation: loc, _vendorName: warrantyPayload.vendorName });
          else { setSubmitErr(`Failed on warranty complaint ${i + 1}: ${res.message || 'Unknown error'}`); break; }
        }
      }

      if (allResults.length === qty) {
        // Send ONE consolidated escalation email for all units
        vmm.sendEscalationEmail({
          storeEmail:   form.storeEmail,
          fmEmail:      form.fmEmail,
          storeName:    form.storeName,
          storeCode:    form.storeCode,
          vendorName:   form.vendorName,
          productName:  form.productName,
          complaints:   allResults.map(r => ({
            complaintno:     r.complaintno,
            productLocation: r.productLocation,
            edcDate:         r.edcDate,
            type:            r._type,
            vendorName:      r._vendorName,
          })),
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
    setPolishing(false);
    setRecentComplaints([]);
  };

  // AC/HVAC product detection — quantity and warranty only apply to these
  const isAcProduct = /\bac\b/i.test(form.productName) || /hvac/i.test(form.productType) || /air.?con/i.test(form.productName);

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
                { label: 'Source',          val: form.source + (form.callTxnId ? ` · TXN: ${form.callTxnId}` : form.emailSubject ? ` · ${form.emailSubject}` : '') },
                { label: 'Product',         val: form.productName },
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

            {/* Employee Code — PRIMARY */}
            <div className="search-block">
              <label className="search-label">
                Employee Code
                <span className="search-badge recommended">Recommended</span>
                {form.employeeName && <span className="search-badge filled">✓ Filled</span>}
                {!form.employeeName && (errors.employeeCode || memberErr) && <span className="search-badge missing">Required</span>}
              </label>
              <div className="search-input-wrap">
                <input
                  type="text"
                  className={`search-input ${memberErr || errors.employeeCode ? 'err' : form.employeeName ? 'filled' : ''}`}
                  placeholder="e.g. 6066822…"
                  value={form.employeeCode}
                  onChange={e => {
                    const val = e.target.value;
                    setForm(f => ({ ...f, employeeCode: val, employeeName: '', contactNumber: '' }));
                    setMemberErr('');
                    clearTimeout(employeeTimer.current);
                    if (val.trim().length >= 4) employeeTimer.current = setTimeout(lookupEmployee, 600);
                  }}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), lookupEmployee())}
                />
                <button type="button" className="search-btn" onClick={lookupEmployee}>Search</button>
              </div>
              {(memberErr || errors.employeeCode) && <p className="search-err">{memberErr || errors.employeeCode}</p>}
              <p className="search-hint">Fills store + employee details in one step</p>
            </div>

            <div className="search-sep" />

            {/* Store Code — SECONDARY */}
            <div className="search-block">
              <label className="search-label">
                Store Code
                <span className="search-badge secondary">If employee code unavailable</span>
                {form.storeName && !form.employeeName && <span className="search-badge filled">✓ Store filled</span>}
                {!form.storeName && (errors.storeCode || storeErr) && <span className="search-badge missing">Required</span>}
              </label>
              <div className="search-input-wrap">
                <input
                  type="text"
                  className={`search-input ${storeErr || errors.storeCode ? 'err' : form.storeName ? 'filled' : ''}`}
                  placeholder="e.g. SA06, HP10…"
                  value={form.storeCode}
                  onChange={e => {
                    const val = e.target.value;
                    setForm(f => ({ ...f, storeCode: val, storeName: '' }));
                    setStoreErr('');
                    clearTimeout(storeTimer.current);
                    if (val.trim().length >= 3) storeTimer.current = setTimeout(() => lookupStore(val.trim()), 600);
                  }}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), lookupStore())}
                />
                <button type="button" className="search-btn" onClick={lookupStore}>Search</button>
              </div>
              {(storeErr || errors.storeCode) && <p className="search-err">{storeErr || errors.storeCode}</p>}
              <p className="search-hint">Fills store details only — employee code still required</p>
            </div>

          </div>

          {/* Inline warning when store filled but employee still missing */}
          {form.storeName && !form.employeeName && (
            <div className="search-warning">
              ⚠ Store found. Please also search by Employee Code to fill complainant details.
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

        {/* Recent Complaints panel — shown after store/employee is identified */}
        {(loadingRecent || recentComplaints.length > 0) && (
          <div className="recent-complaints-card">
            <div className="rc-header">
              <span className="rc-title">Recent Complaints — {form.storeCode}</span>
              {loadingRecent && <span className="rc-loading">Fetching…</span>}
              {!loadingRecent && <span className="rc-count">{recentComplaints.length} found</span>}
            </div>
            {!loadingRecent && recentComplaints.length === 0 && (
              <div className="rc-empty">No complaints logged for this store yet.</div>
            )}
            {!loadingRecent && recentComplaints.length > 0 && (
              <div className="rc-table-wrap">
                <table className="rc-table">
                  <thead>
                    <tr>
                      <th>Complaint No</th>
                      <th>Employee</th>
                      <th>Product</th>
                      <th>Nature</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentComplaints.map((c, i) => (
                      <tr key={i}>
                        <td><span className="rc-badge">{c.complaintno || `#${c.complaintid}`}</span></td>
                        <td>
                          <div className="rc-emp">{c.empname || '—'}</div>
                          <div className="rc-sub">{c.empcode}</div>
                        </td>
                        <td>{c.productname || '—'}</td>
                        <td>{c.natureofproblem || '—'}</td>
                        <td>{c.typeofcomplaint || '—'}</td>
                        <td><span className={`rc-status ${(c.status || '').toLowerCase()}`}>{c.status || 'Logged'}</span></td>
                        <td>{c.created ? new Date(c.created).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Source of Complaint */}
        <div className="card">
          <h3 className="card-title">
            Source of Complaint <span className="req">*</span>
          </h3>
          <div className="source-options">
            {['E-mail', 'Call'].map(src => (
              <label key={src} className={`source-option ${form.source === src ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="source"
                  value={src}
                  checked={form.source === src}
                  onChange={() => setForm(f => ({ ...f, source: src, emailSubject: '', callTxnId: '' }))}
                />
                <span className="source-icon">
                  {src === 'E-mail' ? '✉' : src === 'Call' ? '📞' : '⚡'}
                </span>
                <span className="source-label">{src}</span>
              </label>
            ))}
          </div>
          {errors.source && <p className="err-msg">{errors.source}</p>}

          {form.source === 'E-mail' && (
            <div className="field" style={{ marginTop: 14 }}>
              <label>Email Subject <span className="req">*</span></label>
              <input
                type="text"
                placeholder="e.g. AC not working at Ground Floor — VIZAINAGARAM"
                value={form.emailSubject}
                onChange={e => setForm(f => ({ ...f, emailSubject: e.target.value }))}
                className={errors.emailSubject ? 'err' : ''}
              />
              {errors.emailSubject && <p className="err-msg">{errors.emailSubject}</p>}
            </div>
          )}

          {form.source === 'Call' && (
            <div className="field" style={{ marginTop: 14 }}>
              <label>Call Transaction ID <span className="req">*</span></label>
              <input
                type="text"
                placeholder="e.g. TXN202505210001"
                value={form.callTxnId}
                onChange={e => setForm(f => ({ ...f, callTxnId: e.target.value }))}
                className={errors.callTxnId ? 'err' : ''}
              />
              {errors.callTxnId && <p className="err-msg">{errors.callTxnId}</p>}
            </div>
          )}
        </div>

        {/* Complaint Details */}
        <div className="card">
          <h3 className="card-title">Complaint Details</h3>
          {loadingRef && <p className="hint">Loading product and nature lists…</p>}
          <div className="field-row">
            <div className="field">
              <label>Product Name <span className="req">*</span></label>
              <ProductSearch
                products={products}
                value={form.productName}
                vendorName={form.vendorName}
                onChange={p => setForm(f => ({ ...f, productName: p.name, vendorName: p.vendor || '', productType: p.category || '' }))}
                error={!!errors.productName}
                disabled={loadingRef}
              />
              {errors.productName && <p className="err-msg">{errors.productName}</p>}
            </div>
            <div className="field">
              <label>Vendor Name</label>
              <input type="text" value={form.vendorName} readOnly placeholder="Auto-filled on product select" className="readonly" />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Nature of Complaint <span className="req">*</span></label>
              <select value={form.natureOfComplaint} onChange={handleNatureChange} className={errors.natureOfComplaint ? 'err' : ''} disabled={loadingRef}>
                <option value="">— Select Nature of Complaint —</option>
                {natures.map(n => (
                  <option key={n.nature} value={n.nature}>{n.nature}</option>
                ))}
              </select>
              {errors.natureOfComplaint && <p className="err-msg">{errors.natureOfComplaint}</p>}
            </div>
            <div className="field">
              <label>Product Location in Store <span className="req">*</span></label>
              <input
                type="text"
                placeholder="e.g. Ground Floor, Near Entrance"
                value={form.productLocation}
                onChange={e => setForm(f => ({ ...f, productLocation: e.target.value }))}
                className={errors.productLocation ? 'err' : ''}
              />
              {errors.productLocation && <p className="err-msg">{errors.productLocation}</p>}
            </div>
          </div>
          <div className="field">
            <div className="remarks-label-row">
              <label>Complaint Remarks / Description <span className="req">*</span></label>
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
            <textarea
              rows={4}
              placeholder="Describe the issue in detail — you can write in English or Hinglish, the AI will clean it up."
              value={form.remarks}
              onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
              className={`remarks-textarea ${errors.remarks ? 'err' : ''}`}
            />
            {errors.remarks && <p className="err-msg">{errors.remarks}</p>}
            <p className="hint">Click "AI Polish" to professionally rewrite the text.</p>
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

        {/* Attachments */}
        <div className="card">
          <h3 className="card-title">
            Attachments
            {ATTACHMENT_MANDATORY.includes(form.complaintType) && !noImage && (
              <span className="mandatory-tag">Mandatory for {form.complaintType}</span>
            )}
          </h3>
          {!noImage && (
            <>
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.pdf"
                multiple
                onChange={e => setForm(f => ({ ...f, attachments: Array.from(e.target.files) }))}
                className={errors.attachments ? 'err' : ''}
              />
              <p className="hint">Accepted: JPG, PNG, PDF</p>
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
              onChange={e => { setNoImage(e.target.checked); setForm(f => ({ ...f, attachments: [] })); }}
            />
            No image available / will be shared later
          </label>
          {errors.attachments && <p className="err-msg">{errors.attachments}</p>}
        </div>

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

            {/* Per-unit locations — shown when logging multiple units */}
            {quantity > 1 && (
              <div className="unit-locations">
                <div className="unit-locations-title">
                  Unit Locations
                  <span className="unit-locations-hint">Specify where each AC is installed — shown in the escalation email</span>
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
