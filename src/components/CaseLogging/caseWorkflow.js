// Shared VMM complaint-workflow rules used by New Case and the Email Inbox wizard.
// Keep this file in sync with the facility portal behaviour documented in
// docs/NEW_CASE_LOGGING_GUIDE.md.

export const ATTACHMENT_MANDATORY = ['Breakdown', 'Repair'];

export const COMPLAINT_STEPS = [
  { name: 'Product',   sub: 'Select specific item' },
  { name: 'Category',  sub: 'Select the category' },
  { name: 'Complaint', sub: 'Nature of issue' },
  { name: 'Warranty',  sub: 'AMC/Warranty status' },
  { name: 'Vendor',    sub: 'Brand or vendor name' },
  { name: 'Location',  sub: 'Where in the store?' },
  { name: 'Photos',    sub: 'Photos / files' },
  { name: 'Remarks',   sub: 'Describe the problem' },
  { name: 'Review',    sub: 'Check & submit' },
];

export function norm(s) { return (s || '').trim().toLowerCase(); }

// Products whose AMC vendor is store-wise — mapped to vmm_amc_vendors service types.
export const PRODUCT_AMC_SERVICE = {
  'ac':             'AC AMC',
  'server room ac': 'AC AMC',
  'lift':           'Lift AMC',
  'escalator':      'Lift AMC',
  'pest control':   'Pest Control AMC',
};
export const AMC_LOOKUP_PRODUCTS = new Set(Object.keys(PRODUCT_AMC_SERVICE));

// Products with one fixed, known vendor — no per-store lookup needed.
export const FIXED_VENDOR_PRODUCTS = { sensormatic: 'Adtech' };
export const getFixedVendor = (name) => FIXED_VENDOR_PRODUCTS[norm(name)] || null;

// Products routed straight to Facility Manager / HO Team — no vendor needed.
export const HO_DIRECT_PRODUCTS = new Set([
  'acp', 'baggage rack', 'carpet', 'cash drawer', 'cctv', 'chair', 'civil work',
  'diesel motor', 'digital video recorder', 'door', 'drainage', 'drawer',
  'electrical', 'emergency bulb', 'exhaust fan', 'fan', 'fire equipment', 'fire hydrant',
  'fly catcher', 'genset battery', 'glass', 'glass door', 'glow sign board', 'lift battery',
  'lights', 'lock', 'mirror', 'mobile', 'music system', 'paint work',
  'queue manager', 'railing', 'ramp', 'shutter', 'speaker', 'submersible pump',
  'table', 'tiles', 'transformer', 'trial room', 'trolley', 'washroom',
  'water meter', 'water motor', 'water pipe', 'water tank', 'wooden work',
]);

// Products where vendor is optional — agent checks a sticker on the unit.
export const FIRE_PRODUCTS = new Set([
  'fire alarm', 'fire exit door', 'fire exit key box', 'fire extinguisher',
  'fire hooter', 'fire panel', 'fire alarm panel', 'fire pump',
  'fire sprinkler', 'sprinkler system', 'fire water motor', 'fire water tank',
  'hose reel', 'smoke detector',
]);

// Warranty brand lists — product→brand mapping used by the facility portal.
export const WARRANTY_VENDORS = [
  'Adtech', 'Ahuja', 'Arihant Infocoom', 'Blue Star', 'Carrier', 'Consul Neowatt',
  'Ece', 'Euronics', 'Fuji Tech', 'Godrej', 'Gunnebo', 'Hitachi', 'Hublit',
  'Jindal Electric', 'Johnson', 'Kirloskar', 'Kone', 'Krykard Atandra', 'Mitsubishi',
  'Mitzvah', 'Neptune', 'Omega', 'Otis Elevator', 'Pie Industries', 'Schindler',
  'Tk Elevator', 'Viewon', 'Western Control And Automation',
];

export const PRODUCT_VENDORS = {
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

export const getVendorsForProduct = (name) => PRODUCT_VENDORS[norm(name)] || WARRANTY_VENDORS;
export const getAmcServiceType = (name) => PRODUCT_AMC_SERVICE[norm(name)] || null;
export const isAmcLookupProduct = (name) => AMC_LOOKUP_PRODUCTS.has(norm(name));
export const isHoDirectProduct  = (name) => HO_DIRECT_PRODUCTS.has(norm(name));
export const isFireProductName  = (name) => FIRE_PRODUCTS.has(norm(name));
export const isGensetProduct    = (name) => norm(name) === 'genset';

// Portal rule: temperature nature applies only to AC / Server Room AC.
const TEMP_PRODUCTS = new Set(['ac', 'server room ac']);
export const showsTemperatureOption = (name) => TEMP_PRODUCTS.has(norm(name));
export const isTemperatureNature = (name) => norm(name).includes('temperature');

// Portal routing — these products skip Warranty/Vendor in the normal way.
export function getAutoWarranty(name) {
  if (getFixedVendor(name))   return 'N/A — Fixed Vendor';
  if (isHoDirectProduct(name)) return 'N/A — HO Direct';
  if (isGensetProduct(name))   return 'N/A — Genset';
  if (isFireProductName(name)) return 'N/A — Local Vendor';
  return '';
}
export const isAutoRoutedProduct = (name) => !!getAutoWarranty(name);
export const isVendorOwnedProduct = (name) => isAutoRoutedProduct(name) || isAmcLookupProduct(name);
export const AUTO_WARRANTY_VALUES = new Set([
  'N/A — Fixed Vendor', 'N/A — HO Direct', 'N/A — Genset', 'N/A — Local Vendor',
]);

// The wizard shows New Case labels; logComplaint keeps the email API contract.
export const WARRANTY_LABELS = ['Under Warranty', 'Under AMC', 'Not Applicable'];
export const CONTRACT_TO_WARRANTY = {
  AMC: 'Under AMC',
  Warranty: 'Under Warranty',
  NotApplicable: 'Not Applicable',
};
export const WARRANTY_TO_CONTRACT = {
  'Under AMC': 'AMC',
  'Under Warranty': 'Warranty',
  'Not Applicable': 'NotApplicable',
};
export const toWarrantyLabel = (contractType) => CONTRACT_TO_WARRANTY[contractType] || '';
export const toContractType = (warranty) => WARRANTY_TO_CONTRACT[warranty] || 'NotApplicable';

export function createWfState() {
  return { category: '', warranty: '', vendorQuery: '', vendorFreeText: '', noneBrand: '' };
}

// Store-wise AMC vendors from the live vmm_amc_vendors rows.
export function getStoreAmcVendors(amcRows, storeCode, productName) {
  const serviceType = getAmcServiceType(productName);
  if (!storeCode || !serviceType) return [];
  const code = String(storeCode).trim().toUpperCase();
  return [...new Set((amcRows || [])
    .filter(r => r.serviceType === serviceType && String(r.storeCode).trim().toUpperCase() === code)
    .map(r => r.vendorName)
    .filter(Boolean))];
}

// Resolve the escalation recipient directly from the live store-wise AMC rows.
// Used by both New Case and the Email Inbox so preview and send agree.
export function resolveStoreAmcVendor(amcRows, storeCode, productName, vendorName) {
  const serviceType = getAmcServiceType(productName);
  if (!storeCode || !serviceType) return null;

  const code = String(storeCode).trim().toUpperCase();
  const rows = (amcRows || []).filter(r =>
    r.serviceType === serviceType && String(r.storeCode).trim().toUpperCase() === code
  );
  if (!rows.length) return null;

  // If the wizard already chose a vendor, prefer that row; otherwise use the
  // first AMC row for the store. Partial names cover abbreviated sheet entries.
  const wanted = norm(vendorName);
  const row = (wanted && rows.find(r => norm(r.vendorName) === wanted))
    || (wanted && rows.find(r => {
      const name = norm(r.vendorName);
      return name.includes(wanted) || wanted.includes(name);
    }))
    || rows[0];

  // Excel uses commas, semicolons and sometimes " / " between addresses.
  // Drop non-email values such as "www.otis.com" so Graph never gets a bad To.
  const emails = [...new Set(String(row.vendorEmail || '')
    .split(/[,;/]/)
    .map(e => e.trim())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
  if (!emails.length) return null;

  return {
    email: emails.join(', '),
    name: row.vendorName || vendorName || serviceType,
    source: `${serviceType} — store ${code}`,
  };
}

export function catalogOptions(products) {
  const categories = [...new Set((products || []).map(p => p.category).filter(Boolean))].sort();
  const vendors = [...new Set((products || []).map(p => p.vendor).filter(Boolean))].sort();
  return { categories, vendors };
}
