import { useState, useEffect, useRef } from 'react';
import { vmm } from '../api/vmm';
import { useAuth } from '../context/AuthContext';
import { HO_POC } from '../auth/escalationMatrix';
import { searchSentEmails, replyOnThread } from '../auth/graphService';
import { mergeNatures } from '../data/natures';
import { useAmcVendors } from '../hooks/useAmcVendors';
import EmailComplaintWizard from '../components/CaseLogging/EmailComplaintWizard';
import { buildReplyPreview, buildReplyHtml, buildMissingInfoReply, hasMissingInfoReply, MISSING_INFO_MARKER } from '../workflow/emailPipeline';
import {
  ATTACHMENT_MANDATORY, WARRANTY_LABELS, getAutoWarranty, getFixedVendor,
  isHoDirectProduct, isGensetProduct, isTemperatureNature, showsTemperatureOption,
  toContractType, toWarrantyLabel, norm, resolveStoreAmcVendor,
} from '../components/CaseLogging/caseWorkflow';
import './EmailComplaints.css';

function fmtTime(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

// AI parsing is best-effort. Accept common response aliases and fall back to the
// email body so the shared employee fields are still filled when the webhook
// misses them.
function extractEmployeeFields(res = {}, bodyText = '') {
  const provided = res.alreadyProvided || {};
  const employee = res.employee || {};

  const code = firstNonEmpty(
    res.employeeCode, res.empCode, res.employeeId, res.employee_id,
    employee.code, provided.employeeCode, provided.empCode
  ).toUpperCase().replace(/\s+/g, '');

  const name = firstNonEmpty(
    res.employeeName, res.empName, employee.name, provided.employeeName
  );

  const rawContact = firstNonEmpty(
    res.contactNumber, res.contactNo, res.contact_no, res.contact,
    res.mobile, res.phone, res.phoneNumber, employee.mobile,
    provided.contactNumber, provided.contact, provided.mobile
  );

  const employeeEmail = firstNonEmpty(
    res.employeeEmail, res.empEmail, employee.email, provided.employeeEmail
  );

  const plain = (bodyText || '').replace(/<[^>]*>/g, ' ');
  const codeHit = plain.match(/\b(?:employee|emp\.?|staff)\s*(?:code|id|no\.?|number)?\s*[-:]?\s*([A-Z]{0,3}\d{3,7})\b/i);
  const bodyCode = codeHit ? codeHit[1].toUpperCase() : '';

  const contactHit = plain.match(/(?:contact(?:\s*(?:no\.?|number))?|mob(?:ile)?|phone(?:\s*no\.?)?)(?:\s+is)?\s*[-:]?\s*([+]?\d[\d\s()-]{7,16}\d)/i);
  let bodyContact = '';
  if (contactHit) {
    const digits = contactHit[1].replace(/\D/g, '');
    if (digits.length >= 10) bodyContact = digits.slice(-10);
  }

  // AI often omits the employee entirely. A store email is normally signed with
  // just a name, so keep those names/emails as hints for the store fallback.
  const nameHints = [];
  const emailHints = [];
  const cleanName = (value) => String(value || '')
    .replace(/^[\s*#>•\-–—]+/, '')
    .replace(/[\s,;:|\-–—]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 60);
  const addName = (value) => {
    const hint = cleanName(value);
    if (hint.length < 2 || /^(team|support|helpdesk|regards|thanks|thank you)$/i.test(hint)) return;
    if (!nameHints.some(n => n.toLowerCase() === hint.toLowerCase())) nameHints.push(hint);
  };

  const namedField = /(?:employee|emp\.?|staff)\s*name\s*[-:]\s*([^\n\r|<]{2,60})/gi;
  let m;
  while ((m = namedField.exec(plain))) addName(m[1]);
  const signature = /(?:regards|thanks|thank\s+you|sincerely|yours\s+faithfully)[,\s]*[\r\n]+([^\r\n]{2,60})/gi;
  while ((m = signature.exec(plain))) addName(m[1]);
  addName(name);

  const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  while ((m = emailRe.exec(plain))) {
    const address = m[0].toLowerCase();
    if (/helpdesk|no-?reply|openmind\.in/.test(address)) continue;
    if (!emailHints.includes(address)) emailHints.push(address);
  }
  if (employeeEmail && !emailHints.includes(employeeEmail.toLowerCase())) emailHints.unshift(employeeEmail.toLowerCase());

  const contactDigits = rawContact.replace(/\D/g, '');
  return {
    employeeCode: code || bodyCode,
    employeeName: name || nameHints[0] || '',
    employeeEmail,
    contactNumber: contactDigits.length >= 10 ? contactDigits.slice(-10) : (rawContact || bodyContact),
    nameHints,
    emailHints,
  };
}

function normEmployeeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function employeeNameScore(candidateName, hints = []) {
  const candidate = normEmployeeText(candidateName);
  if (!candidate) return 0;
  let best = 0;
  for (const raw of hints) {
    const hint = normEmployeeText(raw);
    if (!hint) continue;
    if (hint === candidate) best = Math.max(best, 80);
    else if (hint.includes(candidate) || candidate.includes(hint)) best = Math.max(best, 55);
    else {
      const overlap = candidate.split(' ').filter(t => t.length > 2 && hint.split(' ').includes(t)).length;
      if (overlap) best = Math.max(best, Math.min(80, 35 * overlap));
    }
  }
  return best;
}

function employeeDesignationScore(designation = '') {
  const value = String(designation || '').toLowerCase();
  if (/store\s*manager|^\s*sm\b/.test(value)) return 24;
  if (/\basm\b|assistant\s*manager/.test(value)) return 18;
  if (/manager/.test(value)) return 14;
  if (/store\s*person|sales|executive/.test(value)) return 8;
  return 0;
}

// Choose the best employee for a store when the AI provides no code or mobile.
// Exact email/mobile/signature-name matches win; otherwise prefer an active
// store-manager row so a generic store mailbox still produces useful values.
function pickEmployeeForStore(employees, { storeCode = '', emails = [], names = [], mobiles = [] } = {}) {
  const store = String(storeCode || '').trim().toUpperCase();
  const emailSet = emails.filter(Boolean).map(e => String(e).trim().toLowerCase());
  const nameList = names.filter(Boolean);
  const mobileSet = mobiles
    .map(m => String(m || '').replace(/\D/g, ''))
    .filter(m => m.length >= 10)
    .map(m => m.slice(-10));
  const list = Array.isArray(employees) ? employees : [];

  let candidates = store
    ? list.filter(e => String(e?.storeCode || '').trim().toUpperCase() === store)
    : [];
  if (!candidates.length && emailSet.length) {
    const prefixes = emailSet
      .map(e => e.split('@')[0].split('.')[0].toUpperCase())
      .filter(p => /^[A-Z]{2}\d{2,3}$/.test(p));
    candidates = list.filter(e => prefixes.includes(String(e?.storeCode || '').trim().toUpperCase()));
  }
  if (!candidates.length) return null;

  let best = null;
  let bestScore = -1;
  for (const emp of candidates) {
    let score = 0;
    const empEmail = String(emp?.email || '').trim().toLowerCase();
    if (empEmail && emailSet.includes(empEmail)) score += 90;
    const empMobile = String(emp?.mobile || '').replace(/\D/g, '');
    if (empMobile && mobileSet.includes(empMobile.slice(-10))) score += 80;
    score += employeeNameScore(emp?.name, nameList);
    const active = String(emp?.status || '').toLowerCase() === 'active';
    score += active ? (score ? 8 : 20) : (score ? 2 : 5);
    score += employeeDesignationScore(emp?.designation);
    if (score > bestScore) { bestScore = score; best = emp; }
  }
  return bestScore > 0 ? best : null;
}

const HO_EMAIL = 'ho.vmm@openmind.in';

const DELAY_REASONS = {
  'Delay From Vendor Side': [
    { label: 'Quotation / Field Service Report not received from vendor', tat: 1 },
    { label: 'Material or Parts Not Available',                           tat: 3 },
    { label: 'Under Transit',                                             tat: 3 },
    { label: 'Work in progress',                                          tat: 1 },
    { label: 'Vendor Is Not Responding',                                  tat: 1 },
    { label: 'Vendor Visit Pending',                                      tat: 2 },
  ],
  'Delay From HO Team': [
    { label: 'Quotation Approval Pending',  tat: 1    },
    { label: 'Delay In Release Of PO',      tat: 2    },
    { label: 'Delay Due To Landlord',       tat: 15   },
    { label: 'Delay Due To Lapse Of AMC',   tat: 3    },
    { label: 'Vendor details not provided', tat: 2    },
    { label: 'Payment under process',       tat: null },
    { label: 'Vendor Has Payment Issues',   tat: 2    },
    { label: 'Under Transit',               tat: 3    },
    { label: 'Material To Be Dispatched',   tat: 2    },
  ],
  'Work Is Delayed Due To FM': [
    { label: 'Local vendor or Quotation is being arranged', tat: 2 },
    { label: 'Site inspection pending',                     tat: 2 },
    { label: 'Facility Manager is not responding',          tat: 1 },
  ],
  'Delay From Store': [
    { label: 'Store has rescheduled the work', tat: 3 },
    { label: 'Product under observation',       tat: 1 },
    { label: 'Store is not responding',         tat: 1 },
  ],
};

function matchDelaySub(stored, mainCat) {
  if (!stored) return '';
  const opts = DELAY_REASONS[mainCat] || [];
  if (opts.find(o => o.label === stored)) return stored;
  const lower = stored.toLowerCase();
  const ci = opts.find(o => o.label.toLowerCase() === lower);
  return ci ? ci.label : '';
}

const REQUIRED_FIELDS = ['storeCode'];
// Set false to keep the missing-details draft manual during testing/troubleshooting.
const AUTO_MISSING_INFO_REPLY = true;
const FIELD_LABELS = {
  storeCode: 'Store Code', employeeCode: 'Employee Code', employeeName: 'Employee Name',
  employeeEmail: 'Employee Email', contactNumber: 'Contact Number',
};

// One complaint = one independent copy of the New Case 9-step wizard.
function makeComplaintItem(id, overrides = {}) {
  return {
    id,
    productName: '', aiProductName: '', productUnmatched: false,
    productShortName: '', category: '', productType: '',
    natureOfProblem: '', complaintType: '', tatDays: '',
    warranty: '', contractType: '', vendorName: '', vendorEmail: '',
    productLocation: '', description: '',
    vendorQuery: '', vendorFreeText: '', noneBrand: '', gensetChoice: '',
    amcAutoFillKey: '', amcLookup: 'idle',
    selectedAttachIndices: null, localAttachments: [], noImage: false,
    extraEscTo: '', extraEscCc: '', removedAutoCC: [],
    ...overrides,
  };
}

function hydrateComplaintItem(id, p, products, natures, overrides = {}) {
  const productName = p?.productName || '';
  const matchedProduct = findBestByText(products, productName, ['name']);
  const matchedNature  = findBestByText(natures, p?.natureOfProblem || '', ['nature']);
  // Only a real product-master row can be shown as a dropdown selection. An
  // unmatched AI value is kept separately for the warning and left unselected.
  const name = matchedProduct?.name || '';
  // Respect an explicit flag set by the reconciliation layer. Otherwise only
  // flag a missing product when the master list was available to compare
  // against — an empty list means "cannot verify", not "not found".
  const productUnmatched = p?.productUnmatched === undefined
    ? (!!(products || []).length && !!productName && !matchedProduct)
    : !!p.productUnmatched;
  const auto = getAutoWarranty(name);
  const rawWarranty = p?.warranty || toWarrantyLabel(p?.contractType);
  const warranty = auto || (WARRANTY_LABELS.includes(rawWarranty) ? rawWarranty : '');
  let vendorName = p?.vendorName || '';
  if (!vendorName && auto && getFixedVendor(name)) vendorName = getFixedVendor(name);
  if (!vendorName && isHoDirectProduct(name)) vendorName = 'N/A — HO Direct';

  // Portal rule: temperature natures are AC / Server Room AC only. If the AI
  // returns one for another product, drop it so the agent must pick a valid nature.
  const rawNature = matchedNature?.nature || p?.natureOfProblem || '';
  const nature = (!showsTemperatureOption(name) && isTemperatureNature(rawNature)) ? '' : rawNature;

  return makeComplaintItem(id, {
    productName: name,
    aiProductName: p?.aiProductName || (productUnmatched ? productName : ''),
    productUnmatched,
    productShortName: matchedProduct?.shortName || p?.productShortName || '',
    category: matchedProduct?.category || p?.category || '',
    productType: matchedProduct?.category || p?.productType || '',
    natureOfProblem: nature,
    complaintType: nature ? (matchedNature?.type || p?.complaintType || '') : '',
    tatDays: nature ? (matchedNature?.tatDays ?? p?.tatDays ?? '') : '',
    warranty,
    contractType: warranty ? toContractType(warranty) : (p?.contractType || ''),
    vendorName,
    vendorEmail: p?.vendorEmail || '',
    productLocation: p?.productLocation || '',
    description: p?.description || '',
    extraEscTo: p?.extraEscTo || '',
    extraEscCc: p?.extraEscCc || '',
    removedAutoCC: p?.removedAutoCC || [],
    ...overrides,
  });
}

function camelToLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

function normalizeText(value) {
  return (value || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function inferTagFromCategories(cats) {
  if (!cats || !cats.length) return null;
  if (cats.some(c => c === 'Case Logged'))  return { type: 'logged',    label: 'Case Logged' };
  if (cats.some(c => c === 'Escalated'))    return { type: 'escalated', label: 'Escalated' };
  if (cats.some(c => c === 'Case Closed'))  return { type: 'closed',    label: 'Case Closed' };
  if (cats.some(c => c === 'Case Updated')) return { type: 'updated',   label: 'Case Updated' };
  if (cats.some(c => c === 'WIP'))          return { type: 'wip',       label: 'In Progress' };
  const extra = cats.filter(c => c !== 'New CRM');
  if (extra.length) return { type: 'other', label: extra.join(', ') };
  return null;
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Build one readable transcript from every message in the conversation. The
// newest store/customer replies often contain the missing code, mobile, product
// or remark, so the AI must see the whole thread rather than only the selected
// message. `uniqueBodyHtml` is preferred when n8n provides it to avoid repeating
// quoted history inside every message.
function buildFullEmailThreadText(selected = {}, messages = []) {
  const address = (name, addr) => {
    const n = String(name || '').trim();
    const a = String(addr || '').trim();
    if (n && a) return `${n} <${a}>`;
    return n || a || '';
  };

  const sorted = [...(messages || [])].sort((a, b) => {
    const da = new Date(a?.receivedDateTime || a?.receivedAt || a?.sentDateTime || 0).getTime() || 0;
    const db = new Date(b?.receivedDateTime || b?.receivedAt || b?.sentDateTime || 0).getTime() || 0;
    return da - db;
  });

  const blocks = sorted.map((m, i) => {
    const body = stripHtml(m?.uniqueBodyHtml || m?.body || m?.bodyHtml || m?.bodyPreview || '');
    return [
      `[EMAIL ${i + 1}]`,
      `From: ${m?.fromDisplay || address(m?.fromName, m?.from)}`,
      `To: ${m?.toFull || m?.to || ''}`,
      `Cc: ${m?.ccFull || m?.cc || ''}`,
      `Date: ${m?.receivedDateTime || m?.receivedAt || ''}`,
      `Subject: ${m?.subject || selected?.subject || ''}`,
      '',
      body || '(No content)',
    ].join('\n');
  });

  const selectedBody = stripHtml(selected?.body || selected?.bodyHtml || selected?.bodyPreview || '');
  const signature = selectedBody.slice(0, 160);
  if (selectedBody && !blocks.some(b => signature && b.includes(signature))) {
    blocks.push([
      '[SELECTED EMAIL]',
      `From: ${selected?.fromDisplay || address(selected?.fromName, selected?.fromAddr)}`,
      `To: ${selected?.toDisplay || selected?.to || ''}`,
      `Cc: ${selected?.ccDisplay || selected?.cc || ''}`,
      `Date: ${selected?.receivedAt || ''}`,
      `Subject: ${selected?.subject || ''}`,
      '',
      selectedBody,
    ].join('\n'));
  }

  return blocks.join('\n\n--- END OF EMAIL ---\n\n');
}

const PRODUCT_ALIASES = {
  'ac': 'AC', 'a c': 'AC', 'air conditioner': 'AC', 'air conditioning': 'AC',
  'server ac': 'Server Room Ac', 'server a c': 'Server Room Ac', 'server room a c': 'Server Room Ac',
  'cctv camera': 'Cctv', 'dvr': 'Digital Video Recorder', 'video recorder': 'Digital Video Recorder',
  'led': 'Led Light', 'led bulb': 'Led Light', 'tube light': 'Lights',
  'water pump': 'Water Motor', 'shampoo dispenser': 'Shampoo Dispenser Machine',
  'rolling shutter': 'Shutter', 'glass door': 'Glass Door', 'main door': 'Door',
  'cash counter': 'Cash Drawer', 'biometric': 'Biometric system',
};

const NATURE_KEYWORDS = [
  { re: /\b(temperature|cooling|not cold|hot|warm|heat|thermostat)\b/i, nature: 'Not Maintaining Proper Temperature' },
  { re: /\b(spare|part|parts|component)\b/i,                            nature: 'Part Not Working' },
  { re: /\b(service|servicing|maintenance|maintainance|amc)\b/i,         nature: 'Servicing or Maintainance Required' },
  { re: /\b(repair|repairing|rectify)\b/i,                               nature: 'Repair Required' },
  { re: /\b(requirement|installation|replace|replacement|supply|need|request)\b/i, nature: 'Requirement / Installation / Replacement' },
  { re: /\b(not working|defective|faulty|broken|malfunction|issue|problem)\b/i, nature: 'Not Working' },
];

function compactText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueMasterRows(rows) {
  const seen = new Set();
  const list = [];
  for (const row of rows || []) {
    const key = compactText(row?.name || row?.nature || row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push(row);
  }
  return list;
}

function matchProductMaster(products, rawValue) {
  const target = compactText(rawValue);
  if (!target) return null;
  const goals = [...new Set([target, compactText(PRODUCT_ALIASES[target])].filter(Boolean))];
  let best = null;
  let bestScore = 0;
  for (const product of uniqueMasterRows(products)) {
    const name = compactText(product.name);
    for (const goal of goals) {
      let score = 0;
      if (name === goal) score = 100;
      else if (name.includes(goal) || goal.includes(name)) score = 80;
      else {
        const words = name.split(' ');
        const overlap = words.filter(w => goal.split(' ').includes(w)).length;
        if (overlap) score = Math.round((overlap / Math.max(words.length, goal.split(' ').length)) * 70);
      }
      if (score > bestScore) { bestScore = score; best = product; }
    }
  }
  return bestScore >= 60 ? best : null;
}

function findProductInThread(products, fullText) {
  const text = compactText(fullText);
  if (!text) return null;
  const list = uniqueMasterRows(products);
  const terms = [
    ...list.map(product => ({ product, term: compactText(product.name) })),
    ...Object.entries(PRODUCT_ALIASES).map(([alias, name]) => ({
      product: list.find(p => compactText(p.name) === compactText(name)),
      term: compactText(alias),
    })),
  ].filter(t => t.product && t.term).sort((a, b) => b.term.length - a.term.length);

  for (const { product, term } of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text)) return product;
  }
  return null;
}

function matchNatureMaster(natures, rawValue) {
  const target = compactText(rawValue);
  if (!target) return null;
  let best = null;
  let bestScore = 0;
  for (const nature of uniqueMasterRows(natures)) {
    const name = compactText(nature.nature);
    let score = 0;
    if (name === target) score = 100;
    else if (name.includes(target) || target.includes(name)) score = 75;
    else {
      const words = name.split(' ').filter(w => w.length > 3);
      const overlap = words.filter(w => target.split(' ').includes(w)).length;
      if (overlap) score = Math.round((overlap / Math.max(words.length, 2)) * 60);
    }
    if (score > bestScore) { bestScore = score; best = nature; }
  }
  return bestScore >= 55 ? best : null;
}

function findNatureInThread(natures, fullText) {
  const list = uniqueMasterRows(natures);
  for (const { re, nature } of NATURE_KEYWORDS) {
    if (!re.test(fullText || '')) continue;
    const key = compactText(nature);
  const row = list.find(n => compactText(n.nature) === key);
    if (row) return row;
  }
  return null;
}

function detectStoreCode(fullText, messages = []) {
  const text = String(fullText || '');
  const labelled = text.match(/\bstore\s*(?:code)?\s*[-:]\s*([A-Z]{2}\d{2,3})\b/i);
  if (labelled) return labelled[1].toUpperCase();
  for (const msg of messages) {
    const addresses = [msg?.from, msg?.to, msg?.toFull, msg?.cc, msg?.ccFull].filter(Boolean).join(' ');
    const hit = addresses.match(/\b([A-Z]{2}\d{2,3})\s*\.\s*sm\s*@/i);
    if (hit) return hit[1].toUpperCase();
  }
  const loose = text.match(/\b([A-Z]{2}\d{2,3})\b/);
  return loose ? loose[1].toUpperCase() : '';
}

function extractProductLocation(fullText) {
  const labelled = String(fullText || '').match(/(?:product\s*)?(?:location|site|area)\s*[-:]\s*([^\n\r]{2,100})/i);
  if (labelled) return labelled[1].trim();
  const place = String(fullText || '').match(/\b(entry gate|main gate|billing counter|washroom|trial room|server room|stock room|back office|parking|basement|first floor|second floor)\b/i);
  return place ? place[1] : '';
}

function buildDeterministicDescription(fullText, messages = [], selected = {}) {
  const inbound = [...(messages || [])]
    .filter(m => {
      const from = String(m?.from || '').toLowerCase();
      return from && !from.includes('helpdesk') && !from.includes('openmind');
    })
    .sort((a, b) => new Date(b?.receivedDateTime || b?.receivedAt || 0) - new Date(a?.receivedDateTime || a?.receivedAt || 0))[0];
  const body = stripHtml(
    inbound?.uniqueBodyHtml || inbound?.body || inbound?.bodyHtml || inbound?.bodyPreview
    || selected?.body || selected?.bodyHtml || selected?.bodyPreview || fullText || ''
  );
  return body
    .replace(/\s+disclaimer:[\s\S]*$/i, '')
    .split(/\n\s*(?:_{3,}|from:\s|sent:\s|to:\s)/i)[0]
    .trim()
    .slice(0, 1200);
}

// AI extraction is treated as a hint. Master data and the full thread are the
// source of truth, so a wrong/missing AI value is corrected here.
function reconcileParsedResult({ res = {}, fullText = '', fullMessages = [], selected = {}, products = [], natures = [], locked = {}, bodyStoreCode = '' }) {
  const out = { ...res };
  const masterProducts = uniqueMasterRows(products);
  const masterNatures = uniqueMasterRows(natures);

  // Store — inbox metadata and explicit thread labels beat the AI value.
  const validStore = (code) => /^[A-Z]{2}\d{2,3}$/i.test(String(code || '').trim());
  out.storeCode = locked.storeCode
    || (validStore(selected?.storeCode) ? selected.storeCode.toUpperCase() : '')
    || (validStore(out.storeCode) ? String(out.storeCode).toUpperCase() : '')
    || (validStore(bodyStoreCode) ? bodyStoreCode.toUpperCase() : '')
    || detectStoreCode(fullText, fullMessages)
    || '';

  // Product — keep an agent-locked value, then AI, then search the whole thread.
  const aiProductRaw = String(out.productName || '').trim();
  const lockedProduct = locked.productName
    ? (matchProductMaster(masterProducts, locked.productName) || { name: locked.productName })
    : null;
  const aiProduct = matchProductMaster(masterProducts, aiProductRaw);
  const threadProduct = (!lockedProduct && !aiProduct) ? findProductInThread(masterProducts, fullText) : null;
  const chosenProduct = lockedProduct || aiProduct || threadProduct;
  if (chosenProduct) {
    out.productName = chosenProduct.name;
    out.productUnmatched = false;
    out.aiProductName = '';
  } else {
    out.productName = '';
    out.productUnmatched = !!(masterProducts.length && aiProductRaw);
    out.aiProductName = out.productUnmatched ? aiProductRaw : (out.aiProductName || '');
  }

  // Nature — same order: locked, AI, then keyword scan of the old emails.
  const lockedNature = locked.natureOfProblem
    ? (matchNatureMaster(masterNatures, locked.natureOfProblem) || { nature: locked.natureOfProblem, type: locked.complaintType || '' })
    : null;
  const aiNature = matchNatureMaster(masterNatures, out.natureOfProblem);
  const threadNature = (!lockedNature && !aiNature) ? findNatureInThread(masterNatures, fullText) : null;
  const chosenNature = lockedNature || aiNature || threadNature;
  if (chosenNature) {
    out.natureOfProblem = chosenNature.nature;
    if (chosenNature.type) out.complaintType = chosenNature.type;
  }

  // Description/location — only replace weak AI values with thread text.
  const threadDescription = buildDeterministicDescription(fullText, fullMessages, selected);
  const aiDescription = String(out.description || '').trim();
  if (!aiDescription || aiDescription.length < 25 || /^(please find|as discussed|refer|attached|ntr|requirement)$/i.test(aiDescription)) {
    if (threadDescription) out.description = threadDescription;
  }
  out.productLocation = out.productLocation || locked.productLocation || extractProductLocation(fullText) || '';

  return out;
}

function findBestByText(items, text, fields) {
  const target = normalizeText(text);
  if (!target) return null;

  let best = null;
  let bestScore = 0;
  for (const item of items || []) {
    for (const field of fields) {
      const value = normalizeText(item[field]);
      if (!value) continue;
      const score = value === target ? 100 : value.includes(target) || target.includes(value) ? Math.min(value.length, target.length) : 0;
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
  }
  return best;
}

export default function EmailComplaints() {
  const { currentUser } = useAuth();
  const { rows: amcRows } = useAmcVendors();
  const [activeTab,    setActiveTab]    = useState('inbox'); // 'inbox' | 'sent'
  const [inboxEmails,  setInboxEmails]  = useState(() => {
    try { const c = sessionStorage.getItem('vmm_inbox_list'); return c ? JSON.parse(c) : []; } catch { return []; }
  });
  const [sentEmails,   setSentEmails]   = useState([]);
  const emails = activeTab === 'sent' ? sentEmails : inboxEmails;
  const [fetching,  setFetching]  = useState(false);
  const [selected,  setSelected]  = useState(null);
  const [parsing,         setParsing]         = useState(false);
  const [parsed,          setParsed]          = useState(null);
  const [replyBody,       setReplyBody]       = useState('');
  const [sending,         setSending]         = useState(false);
  const [quickReplyBody,  setQuickReplyBody]  = useState('');
  const [sendingQuickReply, setSendingQuickReply] = useState(false);
  const [logging,       setLogging]       = useState(false);
  const [loggingActivity, setLoggingActivity] = useState(false);
  const [confirmECPending, setConfirmECPending] = useState(false);
  const [toast,         setToast]         = useState('');
  const [activeAction,    setActiveAction]    = useState(null);
  const [resendModal,     setResendModal]     = useState(false);
  const [resendNo,        setResendNo]        = useState('');
  const [resendData,      setResendData]      = useState(null);   // complaint data from DB
  const [resendLoading,   setResendLoading]   = useState(false);
  const [resendVendorEmail, setResendVendorEmail] = useState('');
  const [resendDescription, setResendDescription] = useState('');
  const [resendSending,   setResendSending]   = useState(false);
  const [updateForm,      setUpdateForm]      = useState({ complaintId: '', remarks: '', newStatus: '', newEdc: '', escalationLevel: '', reasonForDelay: '' });
  const [updateAction,    setUpdateAction]    = useState(null); // 'escalate' | 'close' | 'update'
  const [updSrc,          setUpdSrc]          = useState('Email Reply');
  const [updTxnId,        setUpdTxnId]        = useState('');
  const [updMobile,       setUpdMobile]       = useState('');
  const [updEmailRef,     setUpdEmailRef]     = useState('');
  const [updVendorTicket, setUpdVendorTicket] = useState('');
  const [updDelayMain,    setUpdDelayMain]    = useState('');
  const [updDelaySub,     setUpdDelaySub]     = useState('');
  const [updStatus,       setUpdStatus]       = useState('Closed');
  const [updClosedBy,     setUpdClosedBy]     = useState('');
  const [escEmailMode, setEscEmailMode] = useState(null); // null|'loading'|'reply'|'new'|'skip'
  const [escPrevMsg,   setEscPrevMsg]   = useState(null);
  const [escToEmail,   setEscToEmail]   = useState('');
  const [escCc,        setEscCc]        = useState('');
  const [escSubject,   setEscSubject]   = useState('');
  const [escBody,      setEscBody]      = useState('');
  const [searchingComplaint, setSearchingComplaint] = useState(false);
  const [foundComplaint,     setFoundComplaint]     = useState(null); // complaint data from system
  const [attachmentData,  setAttachmentData]  = useState(null);
  const [loadingAttach,   setLoadingAttach]   = useState(false);
  const [wipList,   setWipList]   = useState([]);
  const [templates,    setTemplates]    = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [products,     setProducts]     = useState([]);  // raw rows: each row = { name, vendor, category, hoName, hoEmail, vendorEmail }
  const [natures,      setNatures]      = useState([]);
  const [parsedEdits,  setParsedEdits]  = useState({ storeCode: '', employeeCode: '', employeeName: '', employeeEmail: '', contactNumber: '', productLocation: '', description: '' });
  const [replyTo,         setReplyTo]         = useState([]);
  const [replyCc,         setReplyCc]         = useState([]);
  const [toInput,         setToInput]         = useState('');
  const [ccInput,         setCcInput]         = useState('');
  const [empLookupStatus, setEmpLookupStatus] = useState('idle'); // idle|loading|found|not-found
  const [resolvedEmpName, setResolvedEmpName] = useState('');
  const [empLookupSource, setEmpLookupSource] = useState(''); // code|mobile|store
  const [showReplyEditor, setShowReplyEditor] = useState(false);
  const itemIdRef = useRef(1);
  const [activeComplaintId, setActiveComplaintId] = useState(1);
  const [complaintItems, setComplaintItems] = useState([makeComplaintItem(1)]);
  const [emTab,           setEmTab]           = useState('form');  // 'form' | 'matrix'
  const [escalationMatrix, setEscalationMatrix] = useState([]);
  const [emLoading,       setEmLoading]       = useState(false);
  const [emSearch,        setEmSearch]        = useState('');
  const [emRegion,        setEmRegion]        = useState('');
  const [emLevel,         setEmLevel]         = useState('');
  const [confirmModal,    setConfirmModal]    = useState(false);
  const [showValidation,  setShowValidation]  = useState(false);
  const [activeClaims,    setActiveClaims]    = useState({});
  const [recentCases,     setRecentCases]     = useState([]);
  const [loadingRecent,   setLoadingRecent]   = useState(false);
  const [logSuccess,      setLogSuccess]      = useState(null); // { results, payload } after successful log
  const [emailTags,       setEmailTags]       = useState(() => JSON.parse(localStorage.getItem('vmm_email_tags') || '{}')); // { [emailId]: { type, label, time } }
  const [tagFilter,       setTagFilter]       = useState(null); // null | 'wip' | 'logged'
  const [emailModal,      setEmailModal]      = useState(null); // email object shown in full-view popup
  const [threadMessages,  setThreadMessages]  = useState([]);   // all messages in selected email's thread
  const [threadLoading,   setThreadLoading]   = useState(false);
  const [searchQuery,     setSearchQuery]     = useState('');
  const [searchMode,      setSearchMode]      = useState(false); // true when showing search results
  const [searching,       setSearching]       = useState(false);
  const [readFilter,      setReadFilter]      = useState('all');    // 'all' | 'unread' | 'read'
  const [sortOrder,       setSortOrder]       = useState('newest'); // 'newest' | 'oldest'
  const searchInputRef = useRef(null);

  // Stable session ID per browser tab — identifies this agent across renders
  const agentIdRef = useRef(null);
  if (!agentIdRef.current) {
    let id = sessionStorage.getItem('vmm_agent_id');
    if (!id) { id = 'agent_' + Math.random().toString(36).slice(2, 8); sessionStorage.setItem('vmm_agent_id', id); }
    agentIdRef.current = id;
  }
  const agentId = agentIdRef.current;


  // Load templates and products on mount
  useState(() => {
    vmm.getEmailTemplates().then(res => setTemplates(res.templates || [])).catch(() => {});
  });
  useEffect(() => {
    vmm.getProducts().then(r => setProducts(r.products || [])).catch(() => {});
    vmm.getNatures().then(r => setNatures(mergeNatures(r.natures))).catch(() => setNatures(mergeNatures([])));
    vmm.getOpenWips().then(res => setWipList(res.wips || [])).catch(() => {});
    fetchEmails('inbox');
  }, []); // eslint-disable-line


  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(''), 3500);
  };

  // New natures are saved to the master sheet immediately so they appear in
  // Settings, New Case and reports. The wizard also keeps the value locally.
  const addCustomNature = async (nature) => {
    const name = String(nature || '').trim();
    if (!name) return;
    setNatures(prev => prev.some(n => norm(n.nature) === norm(name))
      ? prev
      : [...prev, { nature: name, type: 'Repair', tatDays: null }]);
    try {
      await vmm.saveMasterRow('Nature', 'create', { nature: name, type: 'Repair', tatDays: null });
    } catch { /* keep the value in the local list */ }
  };

  const tagEmail = (id, type, label) => {
    const updated = { ...JSON.parse(localStorage.getItem('vmm_email_tags') || '{}'), [id]: { type, label, time: new Date().toISOString() } };
    localStorage.setItem('vmm_email_tags', JSON.stringify(updated));
    setEmailTags(updated);
  };

  // Patch email categories in local state so inferTagFromCategories reflects immediately
  const patchEmailCategories = (id, newCats) => {
    setInboxEmails(prev => prev.map(e =>
      e.id === id ? { ...e, categories: [...new Set([...(e.categories || []), ...newCats])] } : e
    ));
  };

  const POLL_MS = 30000;
  const pollRef = useRef(null);

  const mergeInbox = (existing, incoming, isIncremental) => {
    if (!isIncremental) return incoming;
    const map = new Map(existing.map(e => [e.id, e]));
    incoming.forEach(e => map.set(e.id, e));
    return [...map.values()].sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
  };

  const fetchEmails = async (tab, { silent = false, delta = false } = {}) => {
    const folder = tab || activeTab;
    if (!silent) { setFetching(true); setSelected(null); setParsed(null); }
    try {
      const res = folder === 'sent'
        ? await vmm.fetchSent()
        : await vmm.fetchInbox({ deltaMode: delta });

      const fetched = res.emails || [];
      const isIncremental = !!res.isIncremental;

      if (folder === 'sent') {
        setSentEmails(fetched);
      } else {
        // Always keep prev visible during merge; on full refresh, replace with new set but keep prev until done
        setInboxEmails(prev => {
          const merged = mergeInbox(isIncremental ? prev : [], fetched, isIncremental);
          try { sessionStorage.setItem('vmm_inbox_list', JSON.stringify(merged)); } catch {}
          return merged;
        });
      }

      if (!silent) {
        if (!fetched.length && !isIncremental) showToast(`No emails in ${folder === 'sent' ? 'Sent' : 'Inbox'}`, 'info');
        else if (folder !== 'sent') {
          const wipReplyCount = fetched.filter(e =>
            e.conversationId && wipList.some(w => w.conversationId && w.conversationId === e.conversationId)
          ).length;
          if (wipReplyCount > 0) showToast(`↩ ${wipReplyCount} WIP case${wipReplyCount > 1 ? 's' : ''} have new replies`, 'ok');
        }
      }
    } catch {
      if (!silent) showToast('Could not fetch emails. Please try again.', 'err');
    } finally {
      if (!silent) setFetching(false);
    }
  };

  // Live delta polling every 30s on inbox tab
  useEffect(() => {
    if (activeTab !== 'inbox') { clearInterval(pollRef.current); return; }
    pollRef.current = setInterval(() => fetchEmails('inbox', { silent: true, delta: true }), POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [activeTab, wipList]); // eslint-disable-line

  const runSearch = async (q) => {
    const query = (q || searchQuery).trim();
    if (!query) return;
    setSearching(true);
    setSearchMode(true);
    setInboxEmails([]);
    setSelected(null);
    setParsed(null);
    try {
      const res = await vmm.searchEmails(query);
      const found = res.emails || [];
      setInboxEmails(found);
      if (!found.length) showToast('No emails found', 'info');
    } catch {
      showToast('Search failed. Please try again.', 'err');
    } finally { setSearching(false); }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchMode(false);
    fetchEmails('inbox');
  };


  // Close email popup on ESC
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') setEmailModal(null); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  // Safety net: if Full View opens and thread isn't loaded yet, fetch it now
  useEffect(() => {
    if (!emailModal?.conversationId) return;
    if (threadMessages.length > 0 || threadLoading) return;
    setThreadLoading(true);
    vmm.fetchThread(emailModal.conversationId)
      .then(res => {
        const msgs = res.messages || [];
        setThreadMessages(msgs);
        if (msgs.length === 0) return;
        const OWN = 'vmm.helpdesk@openmind.in';
        const sorted = [...msgs].sort((a, b) => new Date(a.receivedDateTime) - new Date(b.receivedDateTime));
        const originalFrom = sorted[0]?.from;
        if (originalFrom && originalFrom.toLowerCase() !== OWN) setReplyTo([originalFrom]);
        const allCCs = new Set();
        (sorted[0]?.cc || '').split(',').map(c => c.trim()).filter(Boolean).forEach(cc => {
          if (cc.toLowerCase() !== OWN && cc.toLowerCase() !== (originalFrom || '').toLowerCase()) allCCs.add(cc);
        });
        setReplyCc([...allCCs]);
      })
      .catch(() => {})
      .finally(() => setThreadLoading(false));
  }, [emailModal?.conversationId]); // eslint-disable-line

  // Fetch full conversation thread whenever a new email is selected
  useEffect(() => {
    if (!selected?.conversationId) { setThreadMessages([]); return; }
    setThreadLoading(true);
    vmm.fetchThread(selected.conversationId)
      .then(res => {
        const msgs = res.messages || [];
        setThreadMessages(msgs);
        if (msgs.length === 0) return;
        const OWN = 'vmm.helpdesk@openmind.in';
        const sorted = [...msgs].sort((a, b) => new Date(a.receivedDateTime) - new Date(b.receivedDateTime));
        // TO = original sender (first message FROM, excluding our own address)
        const originalFrom = sorted[0]?.from;
        if (originalFrom && originalFrom.toLowerCase() !== OWN) setReplyTo([originalFrom]);
        // CC = all unique CCs across every message in thread (excluding our own address and original sender)
        const allCCs = new Set();
        (sorted[0]?.cc || '').split(',').map(c => c.trim()).filter(Boolean).forEach(cc => {
          if (cc.toLowerCase() !== OWN && cc.toLowerCase() !== (originalFrom || '').toLowerCase()) allCCs.add(cc);
        });
        setReplyCc([...allCCs]);
      })
      .catch(() => setThreadMessages([]))
      .finally(() => setThreadLoading(false));
  }, [selected?.conversationId]); // eslint-disable-line

  // Re-run employee lookup whenever the employee code field is edited
  useEffect(() => {
    if (!parsed) return;
    const code = (parsedEdits.employeeCode || '').toString().trim().toUpperCase();
    if (!code) {
      setEmpLookupStatus('idle');
      setResolvedEmpName('');
      setEmpLookupSource('');
      setParsedEdits(prev => ({ ...prev, employeeName: '', employeeEmail: '' }));
      return;
    }
    setEmpLookupStatus('loading');
    const t = setTimeout(async () => {
      try {
        const empRes = await vmm.lookupEmployee(code);
        if (empRes.found && empRes.employee?.name) {
          setResolvedEmpName(empRes.employee.name);
          setEmpLookupStatus('found');
          setEmpLookupSource(prev => prev || 'code');
          setParsedEdits(prev => ({
            ...prev,
            employeeName: empRes.employee.name,
            employeeEmail: empRes.employee.email || '',
            contactNumber: prev.contactNumber || empRes.employee.mobile || '',
          }));
        } else {
          setResolvedEmpName('');
          setEmpLookupStatus('not-found');
          setParsedEdits(prev => ({ ...prev, employeeName: '', employeeEmail: '' }));
        }
      } catch {
        setResolvedEmpName('');
        setEmpLookupStatus('not-found');
        setParsedEdits(prev => ({ ...prev, employeeName: '', employeeEmail: '' }));
      }
    }, 600);
    return () => clearTimeout(t);
  }, [parsedEdits.employeeCode]); // eslint-disable-line

  // Fallback: if no employee code but mobile is present, try lookup by mobile
  useEffect(() => {
    if (!parsed) return;
    if (parsedEdits.employeeCode) return; // code-based lookup already handles this
    const mobile = (parsedEdits.contactNumber || '').replace(/\D/g, '');
    if (mobile.length !== 10) return;
    setEmpLookupStatus('loading');
    const t = setTimeout(async () => {
      try {
        const empRes = await vmm.lookupEmployeeByMobile(mobile);
        if (empRes?.found && empRes.employee?.name) {
          setResolvedEmpName(empRes.employee.name);
          setEmpLookupStatus('found');
          setEmpLookupSource(prev => prev || 'mobile');
          setParsedEdits(prev => ({
            ...prev,
            employeeCode: empRes.employee.code ? String(empRes.employee.code) : '',
            employeeName: empRes.employee.name,
            employeeEmail: empRes.employee.email || '',
          }));
        } else {
          setResolvedEmpName('');
          setEmpLookupStatus('not-found');
        }
      } catch {
        setResolvedEmpName('');
        setEmpLookupStatus('not-found');
      }
    }, 800);
    return () => clearTimeout(t);
  }, [parsedEdits.contactNumber, parsedEdits.employeeCode]); // eslint-disable-line

  const switchTab = (tab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    if (tab !== 'matrix') { setSelected(null); setParsed(null); }
    if (tab === 'sent') fetchEmails('sent');
    if (tab === 'matrix' && !escalationMatrix.length && !emLoading) {
      setEmLoading(true);
      vmm.getEscalationMatrix().then(r => setEscalationMatrix(r.contacts || [])).catch(() => {}).finally(() => setEmLoading(false));
    }
  };

  // Reply counts: inbox emails with the same conversationId as a WIP, but NOT the original email and NOT our own sent messages
  const OWN_ADDR = 'vmm.helpdesk@openmind.in';
  const wipReplyCounts = {};
  inboxEmails.forEach(e => {
    if (!e.conversationId) return;
    if ((e.fromAddr || '').toLowerCase() === OWN_ADDR) return; // skip our own sent messages appearing in inbox
    const match = wipList.find(w =>
      w.conversationId && w.conversationId === e.conversationId && w.id !== e.id // exclude the original WIP email itself
    );
    if (match) wipReplyCounts[match.id] = (wipReplyCounts[match.id] || 0) + 1;
  });
  const totalWipReplies = Object.values(wipReplyCounts).reduce((s, n) => s + n, 0);

  const selectEmail = (email) => {
    setSelected(email);
    setParsed(null);
    setReplyBody('');
    setActiveAction(null);
    setUpdateForm({ complaintId: email.complaintId || '', remarks: '', newStatus: '', newEdc: '', escalationLevel: '', reasonForDelay: '' }); setUpdateAction(null); setFoundComplaint(null); setRecentCases([]); setLoadingRecent(false); setQuickReplyBody('');
    setUpdSrc('Email Reply'); setUpdTxnId(''); setUpdMobile(''); setUpdEmailRef(''); setUpdVendorTicket(''); setUpdDelayMain(''); setUpdDelaySub(''); setUpdStatus('Closed'); setUpdClosedBy('');
    // Restore cached attachments so the Load button doesn't reappear after refresh
    const cached = email.id ? localStorage.getItem(`vmm_attach_${email.id}`) : null;
    setAttachmentData(cached ? JSON.parse(cached) : null);
    // Default reply-to = sender; CC pre-filled from original email
    setReplyTo(email.fromAddr ? [email.fromAddr] : []);
    setReplyCc(Array.isArray(email.cc) ? email.cc.filter(Boolean) : []);
    setToInput('');
    setCcInput('');
    setShowReplyEditor(false);
    const freshId = ++itemIdRef.current;
    setActiveComplaintId(freshId);
    setComplaintItems([makeComplaintItem(freshId)]);
    setEmTab('form');
    setShowValidation(false);
    setEmSearch('');
    setEmRegion('');
    setEmLevel('');
    setThreadMessages([]);

    // WIP email — restore previously parsed fields so agent can edit and log directly
    if (email.parsed) {
      const p = email.parsed;
      setParsed(p);
      setActiveAction('log-new');
      const matchedProduct = findBestByText(products, p.productName || '', ['name']);
      const matchedNature  = findBestByText(natures,  p.natureOfProblem || '', ['nature']);
      setParsedEdits({
        storeCode:       p.storeCode || email.storeCode || '',
        employeeCode:    p.employeeCode    || '',
        employeeName:    p.employeeName    || '',
        employeeEmail:   p.employeeEmail   || '',
        contactNumber:   p.contactNumber   || '',
        productLocation: p.productLocation || '',
        description:     p.description     || '',
      });
      const wipId = ++itemIdRef.current;
      setActiveComplaintId(wipId);
      setComplaintItems([hydrateComplaintItem(wipId, {
        ...p,
        productName:     matchedProduct?.name || p.productName     || '',
        natureOfProblem: matchedNature?.nature  || p.natureOfProblem || '',
        complaintType:   matchedNature?.type    || p.complaintType   || '',
      }, products, natures)]);
      if (p.employeeCode) {
        setEmpLookupStatus(p.employeeName ? 'found' : 'idle');
        setResolvedEmpName(p.employeeName || '');
        setEmpLookupSource(p.employeeSource || 'code');
      } else {
        setEmpLookupStatus('idle');
        setResolvedEmpName('');
        setEmpLookupSource('');
      }
      if (p.suggestedReply) setReplyBody(p.suggestedReply);
    } else {
      setEmpLookupStatus('idle');
      setResolvedEmpName('');
      setEmpLookupSource('');
      setParsedEdits({ storeCode: email.storeCode || '', employeeCode: '', employeeName: '', employeeEmail: '', contactNumber: '', productLocation: '', description: '' });
    }
  };

  const claimEmail = (emailId, op = 'claim') => {
    vmm.emailClaim({ operation: op, emailId, agentId, agentLabel: `Agent ${agentId.slice(-4)}` })
      .then(r => setActiveClaims(r.claims || {}))
      .catch(() => {});
  };

  // Automatic clarification reply. Sends once per conversation, on the original
  // thread, so a client's later reply re-parses without triggering another email.
  const sendAutomaticMissingInfoReply = async ({ email, messages, parsedResult, missingFields }) => {
    const threadKey = email.conversationId || email.id;
    const localStorageKey = `vmm_missing_info_sent_${threadKey}`;
    if (localStorage.getItem(localStorageKey) === '1' || hasMissingInfoReply(messages)) return false;

    const preview = buildReplyPreview(parsedResult, email, messages);
    const to = [...new Set([...preview.to, email.fromAddr]
      .map(a => String(a || '').trim())
      .filter(a => a && a.toLowerCase() !== OWN_ADDR.toLowerCase()))];
    if (!to.length) return false;

    const rawCc = [
      ...preview.cc,
      ...(Array.isArray(email.cc) ? email.cc : String(email.cc || '').split(/[,;]/)),
    ];
    const toSet = new Set(to.map(a => a.toLowerCase()));
    const cc = [...new Set(rawCc.map(a => String(a || '').trim()).filter(Boolean))]
      .filter(a => a.toLowerCase() !== OWN_ADDR.toLowerCase() && !toSet.has(a.toLowerCase()));

    const body = buildMissingInfoReply(missingFields, { subject: email.subject });
    const htmlBody = buildReplyHtml(body).replace(
      /<\/div>$/,
      `<span style="display:none">${MISSING_INFO_MARKER}:${threadKey}</span></div>`
    );

    await vmm.sendEmailReply({
      messageId: email.id,
      conversationId: email.conversationId || '',
      subject: preview.subject,
      htmlBody,
      body,
      toRecipients: to,
      ccRecipients: cc,
    });

    localStorage.setItem(localStorageKey, '1');
    const wip = {
      id: email.id, conversationId: email.conversationId || '', subject: email.subject,
      fromAddr: email.fromAddr, storeCode: email.storeCode || parsedResult.storeCode || '',
      receivedAt: email.receivedAt, repliedAt: new Date().toISOString(),
      parsed: parsedResult, status: 'Awaiting Info', savedBy: 'Auto VMM',
    };
    setWipList(prev => [...prev.filter(w => w.id !== email.id), wip]);
    vmm.saveWip({
      emailId: email.id, conversationId: email.conversationId || '',
      subject: email.subject || '', fromAddr: email.fromAddr || '',
      storeCode: wip.storeCode, receivedAt: email.receivedAt || '',
      repliedAt: wip.repliedAt, parsed: parsedResult, savedBy: wip.savedBy,
      status: wip.status,
    }).catch(() => {});
    patchEmailCategories(email.id, ['Awaiting Info', 'New CRM']);
    tagEmail(email.id, 'awaiting-info', `Awaiting Info • ${missingFields.length} field${missingFields.length === 1 ? '' : 's'} missing`);
    setInboxEmails(prev => prev.filter(e => e.id !== email.id));
    setSelected(null); setParsed(null); setReplyBody('');
    showToast('Missing details requested — marked Awaiting Info', 'ok');
    return true;
  };

  const lookupResendComplaint = async () => {
    if (!resendNo.trim()) return;
    setResendLoading(true); setResendData(null); setResendVendorEmail(''); setResendDescription('');
    try {
      const r = await vmm.getComplaint(resendNo.trim());
      if (!r.success) { showToast('Complaint not found', 'warn'); return; }
      const c = r.complaint;
      const autoVendor = resolveStoreAmcVendor(
        amcRows, c.storecode, c.productname, c.vendorname
      );
      setResendData(c);
      setResendVendorEmail(c.vendoremail || autoVendor?.email || '');
      setResendDescription(c.description || '');
    } catch { showToast('Lookup failed — check n8n is running', 'warn'); }
    finally { setResendLoading(false); }
  };

  const sendResendEscalation = async () => {
    if (!resendData || !resendVendorEmail.trim()) return;
    setResendSending(true);
    try {
      const autoVendor = resolveStoreAmcVendor(
        amcRows, resendData.storecode, resendData.productname, resendData.vendorname
      );
      await vmm.sendEscalationEmail({
        storeCode:         resendData.storecode   || '',
        storeName:         resendData.storename   || '',
        storeEmail:        resendData.storeemail  || '',
        fmName:            resendData.fmname      || '',
        fmEmail:           resendData.fmemail     || '',
        region:            resendData.storeregion || '',
        storeState:        resendData.statename   || '',
        storeCity:         resendData.storecity   || '',
        vendorName:        resendData.vendorname  || '',
        productName:       resendData.productname || '',
        natureOfComplaint: resendData.natureofproblem || '',
        manualVendorEmail: resendVendorEmail.trim(),
        amcVendorEmail:    autoVendor?.email  || '',
        amcVendorName:     autoVendor?.name   || '',
        amcVendorSource:   autoVendor?.source || '',
        complaints: [{
          complaintno:     resendData.complaintno,
          productLocation: resendData.productlocation || '',
          natureOfProblem: resendData.natureofproblem || '',
          edcDate:         resendData.edcdate        || '',
          description:     resendDescription.trim(),
        }],
      });
      showToast(`Escalation email sent for ${resendData.complaintno}`, 'ok');
      setResendModal(false); setResendNo(''); setResendData(null);
    } catch(err) {
      showToast(`Failed to send: ${err?.message || 'unknown error'}`, 'warn');
    } finally { setResendSending(false); }
  };

  const parseEmail = async () => {
    if (!selected) return;
    setParsing(true);
    setShowReplyEditor(false);
    setReplyBody('');
    // Mark this email as "being worked on" by this agent
    claimEmail(selected.id, 'claim');
    try {
      // Always load the complete conversation before parsing. A reply can hold
      // details that were absent from the original store email.
      let fullMessages = [...(threadMessages || [])];
      if (selected?.conversationId) {
        try {
          const threadRes = await vmm.fetchThread(selected.conversationId);
          const fetched = threadRes?.messages || [];
          if (fetched.length) {
            fullMessages = fetched;
            setThreadMessages(fetched);
          }
        } catch {
          // Keep the messages already loaded; parsing still works with those.
        }
      }
      const fullThreadText = buildFullEmailThreadText(selected, fullMessages);
      const emailBody = fullThreadText || selected.body || selected.bodyPreview || '';

      // Extract store code and employee fields from every message in the thread.
      const rawText = fullThreadText.replace(/<[^>]*>/g, ' ');
      let bodyStoreCode = selected.storeCode || '';
      if (!bodyStoreCode) {
        const hit = rawText.match(/\bstore\s*(?:code)?\s*[-:]\s*([A-Z]{2}\d{2,3})\b/i);
        if (hit) bodyStoreCode = hit[1].toUpperCase();
      }
      const bodyEmployee = extractEmployeeFields({}, rawText);

      // The product master may still be loading when the agent starts parsing.
      // Fetch it before matching so the locked category is never left blank.
      let productRows = products;
      if (!productRows.length) {
        try {
          const pr = await vmm.getProducts();
          productRows = pr.products || [];
          if (productRows.length) setProducts(productRows);
        } catch {
          // Keep the current list; the parser can still return a product name.
        }
      }

      // Confirmed values are locked for re-parses. Employee code is only locked
      // when it passes the known format (VMM+3 digits OR 5-7 digits).
      const lockedFields = parsedEdits ? {
        storeCode:       parsedEdits.storeCode       || '',
        employeeCode:    (/^VMM\d{3}$|^\d{5,7}$/.test(parsedEdits.employeeCode || '')) ? parsedEdits.employeeCode : '',
        employeeName:    parsedEdits.employeeName     || resolvedEmpName || '',
        employeeEmail:   parsedEdits.employeeEmail    || '',
        contactNumber:   parsedEdits.contactNumber    || '',
        productLocation: parsedEdits.productLocation  || '',
        productName:     parsedEdits.productName      || '',
        natureOfProblem: parsedEdits.natureOfProblem  || '',
        description:     parsedEdits.description      || '',
      } : {};

      let res = await vmm.parseEmail({
        fromEmail:  selected.fromAddr,
        subject:    selected.subject,
        emailBody,
        // Full conversation for the AI, both as transcript and structured rows.
        emailThread: fullThreadText,
        fullEmailThread: fullThreadText,
        threadMessages: fullMessages.map(m => ({
          from:       m?.from || '',
          fromName:   m?.fromName || '',
          to:         m?.toFull || m?.to || '',
          cc:         m?.ccFull || m?.cc || '',
          date:       m?.receivedDateTime || m?.receivedAt || '',
          subject:    m?.subject || selected.subject || '',
          body:       stripHtml(m?.uniqueBodyHtml || m?.body || m?.bodyHtml || m?.bodyPreview || ''),
        })),
        threadMessageCount: fullMessages.length,
        storeCode:  bodyStoreCode || selected.storeCode,
        templates,
        natures:    natures.map(n => ({ nature: n.nature, type: n.type })),
        // Unique product names so AI picks from the real list (e.g. "Server room AC" → "AC")
        productNames: [...new Set(productRows.map(p => p.name))],
        // Pass currently confirmed values — backend will not overwrite these.
        lockedFields,
        // Deterministic hints from the thread so the AI is guided as well.
        hints: {
          storeCode:    bodyStoreCode || selected.storeCode || '',
          productNames: [...new Set(productRows.map(p => p.name))],
          natureNames:  natures.map(n => n.nature),
        },
      });

      // Correct imperfect AI output using the full thread + master data.
      res = reconcileParsedResult({
        res, fullText: fullThreadText, fullMessages, selected,
        products: productRows, natures, locked: lockedFields, bodyStoreCode,
      });

      // Employee — accept AI aliases, email signatures and template fields,
      // then enrich from the employee master.
      const parsedEmployee = extractEmployeeFields(res, rawText);
      let effectiveEmpCode = parsedEmployee.employeeCode || bodyEmployee.employeeCode;
      let effectiveName = parsedEmployee.employeeName;
      let effectiveEmail = parsedEmployee.employeeEmail || bodyEmployee.employeeEmail;
      let effectiveContact = parsedEmployee.contactNumber || bodyEmployee.contactNumber;
      let employeeSource = '';

      // Many templates contain only a mobile number. Resolve the code immediately
      // so all employee fields are filled as soon as parsing completes.
      if (!effectiveEmpCode && effectiveContact) {
        try {
          const byMobile = await vmm.lookupEmployeeByMobile(effectiveContact.replace(/\D/g, ''));
          if (byMobile?.found && byMobile.employee?.code) {
            effectiveEmpCode = String(byMobile.employee.code);
            effectiveName = byMobile.employee.name || effectiveName;
            effectiveEmail = byMobile.employee.email || effectiveEmail;
            employeeSource = 'mobile';
          }
        } catch {
          // Keep the AI-provided name/contact; the on-edit lookup can retry later.
        }
      }

      // Last resort: the AI and template often give only a store code. Match it
      // against the employee master using the store mailbox and signature name.
      let storeMatchedEmployee = null;
      if (!effectiveEmpCode) {
        const namesFromThread = [];
        const emailsFromThread = [];
        const mobilesFromThread = [];
        fullMessages.forEach(msg => {
          const from = String(msg?.from || '').trim().toLowerCase();
          if (!from || from.includes('helpdesk') || from === OWN_ADDR.toLowerCase()) return;
          emailsFromThread.push(from);
          const hints = extractEmployeeFields({}, msg.uniqueBodyHtml || msg.body || msg.bodyHtml || msg.bodyPreview || '');
          namesFromThread.push(...(hints.nameHints || []));
          if (hints.contactNumber) mobilesFromThread.push(hints.contactNumber);
        });
        if (selected?.fromAddr) emailsFromThread.push(selected.fromAddr.toLowerCase());
        if (selected?.fromName) namesFromThread.push(selected.fromName);

        const storeForMatch = res.storeCode || bodyStoreCode || selected?.storeCode || '';
        try {
          const employees = await vmm.getEmployees();
          storeMatchedEmployee = pickEmployeeForStore(employees, {
            storeCode: storeForMatch,
            emails: [...emailsFromThread, ...(parsedEmployee.emailHints || []), ...(bodyEmployee.emailHints || [])],
            names: [...namesFromThread, ...(parsedEmployee.nameHints || []), ...(bodyEmployee.nameHints || [])],
            mobiles: [...mobilesFromThread, effectiveContact].filter(Boolean),
          });
          if (storeMatchedEmployee) {
            effectiveEmpCode = String(storeMatchedEmployee.code || '');
            effectiveName = storeMatchedEmployee.name || effectiveName;
            effectiveEmail = storeMatchedEmployee.email || effectiveEmail;
            effectiveContact = effectiveContact || String(storeMatchedEmployee.mobile || '');
            employeeSource = 'store';
          }
        } catch {
          // Store matching is best-effort — every shared field stays editable.
        }
      }

      res.employeeCode = effectiveEmpCode || '';
      res.employeeName = effectiveName || '';
      res.employeeEmail = effectiveEmail || '';
      res.contactNumber = effectiveContact || '';
      res.employeeSource = employeeSource;

      if (!effectiveEmpCode) {
        setEmpLookupStatus('idle');
        setResolvedEmpName(effectiveName || '');
        setEmpLookupSource('');
      } else {
        setResolvedEmpName(effectiveName || '');
        setEmpLookupStatus('loading');
        try {
          const empRes = await vmm.lookupEmployee(effectiveEmpCode);
          const lookupName = empRes.found && empRes.employee?.name ? empRes.employee.name : '';
          const lookupMobile = empRes.employee?.mobile || '';
          res.employeeName = lookupName || effectiveName;
          res.employeeEmail = empRes.employee?.email || effectiveEmail;
          if (!effectiveContact && lookupMobile) effectiveContact = lookupMobile;
          res.contactNumber = effectiveContact || String(storeMatchedEmployee?.mobile || '');
          // If store code is missing, auto-fill from employee's store
          if (!res.storeCode && !bodyStoreCode && !selected.storeCode && empRes.employee?.storeCode) {
            res.storeCode = empRes.employee.storeCode;
          }
          setResolvedEmpName(res.employeeName || '');
          if (lookupName) {
            setEmpLookupStatus('found');
            setEmpLookupSource(employeeSource || 'code');
          } else if (storeMatchedEmployee) {
            // Already verified against the full employee master.
            setEmpLookupStatus('found');
            setEmpLookupSource('store');
          } else {
            setEmpLookupStatus('not-found');
            setEmpLookupSource('');
          }
        } catch {
          res.employeeName = effectiveName;
          res.employeeEmail = effectiveEmail;
          res.contactNumber = effectiveContact;
          setResolvedEmpName(effectiveName || '');
          if (storeMatchedEmployee) {
            setEmpLookupStatus('found');
            setEmpLookupSource('store');
          } else {
            setEmpLookupStatus('not-found');
            setEmpLookupSource('');
          }
        }
      }
      // Product — nearest match from real list
      const matchedProduct = findBestByText(productRows, res.productName || '', ['name']);
      // Nature — nearest match from real natures list
      const matchedNature  = findBestByText(natures,  res.natureOfProblem || '', ['nature']);

      // Fields still missing after deterministic reconciliation. These drive the
      // automatic clarification reply instead of a generic "template incomplete" note.
      const missingFields = [];
      if (!res.storeCode && !bodyStoreCode && !selected.storeCode) missingFields.push('storeCode');
      if (!matchedProduct) missingFields.push('productName');
      if (!matchedNature) missingFields.push('natureOfProblem');
      if (!(res.description || '').trim()) missingFields.push('description');
      if (!res.employeeCode && !res.contactNumber) missingFields.push('contactNumber');
      for (const field of res.missingFromTemplate || []) {
        if (field === 'storeCode' && (res.storeCode || bodyStoreCode || selected.storeCode)) continue;
        if (field === 'productName' && matchedProduct) continue;
        if (field === 'natureOfProblem' && matchedNature) continue;
        if (field === 'description' && res.description) continue;
        if (!missingFields.includes(field)) missingFields.push(field);
      }

      setParsedEdits(prev => ({
        storeCode:       res.storeCode       || bodyStoreCode         || selected?.storeCode    || prev?.storeCode       || '',
        employeeCode:    res.employeeCode    || prev?.employeeCode    || '',
        employeeName:    res.employeeName    || '',
        employeeEmail:   res.employeeEmail   || '',
        contactNumber:   res.contactNumber   || prev?.contactNumber   || '',
        productLocation: res.productLocation || prev?.productLocation || '',
        description:     res.description     || prev?.description     || '',
      }));
      const firstId = complaintItems[0]?.id || (++itemIdRef.current);
      setActiveComplaintId(firstId);
      const hydratedFirst = hydrateComplaintItem(firstId, {
        ...res,
        productName:     matchedProduct?.name || res.productName || '',
        natureOfProblem: matchedNature?.nature || res.natureOfProblem || '',
        complaintType:   matchedNature?.type   || res.complaintType   || '',
        description:     res.description || '',
      }, productRows, natures);
      setComplaintItems(prev => {
        const first = prev[0] || makeComplaintItem(firstId);
        return [{ ...first, ...hydratedFirst }, ...prev.slice(1)];
      });
      setParsed(res);
      setSelectedTemplateId(res.selectedTemplateId || null);
      if (res.suggestedReply) setReplyBody(res.suggestedReply);

      if (AUTO_MISSING_INFO_REPLY && missingFields.length) {
        try {
          await sendAutomaticMissingInfoReply({
            email: selected,
            messages: fullMessages,
            parsedResult: res,
            missingFields,
          });
        } catch (err) {
          showToast('Could not send missing-details request — please reply manually', 'warn');
        }
      }
    } catch {
      showToast('AI parsing failed. Please try again.', 'err');
    } finally { setParsing(false); }
  };

  const sendReply = async () => {
    if (!replyBody.trim() || !selected) return;
    setSending(true);
    try {
      const html = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7">'
        + replyBody.split('\n').map(l => l.trim() ? `<p style="margin:0 0 8px">${l}</p>` : '<br/>').join('')
        + '<hr style="margin:16px 0;border:none;border-top:1px solid #e2e8f0"/>'
        + '<p style="font-size:11px;color:#64748b">Open Mind Services Limited — VMM CRM</p></div>';
      await vmm.sendEmailReply({
        messageId:      selected.id,
        conversationId: selected.conversationId || '',
        subject:        selected.subject || '',
        htmlBody:       html,
        body:           replyBody,
        toRecipients:   replyTo.join(';'),
        ccRecipients:   replyCc.join(';'),
      });
      // Save as WIP
      const wip = { id: selected.id, conversationId: selected.conversationId || '', subject: selected.subject, fromAddr: selected.fromAddr,
        storeCode: selected.storeCode, receivedAt: selected.receivedAt,
        repliedAt: new Date().toISOString(), parsed, status: 'WIP',
        savedBy: `Agent ${agentId.slice(-4)}` };
      setWipList(prev => [...prev.filter(w => w.id !== selected.id), wip]);
      vmm.saveWip({
        emailId: selected.id, conversationId: selected.conversationId || '',
        subject: selected.subject || '', fromAddr: selected.fromAddr || '',
        storeCode: selected.storeCode || '', receivedAt: selected.receivedAt || '',
        repliedAt: wip.repliedAt, parsed, savedBy: wip.savedBy,
      }).catch(() => {});
      vmm.categorizeEmail(selected.id, ['WIP', 'New CRM']).catch(() => {});
      setInboxEmails(prev => prev.filter(e => e.id !== selected.id));
      setSelected(null); setParsed(null); setReplyBody('');
      showToast('Reply sent — email saved as WIP', 'ok');
    } catch {
      showToast('Failed to send reply', 'err');
    } finally { setSending(false); }
  };

  const sendReplyOnly = async () => {
    if (!replyBody.trim() || !selected) return;
    setSending(true);
    try {
      const html = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7">'
        + replyBody.split('\n').map(l => l.trim() ? `<p style="margin:0 0 8px">${l}</p>` : '<br/>').join('')
        + '<hr style="margin:16px 0;border:none;border-top:1px solid #e2e8f0"/>'
        + '<p style="font-size:11px;color:#64748b">Open Mind Services Limited — VMM CRM</p></div>';
      await vmm.sendEmailReply({
        messageId:      selected.id,
        conversationId: selected.conversationId || '',
        subject:        selected.subject || '',
        htmlBody:       html,
        body:           replyBody,
        toRecipients:   replyTo.join(';'),
        ccRecipients:   replyCc.join(';'),
      });
      setSelected(null); setParsed(null); setReplyBody('');
      showToast('Reply sent', 'ok');
    } catch {
      showToast('Failed to send reply', 'err');
    } finally { setSending(false); }
  };

  // ── Complaint item helpers ────────────────────────────────────────
  const updateItem = (id, patch) => setComplaintItems(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
  const removeItem = (id) => {
    setComplaintItems(prev => {
      const next = prev.filter(x => x.id !== id);
      if (id === activeComplaintId) setActiveComplaintId(next[0]?.id || null);
      return next.length ? next : [makeComplaintItem(++itemIdRef.current)];
    });
  };
  const addItem = () => {
    const id = ++itemIdRef.current;
    setActiveComplaintId(id);
    setComplaintItems(prev => [...prev, makeComplaintItem(id)]);
  };
  const updateActiveItem = (patch) => {
    if (activeComplaintId) updateItem(activeComplaintId, patch);
  };
  const toggleVendorEmail = (id, email) => setComplaintItems(prev => prev.map(x => {
    if (x.id !== id) return x;
    const emails = (x.vendorEmail || '').split(',').map(e => e.trim()).filter(Boolean);
    const next = emails.includes(email) ? emails.filter(e => e !== email) : [...emails, email];
    return { ...x, vendorEmail: next.join(', ') };
  }));
  const getItemHoEmail = (productName) => {
    const row = products.find(p => p.name.toLowerCase() === (productName || '').toLowerCase());
    return row?.hoEmail || HO_EMAIL;
  };

  const logComplaint = async () => {
    if (!parsed) return;
    if (selected.hasAttachments && !attachmentData) {
      showToast('Please load & save attachments to Drive before logging', 'err');
      return;
    }
    setLogging(true);
    try {
      const storeCode = parsedEdits.storeCode || parsed.storeCode || selected.storeCode || '';
      const empCode   = parsedEdits.employeeCode || parsed.employeeCode || '';
      const [storeRes, empRes] = await Promise.all([
        storeCode ? vmm.lookupStore(storeCode).catch(() => null) : Promise.resolve(null),
        empCode   ? vmm.lookupEmployee(empCode).catch(() => null) : Promise.resolve(null),
      ]);
      const store    = storeRes?.store  || {};
      const employee = empRes?.employee || {};
      const driveAttachments = (attachmentData || []).filter(a => a.viewLink);
      const providedText = parsed.alreadyProvided && Object.keys(parsed.alreadyProvided).length
        ? '\n\nDetails provided:\n' + Object.entries(parsed.alreadyProvided).map(([k, v]) => `- ${camelToLabel(k)}: ${v}`).join('\n')
        : '';
      const sharedPayload = {
        storeCode,
        storeName:           store.name || parsed.storeName || '',
        city:                store.city || '',
        region:              store.region || '',
        state:               store.state || '',
        zone:                store.zone || '',
        storeEmail:          store.email || '',
        smEmail:             store.smEmail || store.email || '',
        fmName:              store.fmName || employee.fmName || '',
        fmEmail:             store.fmEmail || '',
        fmMobile:            store.fmMobile || '',
        managerName:         store.managerName || employee.managerName || '',
        managerMobile:       store.managerMobile || '',
        asmName:             store.asmName || employee.asmName || '',
        asmMobile:           store.asmMobile || '',
        employeeCode:        parsedEdits.employeeCode || parsed.employeeCode || employee.code || '',
        employeeName:        resolvedEmpName || parsedEdits.employeeName || parsed.employeeName || employee.name || '',
        employeeEmail:       parsedEdits.employeeEmail || parsed.employeeEmail || employee.email || '',
        contactNumber:       parsedEdits.contactNumber || parsed.contactNumber || employee.mobile || '',
        designation:         employee.designation || '',
        productLocation:     parsedEdits.productLocation || parsed.productLocation || 'See email',
        source:              'E-mail',
        emailSubject:        selected.subject,
        callTxnId:           '',
        emailMessageId:      selected.id,
        emailConversationId: selected.conversationId || '',
        emailFrom:           selected.fromAddr || '',
        emailTo:             selected.toDisplay || '',
        uid: currentUser?.id ?? 1,
      };

      const allResults = [];
      for (const item of complaintItems) {
        const product = products.find(p => p.name.toLowerCase() === (item.productName || '').toLowerCase())
          || findBestByText(products, item.productName || '', ['name'])
          || { name: item.productName || '', vendor: item.vendorName || '', category: '' };
        const nature = natures.find(n => n.nature.toLowerCase() === (item.natureOfProblem || '').toLowerCase())
          || { nature: item.natureOfProblem || '', type: item.complaintType || 'Repair', tatDays: 7 };
        const itemAttachments = item.noImage ? [] : (
          item.selectedAttachIndices === null
            ? driveAttachments
            : (item.selectedAttachIndices || []).map(i => driveAttachments[i]).filter(Boolean)
        );
        const localNames = item.noImage ? [] : (item.localAttachments || []).map(f => f.name);
        const attachmentText = [...itemAttachments.map(a => `- ${a.name}: ${a.viewLink}`),
          ...localNames.map(name => `- ${name} (local upload)`)].length
          ? '\n\nAttachments:\n' + [
              ...itemAttachments.map(a => `- ${a.name}: ${a.viewLink}`),
              ...localNames.map(name => `- ${name} (local upload)`),
            ].join('\n')
          : '';
        const itemDescription = (item.description || parsedEdits.description || parsed.description || '')
          .replace(/\n+/g, ' ').trim();
        const warrantyLabel = item.warranty || getAutoWarranty(item.productName)
          || toWarrantyLabel(item.contractType);
        const itemLocation = item.productLocation || parsedEdits.productLocation || parsed.productLocation || 'See email';
        const itemAmcVendor = resolveStoreAmcVendor(
          amcRows, storeCode, product.name || item.productName, item.vendorName
        );
        const payload = {
          ...sharedPayload,
          productName:       product.name    || item.productName    || '',
          vendorName:        item.vendorName  || product.vendor      || '',
          productType:       item.productType || product.category || '',
          natureOfComplaint: nature.nature    || item.natureOfProblem || '',
          complaintType:     item.complaintType || nature.type       || 'Repair',
          contractType:      item.contractType || (warrantyLabel ? toContractType(warrantyLabel) : ''),
          warrantyStatus:    warrantyLabel,
          tatDays:           item.tatDays || nature.tatDays || 7,
          productLocation:   itemLocation,
          description:       itemDescription,
          vendorEmail:       item.vendorEmail || itemAmcVendor?.email || '',
          remarks:           complaintItems.length > 1
            ? `[${item.productName}] ${itemDescription}${providedText}${attachmentText}`.trim()
            : `${itemDescription}${providedText}${attachmentText}`.trim(),
          attachmentLinks:   itemAttachments,
        };
        const res = await vmm.logComplaint(payload);
        if (res.success) allResults.push({ res, item, payload, itemAttachments, amcVendor: itemAmcVendor });
        else { showToast(`"${item.productName || `Complaint ${allResults.length + 1}`}" failed: ${res.message || 'Unknown error'}`, 'err'); break; }
      }

      if (allResults.length === complaintItems.length) {
        const nos = allResults.map(r => r.res.complaintno).join(', ');
        const bodyLines = [
          'Dear Store Team,',
          '',
          allResults.length > 1
            ? `Your ${allResults.length} complaints have been registered successfully.`
            : 'Your complaint has been registered successfully.',
          '',
          ...allResults.map((r, i) =>
            allResults.length > 1
              ? `${i + 1}. ${r.payload.productName} — No: ${r.res.complaintno}, EDC: ${r.res.edcDate}`
              : `Complaint No: ${r.res.complaintno}\nProduct: ${r.payload.productName}\nExpected Closure: ${r.res.edcDate}`
          ),
          '',
          'Our team will follow up within the expected closure date.',
          '',
          'Regards,',
          'Open Mind Services',
        ];
        const confirmBody = bodyLines.join('\n');
        const confirmHtml = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7">'
          + confirmBody.split('\n').map(l => l.trim() ? `<p style="margin:0 0 8px">${l}</p>` : '<br/>').join('')
          + '<hr style="margin:16px 0;border:none;border-top:1px solid #e2e8f0"/>'
          + '<p style="font-size:11px;color:#64748b">Open Mind Services Limited — VMM CRM</p></div>';
        const OWN = 'vmm.helpdesk@openmind.in';
        const origMsg = [...threadMessages].sort((a, b) => new Date(a.receivedDateTime) - new Date(b.receivedDateTime))[0];
        const threadCCList = (origMsg?.cc || '').split(',').map(c => c.trim()).filter(Boolean).filter(cc => cc.toLowerCase() !== OWN);
        const hoCCList = [...new Set(
          allResults.map(({ item }) => (HO_POC[item.productName] || HO_POC['DEFAULT'])?.email).filter(Boolean)
        )];
        // Case-insensitive dedup: thread CCs first, then add HO only if not already present
        const seenCC = new Map();
        [...threadCCList, ...hoCCList].forEach(e => { if (e && !seenCC.has(e.toLowerCase())) seenCC.set(e.toLowerCase(), e); });
        const allCCs = [...seenCC.values()].join(';');
        // Always reply to the selected (incoming) email, not the latest thread message which may be outbound
        const replyMsgId = selected.id;
        await vmm.sendEmailReply({ messageId: replyMsgId, htmlBody: confirmHtml, body: confirmBody, toRecipients: selected.fromAddr || sharedPayload.storeEmail, ccRecipients: allCCs })
          .catch(err => { console.warn('Confirmation reply failed:', err); showToast('Complaint logged but confirmation email could not be sent', 'warn'); });
        vmm.categorizeEmail(replyMsgId, ['Case Logged', 'New CRM']).catch(() => {});
        const wipMatch = wipList.find(w =>
          w.id === selected.id ||
          (w.conversationId && selected.conversationId && w.conversationId === selected.conversationId)
        ) || (selected.status === 'WIP' ? selected : null);
        if (wipMatch && wipMatch.id !== replyMsgId) {
          vmm.categorizeEmail(wipMatch.id, ['Case Logged', 'New CRM']).catch(() => {});
        }
        // One escalation email per complaint item (different product/vendor each)
        for (const { res, item, payload: iPayload, itemAttachments, amcVendor } of allResults) {
          vmm.sendEscalationEmail({
            storeCode:         sharedPayload.storeCode  || '',
            storeName:         sharedPayload.storeName  || '',
            storeEmail:        sharedPayload.storeEmail || '',
            fmName:            sharedPayload.fmName     || '',
            fmEmail:           sharedPayload.fmEmail    || '',
            vendorName:        item.vendorName          || '',
            productName:       iPayload.productName     || '',
            natureOfComplaint: item.natureOfProblem     || '',
            storeState:        store.state              || '',
            storeCity:         store.city               || '',
            manualVendorEmail: item.vendorEmail         || '',
            amcVendorEmail:    amcVendor?.email          || '',
            amcVendorName:     amcVendor?.name           || '',
            amcVendorSource:   amcVendor?.source         || '',
            complaints: [{ complaintno: res.complaintno, productLocation: iPayload.productLocation, natureOfProblem: item.natureOfProblem || '', edcDate: res.edcDate, description: iPayload.description }],
            attachmentLinks: itemAttachments,
            extraToEmails: item.extraEscTo.split(/[;,]/).map(s => s.trim()).filter(Boolean),
            extraCcEmails: item.extraEscCc.split(/[;,]/).map(s => s.trim()).filter(Boolean),
            skipSM: (item.removedAutoCC || []).includes('SM'),
            skipHO: (item.removedAutoCC || []).includes('HO'),
            skipFM: (item.removedAutoCC || []).includes('FM'),
          }).catch(err => {
            console.error('Escalation email failed:', err);
            showToast(`Escalation email failed for ${item.vendorName || item.vendorEmail || 'vendor'} — ${err?.message || 'unknown error'}`, 'warn');
          });
        }
        claimEmail(selected.id, 'release');
        tagEmail(selected.id, 'logged', `Logged • ${nos} • Agent ${agentId.slice(-4)}`);
        if (wipMatch) {
          setWipList(prev => prev.filter(w =>
            w.id !== wipMatch.id &&
            !(selected.conversationId && w.conversationId && w.conversationId === selected.conversationId)
          ));
          vmm.resolveWip(wipMatch.id)
            .then(res => { if (!res?.success) showToast('WIP may reappear on reload — dismiss it manually if needed', 'warn'); })
            .catch(() => { showToast('WIP may reappear on reload — dismiss it manually if needed', 'warn'); });
        }
        setInboxEmails(prev => prev.find(e => e.id === selected.id) ? prev : [{ ...selected, hasStoreCode: !!selected.storeCode }, ...prev]);
        setLogSuccess({
          results: allResults.map(r => r.res),
          payload: { ...sharedPayload, productName: allResults.map(r => r.payload.productName).join(', ') },
        });
        setSelected(null); setParsed(null); setReplyBody('');
      }
    } catch {
      showToast('Could not log complaint — server error', 'err');
    } finally { setLogging(false); }
  };

  const openReplyEditor = () => {
    setShowReplyEditor(true);
    if (replyBody.trim()) return; // already has a draft (from AI suggestedReply)
    // Generate draft from missing template fields
    const missing = (parsed?.missingFromTemplate || []).filter(Boolean);
    const lines = [
      'Dear SM,',
      '',
      'Thank you for reaching out. To process your complaint, kindly share the following details:',
      '',
      ...(missing.length > 0
        ? missing.map(f => `• ${camelToLabel(f)}`)
        : ['• Additional details as per the template']),
      '',
      'Please reply at the earliest so we can log and assign the complaint.',
      '',
      'Regards,',
      'VMM Helpdesk Team',
      'Open Mind Services Limited',
    ];
    setReplyBody(lines.join('\n'));
  };

  // Same validation as New Case, applied independently to every complaint item.
  const isFixedVendorOK = (item) => !!getFixedVendor(item.productName);
  const getItemErrors = (item) => {
    const e = {};
    const auto     = getAutoWarranty(item.productName);
    const warranty = item.warranty || auto;
    if (item.productUnmatched)                  e.productName        = `“${item.aiProductName || item.productName}” does not exist in the product dropdown — select a valid product`;
    else if (!item.productName)                 e.productName        = 'Select a product';
    if (!item.natureOfProblem)                  e.natureOfComplaint  = 'Select nature of complaint';
    if (!warranty)                              e.warranty           = 'Select warranty / AMC status';
    if (!isFixedVendorOK(item) && !isHoDirectProduct(item.productName)
        && (warranty === 'Under Warranty' || warranty === 'Under AMC' || isGensetProduct(item.productName))
        && !item.vendorName) {
      e.vendor = warranty === 'Under Warranty' ? 'Select a brand (or choose None of the above)'
               : warranty === 'Under AMC' ? 'Select or enter the AMC vendor'
               : 'Enter the vendor name';
    }
    if (!(item.productLocation || '').trim())   e.productLocation    = 'Product location is required';
    if (!(item.description || '').trim())       e.description        = 'Complaint description is required';
    const driveFiles = (attachmentData || []).filter(a => a.viewLink);
    const selectedDrive = item.noImage ? 0 : (
      item.selectedAttachIndices === null ? driveFiles.length : (item.selectedAttachIndices || []).length
    );
    const attachmentsCount = selectedDrive + (item.noImage ? 0 : (item.localAttachments || []).length);
    if (ATTACHMENT_MANDATORY.includes(item.complaintType) && attachmentsCount === 0 && !item.noImage)
      e.attachments = `At least 1 attachment is mandatory for ${item.complaintType} complaints (or check "No image available")`;
    return e;
  };

  const itemErrors = complaintItems.map(getItemErrors);
  const storeOk    = !!(parsedEdits.storeCode || parsed?.storeCode || selected?.storeCode);
  const employeeOk = !parsed?.employeeCode || empLookupStatus === 'found';
  const canLog     = !!parsed && storeOk && employeeOk && complaintItems.length > 0
    && itemErrors.every(errs => Object.keys(errs).length === 0);
  const activeItem = complaintItems.find(x => x.id === activeComplaintId) || complaintItems[0] || null;
  const activeStoreCode = parsedEdits.storeCode || parsed?.storeCode || selected?.storeCode || '';
  const activeAmcVendor = activeItem
    ? resolveStoreAmcVendor(amcRows, activeStoreCode, activeItem.productName, activeItem.vendorName)
    : null;
  const activeManualVendorEmails = activeItem?.vendorEmail || '';
  const activeManualVendorEmailSet = new Set(activeManualVendorEmails.split(',').map(e => e.trim()).filter(Boolean));
  const activeEscVendorEmails = activeManualVendorEmails || activeAmcVendor?.email || '';
  const activeErrors = activeItem && showValidation ? getItemErrors(activeItem) : {};
  // Products the AI could not map to the master list. The warning disappears as
  // soon as the agent picks a real product (or adds one through the dropdown).
  const unmatchedProducts = complaintItems
    .filter(x => x.productUnmatched)
    .map(x => x.aiProductName || x.productName)
    .filter(Boolean);

  const attemptLog = () => {
    setShowValidation(true);
    if (canLog) setConfirmModal(true);
    else showToast('Complete the highlighted fields before logging', 'err');
  };

  const handleTemplateChange = (newId) => {
    setSelectedTemplateId(newId);
    const tpl = templates.find(t => t.id === parseInt(newId));
    if (tpl) {
      // Strip HTML to plain text for the reply body
      const plain = tpl.body.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, '\n[Table format — fill in required fields]\n')
        .replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
      setReplyBody(plain);
    }
  };

  const baseEmails = (() => {
    if (activeTab !== 'inbox') return emails;
    let list = [...emails];
    // Hide emails belonging to open WIP conversations — they show in the WIP tab only
    list = list.filter(e => !e.conversationId || !wipList.some(w => w.conversationId && w.conversationId === e.conversationId));
    if (readFilter === 'unread') list = list.filter(e => !e.isRead);
    if (readFilter === 'read')   list = list.filter(e =>  e.isRead);
    if (sortOrder  === 'oldest') list.sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));
    return list;
  })();

  return (
    <div className="ec-page">
      {toast && <div className={`ec-toast ec-toast-${toast.type}`}>{toast.msg}</div>}

      {/* Resend Escalation Modal */}
      {resendModal && (
        <div className="ec-modal-overlay" onClick={() => !resendSending && setResendModal(false)}>
          <div className="ec-modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div className="ec-modal-header">
              <div className="ec-modal-subject">↗ Resend Escalation Email</div>
              <button className="ec-modal-close" onClick={() => setResendModal(false)} disabled={resendSending}>✕</button>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Complaint number lookup */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Complaint Number</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                    value={resendNo}
                    onChange={e => { setResendNo(e.target.value); setResendData(null); }}
                    placeholder="e.g. 26072222305"
                    onKeyDown={e => e.key === 'Enter' && lookupResendComplaint()}
                  />
                  <button
                    onClick={lookupResendComplaint}
                    disabled={resendLoading || !resendNo.trim()}
                    style={{ padding: '7px 16px', background: '#1e1b4b', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {resendLoading ? 'Looking up…' : 'Look Up'}
                  </button>
                </div>
              </div>

              {/* Complaint details */}
              {resendData && (() => {
                const autoVendor = resolveStoreAmcVendor(
                  amcRows, resendData.storecode, resendData.productname, resendData.vendorname
                );
                const { toAddresses, ccAddresses } = vmm.resolveEscalationRecipients({
                  storeCode: resendData.storecode, storeEmail: resendData.storeemail, storeName: resendData.storename,
                  fmEmail: resendData.fmemail, fmName: resendData.fmname,
                  vendorName: resendData.vendorname, productName: resendData.productname,
                  storeState: resendData.statename, storeCity: resendData.storecity,
                  manualVendorEmail: resendVendorEmail.trim(),
                  amcVendorEmail:    autoVendor?.email  || '',
                  amcVendorName:     autoVendor?.name   || '',
                  amcVendorSource:   autoVendor?.source || '',
                });
                const toSet = new Set(toAddresses.map(r => r.emailAddress.address.toLowerCase()));
                const previewCC = ccAddresses.filter(r => !toSet.has(r.emailAddress.address.toLowerCase()));
                return (
                  <>
                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                        <div><span style={{ color: '#6b7280' }}>Store</span><br/><strong>{resendData.storename} ({resendData.storecode})</strong></div>
                        <div><span style={{ color: '#6b7280' }}>Product</span><br/><strong>{resendData.productname}</strong></div>
                        <div><span style={{ color: '#6b7280' }}>Vendor</span><br/><strong>{resendData.vendorname || '—'}</strong></div>
                        <div><span style={{ color: '#6b7280' }}>EDC</span><br/><strong>{resendData.edcdate || '—'}</strong></div>
                        <div><span style={{ color: '#6b7280' }}>Nature</span><br/><strong>{resendData.natureofproblem || '—'}</strong></div>
                        <div><span style={{ color: '#6b7280' }}>Status</span><br/><strong>{resendData.current_status || '—'}</strong></div>
                      </div>
                    </div>

                    {/* Vendor email */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                        Vendor Email <span style={{ color: '#ef4444' }}>*</span>
                        <span style={{ color: '#6b7280', fontWeight: 400, marginLeft: 6 }}>(auto-filled from store AMC when available)</span>
                      </div>
                      <input
                        style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
                        value={resendVendorEmail}
                        onChange={e => setResendVendorEmail(e.target.value)}
                        placeholder="vendor@example.com  (comma-separate for multiple)"
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                        Description / Remarks <span style={{ color: '#6b7280', fontWeight: 400 }}>(optional — not stored in DB)</span>
                      </div>
                      <textarea
                        style={{ width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, minHeight: 60, resize: 'vertical', boxSizing: 'border-box' }}
                        value={resendDescription}
                        onChange={e => setResendDescription(e.target.value)}
                        placeholder="Paste the complaint description here if needed…"
                      />
                    </div>

                    {/* Recipient preview */}
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
                      <div style={{ fontWeight: 600, color: '#374151', marginBottom: 6 }}>Will send to:</div>
                      <div style={{ marginBottom: 4 }}>
                        <span style={{ color: '#6b7280' }}>TO: </span>
                        {toAddresses.length
                          ? toAddresses.map(r => r.emailAddress.address).join(', ')
                          : <span style={{ color: '#ef4444' }}>No vendor email entered</span>}
                      </div>
                      <div>
                        <span style={{ color: '#6b7280' }}>CC: </span>
                        {previewCC.length ? previewCC.map(r => r.emailAddress.address).join(', ') : '—'}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                      <button onClick={() => setResendModal(false)} disabled={resendSending}
                        style={{ padding: '8px 18px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', fontSize: 13, cursor: 'pointer' }}>
                        Cancel
                      </button>
                      <button onClick={sendResendEscalation} disabled={resendSending || !resendVendorEmail.trim()}
                        style={{ padding: '8px 18px', background: !resendVendorEmail.trim() ? '#94a3b8' : '#059669', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: resendVendorEmail.trim() ? 'pointer' : 'not-allowed', fontWeight: 600 }}>
                        {resendSending ? 'Sending…' : '↗ Send Escalation Email'}
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Full Email / Thread Popup */}
      {emailModal && (
        <div className="ec-modal-overlay" onClick={() => setEmailModal(null)}>
          <div className="ec-modal" onClick={e => e.stopPropagation()}>
            <div className="ec-modal-header">
              <div className="ec-modal-subject">{emailModal.subject}</div>
              <button className="ec-modal-close" onClick={() => setEmailModal(null)} title="Close (ESC)">✕</button>
            </div>

            {threadLoading ? (
              <div className="ec-thread-loading">Loading conversation…</div>
            ) : threadMessages.length > 0 ? (
              <div className="ec-thread-messages">
                {threadMessages.length > 1 && (
                  <div className="ec-thread-count-bar">
                    {threadMessages.length} messages in this thread
                  </div>
                )}
                {[...threadMessages].reverse().map((msg, i) => {
                  const OWN_MAILBOX = 'vmm.helpdesk@openmind.in';
                  const isOutbound = msg.from.toLowerCase() === OWN_MAILBOX;
                  const initial = (msg.fromName || msg.from || '?')[0].toUpperCase();
                  const dt = msg.receivedDateTime || msg.sentDateTime;
                  return (
                    <div key={msg.id || i} className={`ec-thread-msg ${isOutbound ? 'outbound' : 'inbound'}`}>
                      <div className="ec-thread-msg-avatar">{initial}</div>
                      <div className="ec-thread-msg-content">
                        <div className="ec-thread-msg-header">
                          <div className="ec-thread-msg-sender">
                            <span className="ec-thread-msg-from">{msg.fromName || msg.from}</span>
                            {msg.fromName && msg.from && msg.from !== msg.fromName && (
                              <span className="ec-thread-msg-email">&lt;{msg.from}&gt;</span>
                            )}
                            {i === 0 && <span className="ec-thread-latest">Latest</span>}
                            {isOutbound && <span className="ec-thread-sent-tag">Sent by us</span>}
                          </div>
                          <span className="ec-thread-msg-time">
                            {dt ? new Date(dt).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : ''}
                          </span>
                        </div>
                        {(msg.toFull || msg.to) && (
                          <div className="ec-thread-recip-row">
                            <span className="ec-thread-recip-label">To:</span>
                            <span className="ec-thread-recip-val">{msg.toFull || msg.to}</span>
                          </div>
                        )}
                        {(msg.ccFull || msg.cc) && (
                          <div className="ec-thread-recip-row">
                            <span className="ec-thread-recip-label">CC:</span>
                            <span className="ec-thread-recip-val">{msg.ccFull || msg.cc}</span>
                          </div>
                        )}
                        <div
                          className="ec-thread-msg-body"
                          dangerouslySetInnerHTML={{
                            __html: (msg.bodyHtml || msg.body || '(No content)')
                              .replace(/<script[\s\S]*?<\/script>/gi, '')
                              .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
                              .replace(/on\w+="[^"]*"/gi, '')
                              .replace(/on\w+='[^']*'/gi, '')
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className="ec-modal-body"
                dangerouslySetInnerHTML={{
                  __html: (emailModal.bodyHtml || emailModal.body || '(No content)')
                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
                    .replace(/<object[\s\S]*?<\/object>/gi, '')
                    .replace(/on\w+="[^"]*"/gi, '')
                    .replace(/on\w+='[^']*'/gi, '')
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {confirmModal && (
        <div className="ec-confirm-overlay" onClick={() => setConfirmModal(false)}>
          <div className="ec-confirm-modal" onClick={e => e.stopPropagation()}>
            <div style={{ padding: '24px 28px 16px', flexShrink: 0 }}>
              <div className="ec-confirm-title">Confirm before logging</div>
              <div className="ec-confirm-subtitle">Please verify all details are correct:</div>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '0 28px' }}>
              <div className="ec-confirm-grid">
                {[
                  { label: 'Store Code',     val: parsedEdits.storeCode || parsed?.storeCode || selected?.storeCode, req: true },
                  { label: 'Employee Code',  val: parsedEdits.employeeCode || parsed?.employeeCode,  req: false },
                  { label: 'Employee Name',  val: resolvedEmpName || parsedEdits.employeeName || parsed?.employeeName, req: false },
                  { label: 'Employee Email', val: parsedEdits.employeeEmail || parsed?.employeeEmail, req: false },
                  { label: 'Contact Number', val: parsedEdits.contactNumber || parsed?.contactNumber, req: false },
                ].map(({ label, val, req }) => (
                  <div key={label} className={`ec-confirm-row${!val && req ? ' warn' : ''}`}>
                    <span className="ec-confirm-label">{label}</span>
                    <span className={`ec-confirm-val${!val ? ' empty' : ''}`}>{val || (req ? '⚠ Missing' : '—')}</span>
                  </div>
                ))}
              </div>
              {complaintItems.map((item, idx) => {
                const itemAmcVendor = resolveStoreAmcVendor(
                  amcRows, activeStoreCode, item.productName, item.vendorName
                );
                const escalationTo = item.vendorEmail || itemAmcVendor?.email || '';
                return (
                <div key={item.id} style={{ margin: '8px 0', padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: '#4f46e5', marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    {complaintItems.length > 1 ? `Complaint #${idx + 1}` : 'Complaint'}
                  </div>
                  {[
                    { label: 'Product',          val: item.productName,    req: true },
                    { label: 'Contract',         val: item.contractType === 'AMC' ? 'Under AMC' : item.contractType === 'Warranty' ? 'Under Warranty' : item.contractType === 'NotApplicable' ? 'Not Applicable' : '', req: true },
                    { label: 'Vendor',           val: item.vendorName,     req: false },
                    ...(escalationTo ? [{ label: 'Escalation To', val: escalationTo, req: false }] : []),
                    { label: 'Nature',           val: item.natureOfProblem, req: true },
                    { label: 'Type',             val: item.complaintType,   req: true },
                    { label: 'Description',      val: item.description,     req: complaintItems.length > 1 },
                    { label: 'Images',           val: item.selectedAttachIndices === null ? 'All' : `${item.selectedAttachIndices.length} selected`, req: false },
                  ].map(({ label, val, req }) => (
                    <div key={label} className={`ec-confirm-row${!val && req ? ' warn' : ''}`}>
                      <span className="ec-confirm-label">{label}</span>
                      <span className={`ec-confirm-val${!val ? ' empty' : ''}`} style={{ wordBreak: 'break-word', maxWidth: '65%', textAlign: 'right' }}>{val || (req ? '⚠ Missing' : '—')}</span>
                    </div>
                  ))}
                </div>
                );
              })}
            </div>
            <div className="ec-confirm-actions" style={{ padding: '16px 28px 24px', flexShrink: 0, borderTop: '1px solid #f1f5f9' }}>
              <button className="ec-confirm-cancel" onClick={() => setConfirmModal(false)}>Go Back &amp; Edit</button>
              <button className="ec-confirm-ok" onClick={() => { setConfirmModal(false); logComplaint(); }}>
                {complaintItems.length > 1 ? `Confirm — Log ${complaintItems.length} Complaints` : 'Confirm — Log Complaint'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="ec-top-bar">
        <div className="ec-top-title">
          <h2>Email Complaints</h2>
          <p>Fetch, review and log complaints from store emails</p>
        </div>
        <div className="ec-tabs-row">
          <div className="ec-tabs">
            <button
              className={`ec-tab ${activeTab === 'inbox' ? 'active' : ''}`}
              onClick={() => switchTab('inbox')}
            >
              ✉ Inbox
              {emails.length > 0 && activeTab !== 'sent' && (
                <span className="ec-tab-count">{activeTab === 'wip' ? emails.length : emails.length}</span>
              )}
            </button>
            <button
              className={`ec-tab ${activeTab === 'wip' ? 'active' : ''}`}
              onClick={() => switchTab('wip')}
            >
              ⏳ WIP
              {wipList.length > 0 && (
                <span className="ec-tab-count">{wipList.length}</span>
              )}
              {totalWipReplies > 0 && (
                <span className="ec-tab-reply-badge">↩ {totalWipReplies}</span>
              )}
            </button>
            <button
              className={`ec-tab ${activeTab === 'sent' ? 'active' : ''}`}
              onClick={() => switchTab('sent')}
            >
              ↑ Sent
              {activeTab === 'sent' && emails.length > 0 && (
                <span className="ec-tab-count">{emails.length}</span>
              )}
            </button>
            <button
              className={`ec-tab ${activeTab === 'matrix' ? 'active' : ''}`}
              onClick={() => switchTab('matrix')}
            >
              📋 Escalation
              {activeTab === 'matrix' && complaintItems[0]?.vendorEmail && (
                <span className="ec-tab-count">
                  {complaintItems[0].vendorEmail.split(',').map(e => e.trim()).filter(Boolean).length}
                </span>
              )}
            </button>
          </div>
          <button
            className="ec-refresh-btn"
            style={{ marginRight: 6 }}
            onClick={() => { setResendModal(true); setResendNo(''); setResendData(null); }}
            title="Resend escalation email for a logged complaint"
          >
            ↗ Resend Escalation
          </button>
          <button
            className="ec-refresh-btn"
            onClick={() => fetchEmails()}
            disabled={fetching}
            title="Refresh emails"
          >
            {fetching ? '⟳' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      <div className="ec-layout">

        {/* ── LEFT: Email List ── */}
        <div className="ec-left">
          <div className="ec-left-head">
            <span className="ec-folder-label">
              {activeTab === 'sent' ? '↑ Sent Items' : activeTab === 'wip' ? '⏳ WIP Cases' : activeTab === 'matrix' ? '📋 Escalation Matrix' : '✉ Inbox'}
            </span>
            {activeTab === 'matrix'
              ? (() => {
                  const cnt = (complaintItems[0]?.vendorEmail || '').split(',').map(e => e.trim()).filter(Boolean).length;
                  return cnt > 0 ? <span className="ec-count">{cnt} selected</span> : null;
                })()
              : activeTab === 'wip'
                ? <span className="ec-count">{wipList.length} pending</span>
                : fetching
                  ? <span className="ec-loading-dot">Loading…</span>
                  : emails.length > 0 && (
                      <span className="ec-count">{emails.length} {activeTab === 'sent' ? 'emails' : 'unread'}</span>
                    )
            }
          </div>

          {/* Matrix filter bar — only when escalation tab is active */}
          {activeTab === 'matrix' && (
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
              <input
                placeholder="Search vendor, contact…"
                value={emSearch}
                onChange={e => setEmSearch(e.target.value)}
                style={{ flex: '1 1 120px', padding: '5px 9px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, outline: 'none' }}
              />
              <select value={emRegion} onChange={e => setEmRegion(e.target.value)}
                style={{ padding: '5px 7px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>
                <option value="">All Regions</option>
                {['Pan India','North','South','East','West'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={emLevel} onChange={e => setEmLevel(e.target.value)}
                style={{ padding: '5px 7px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>
                <option value="">All Levels</option>
                {['First Call','Level 1','Level 2','Level 3','Level 4','Level 5'].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          )}
          {activeTab === 'matrix' && !parsed && (
            <div style={{ padding: '5px 14px', background: '#fef3c7', fontSize: 11, color: '#92400e', borderBottom: '1px solid #fcd34d', flexShrink: 0 }}>
              ⚠ Parse an email complaint first — selections will apply to that TO field
            </div>
          )}

          {/* Search bar — only for inbox/wip/sent tabs */}
          {activeTab !== 'matrix' && <div className="ec-search-bar">
            <div className="ec-search-input-wrap">
              <span className="ec-search-icon">🔍</span>
              <input
                ref={searchInputRef}
                type="text"
                className="ec-search-input"
                placeholder="Search subject, sender, store…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
              />
              {searchQuery && (
                <button className="ec-search-clear" onClick={clearSearch} title="Clear search">✕</button>
              )}
            </div>
            <button
              className="ec-search-btn"
              disabled={!searchQuery.trim() || searching}
              onClick={() => runSearch()}
            >
              {searching ? '…' : 'Go'}
            </button>
          </div>}

          {searchMode && (
            <div className="ec-search-result-bar">
              <span>Results for: <strong>"{searchQuery}"</strong> ({emails.length})</span>
              <button onClick={clearSearch}>← Back to Inbox</button>
            </div>
          )}

          {/* Read / Sort controls */}
          {!searchMode && activeTab === 'inbox' && (
            <div className="ec-inbox-controls">
              <div className="ec-ictl-group">
                {[['all','All'],['unread','Unread'],['read','Read']].map(([v,l]) => (
                  <button key={v} className={`ec-tag-filter-btn${readFilter === v ? ' active' : ''}`} onClick={() => setReadFilter(v)}>{l}</button>
                ))}
              </div>
              <div className="ec-ictl-sep" />
              <div className="ec-ictl-group">
                <button className={`ec-tag-filter-btn${sortOrder === 'newest' ? ' active' : ''}`} onClick={() => setSortOrder('newest')}>↓ Newest</button>
                <button className={`ec-tag-filter-btn${sortOrder === 'oldest' ? ' active' : ''}`} onClick={() => setSortOrder('oldest')}>↑ Oldest</button>
              </div>
            </div>
          )}

          {/* Tag filter bar */}
          {!searchMode && (() => {
            const getTag = e => emailTags[e.id] || inferTagFromCategories(e.categories);
            const loggedN    = emails.filter(e => getTag(e)?.type === 'logged').length;
            const updatedN   = emails.filter(e => ['updated','escalated','closed'].includes(getTag(e)?.type)).length;
            if (!loggedN && !updatedN) return null;
            return (
              <div className="ec-tag-filter-bar">
                <button className={`ec-tag-filter-btn ${tagFilter === null ? 'active' : ''}`} onClick={() => setTagFilter(null)}>All</button>
                {loggedN > 0 && (
                  <button className={`ec-tag-filter-btn logged ${tagFilter === 'logged' ? 'active' : ''}`} onClick={() => setTagFilter(tagFilter === 'logged' ? null : 'logged')}>
                    ✓ Logged<span className="ec-filter-count">{loggedN}</span>
                  </button>
                )}
                {updatedN > 0 && (
                  <button className={`ec-tag-filter-btn updated ${tagFilter === 'updated' ? 'active' : ''}`} onClick={() => setTagFilter(tagFilter === 'updated' ? null : 'updated')}>
                    ↻ Updated<span className="ec-filter-count">{updatedN}</span>
                  </button>
                )}
              </div>
            );
          })()}


          <div className="ec-email-list">

            {/* ── ESCALATION MATRIX TAB: contact list with multi-select ── */}
            {activeTab === 'matrix' && (() => {
              const first = complaintItems[0];
              const selectedEmailSet = new Set((first?.vendorEmail || '').split(',').map(e => e.trim()).filter(Boolean));
              if (emLoading) return <div className="ec-empty">Loading escalation matrix…</div>;
              const rows = escalationMatrix.filter(c =>
                (!emSearch || (c.vendorName || '').toLowerCase().includes(emSearch.toLowerCase()) || (c.contactPerson || '').toLowerCase().includes(emSearch.toLowerCase()) || (c.email || '').toLowerCase().includes(emSearch.toLowerCase())) &&
                (!emRegion || c.region === emRegion) &&
                (!emLevel  || c.level  === emLevel)
              );
              if (!rows.length) return <div className="ec-empty">No contacts match filters</div>;
              return rows.map((c, i) => {
                const isSel = c.email && selectedEmailSet.has(c.email);
                return (
                  <div key={i}
                    onClick={() => c.email && first && toggleVendorEmail(first.id, c.email)}
                    style={{
                      padding: '10px 14px', cursor: c.email && first ? 'pointer' : 'default',
                      borderBottom: '1px solid #f1f5f9',
                      background: isSel ? '#f0fdf4' : 'transparent',
                      borderLeft: `3px solid ${isSel ? '#22c55e' : 'transparent'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <input type="checkbox" checked={isSel} readOnly
                        style={{ marginTop: 3, cursor: c.email && first ? 'pointer' : 'default', accentColor: '#22c55e', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>{c.vendorName}</span>
                          <span style={{ fontSize: 10, background: '#dbeafe', color: '#1d4ed8', borderRadius: 4, padding: '1px 5px', fontWeight: 700, flexShrink: 0 }}>{c.level}</span>
                          <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto' }}>{c.region}</span>
                        </div>
                        {c.contactPerson && <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>{c.contactPerson}</div>}
                        {c.email && <div style={{ fontSize: 11, color: '#0369a1', marginTop: 1 }}>{c.email}</div>}
                        {(c.mobile1 || c.customerCareNo) && <div style={{ fontSize: 11, color: '#64748b' }}>{c.mobile1 || c.customerCareNo}</div>}
                      </div>
                    </div>
                  </div>
                );
              });
            })()}

            {/* ── WIP TAB: dedicated WIP panel ── */}
            {activeTab === 'wip' && (
              <>
                {wipList.length === 0 && (
                  <div className="ec-empty">No WIP cases — all caught up!</div>
                )}
                {wipList.map(w => {
                  const replyCount = wipReplyCounts[w.id] || 0;
                  return (
                    <div key={w.id} className={`ec-email-row wip ${selected?.id === w.id ? 'active' : ''} ${replyCount > 0 ? 'has-reply' : ''}`}
                      onClick={() => selectEmail({ ...w, body: '' })}>
                      <div className="ec-email-store">
                        {w.storeCode ? <span className="ec-store-code">{w.storeCode}</span> : <span className="ec-unknown">?</span>}
                        <span className="ec-wip-tag">WIP</span>
                        {w.savedBy && <span className="ec-wip-agent-tag">{w.savedBy}</span>}
                        {replyCount > 0 && <span className="ec-wip-reply-count">↩ {replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>}
                        <span className="ec-email-time">{fmtTime(w.repliedAt)}</span>
                        <button className="ec-wip-dismiss-x"
                          title="Dismiss WIP"
                          onClick={e => {
                            e.stopPropagation();
                            if (!window.confirm(`Dismiss WIP for "${w.subject}"?\n\nOnly confirm if this case is no longer pending.`)) return;
                            setWipList(prev => prev.filter(x => x.id !== w.id));
                            vmm.resolveWip(w.id).catch(() => {});
                            if (selected?.id === w.id) { setSelected(null); setParsed(null); }
                            showToast('WIP dismissed', 'info');
                          }}>×</button>
                      </div>
                      <div className="ec-email-subject">{w.subject}</div>
                      <div className="ec-email-meta ec-wip-meta">
                        {w.parsed?.employeeCode && <span className="ec-wip-detail">Emp: {w.parsed.employeeCode}</span>}
                        {w.parsed?.productName  && <span className="ec-wip-detail">{w.parsed.productName}</span>}
                        {!w.parsed?.employeeCode && !w.parsed?.productName && <span>{w.fromAddr}</span>}
                        {(w.parsed?.missingFromTemplate || []).length > 0 && (
                          <span className="ec-wip-missing">Missing: {w.parsed.missingFromTemplate.slice(0, 2).map(f => camelToLabel(f)).join(', ')}{w.parsed.missingFromTemplate.length > 2 ? ` +${w.parsed.missingFromTemplate.length - 2}` : ''}</span>
                        )}
                      </div>
                      {replyCount > 0 && (
                        <div className="ec-wip-reply-hint">Store replied — click Re-parse to extract new info</div>
                      )}
                    </div>
                  );
                })}
              </>
            )}


            {tagFilter !== 'wip' && baseEmails.length > 0 && (() => {
              const getTag = e => emailTags[e.id] || inferTagFromCategories(e.categories);
              const filtered = tagFilter === 'logged' ? baseEmails.filter(e => getTag(e)?.type === 'logged')
                : tagFilter === 'updated' ? baseEmails.filter(e => ['updated','escalated','closed'].includes(getTag(e)?.type))
                : baseEmails;
              return filtered.length > 0 ? (
                <div className="ec-section-label">
                  {tagFilter === 'logged' ? `Logged (${filtered.length})` : activeTab === 'sent' ? `Sent Items (${filtered.length})` : `${readFilter === 'unread' ? 'Unread' : readFilter === 'read' ? 'Read' : 'All'} Inbox (${filtered.length})`}
                </div>
              ) : null;
            })()}
            {activeTab !== 'wip' && emails.length === 0 && (
              <div className="ec-empty">
                Click Refresh to load emails from VMM2.
              </div>
            )}
            {activeTab !== 'wip' && tagFilter !== 'wip' && (() => {
              const getTag2 = e => emailTags[e.id] || inferTagFromCategories(e.categories);
              return (tagFilter === 'logged' ? baseEmails.filter(e => getTag2(e)?.type === 'logged')
                : tagFilter === 'updated' ? baseEmails.filter(e => ['updated','escalated','closed'].includes(getTag2(e)?.type))
                : baseEmails);
            })().map(e => {
              const typeLabel = e.emailType === 'complaint-reply' ? { label: `#${e.complaintId}`, cls: 'ec-complaint-badge' }
                : e.emailType === 'new-complaint'    ? { label: 'New', cls: 'ec-new-badge' }
                : { label: 'Other', cls: 'ec-reply-badge' };
              const claim          = activeClaims[e.id];
              const claimedByOther = claim && claim.agentId !== agentId;
              const tag            = emailTags[e.id] || inferTagFromCategories(e.categories);
              const wipReplyFor    = wipList.find(w =>
                w.conversationId && e.conversationId && w.conversationId === e.conversationId
              );
              return (
                <div key={e.id} className={`ec-email-row ${selected?.id === e.id ? 'active' : ''} ${!e.hasStoreCode ? 'no-store' : ''} ${claimedByOther ? 'claimed' : ''} ${tag ? `tagged-${tag.type}` : ''} ${wipReplyFor ? 'wip-reply' : ''}`}
                  onClick={() => selectEmail(e)}>
                  <div className="ec-email-store">
                    {e.storeCode
                      ? <span className="ec-store-code">{e.storeCode}</span>
                      : <span className="ec-unknown">? Unknown</span>}
                    {wipReplyFor
                      ? <span className="ec-wip-reply-tag">↩ WIP Reply</span>
                      : <span className={typeLabel.cls}>{typeLabel.label}</span>}
                    {claimedByOther && <span className="ec-in-use-tag" title={`${claim.agentLabel} is working on this`}>In use</span>}
                    <span className="ec-email-time">{fmtTime(e.receivedAt)}</span>
                  </div>
                  <div className="ec-email-subject">
                    {e.hasAttachments && <span className="ec-attach-icon" title="Has attachments">📎</span>}
                    {e.subject}
                  </div>
                  {tag && (
                    <div className="ec-tag-badge-row">
                      <span className={`ec-tag-badge ec-tag-badge-${tag.type}`}>
                        {tag.type === 'logged'      && '✓ '}
                        {tag.type === 'updated'     && '↻ '}
                        {tag.type === 'escalated'   && '↑ '}
                        {tag.type === 'closed'      && '✓ '}
                        {tag.type === 'wip'         && '⋯ '}
                        {tag.type === 'nonrelevant' && '✕ '}
                        {tag.type === 'other'       && '🏷 '}
                        {tag.label}
                      </span>
                      {tag.time && (
                        <span className="ec-tag-time">{fmtTime(tag.time)}</span>
                      )}
                    </div>
                  )}
                  {!tag && (
                    <>
                      <div className="ec-email-meta">
                        <span className="ec-from-label">From:</span> {e.fromDisplay || e.fromAddr}
                      </div>
                      {e.toDisplay && (
                        <div className="ec-email-meta" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <span className="ec-from-label">To:</span> {e.toDisplay}
                        </div>
                      )}
                      <div className="ec-email-preview">{e.bodyPreview}</div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT: Email Viewer + Actions ── */}
        <div className="ec-right">
          {logSuccess ? (
            <div className="ec-log-success">
              <div className="ec-ls-check">✓</div>
              <h2 className="ec-ls-title">
                {logSuccess.results.length > 1
                  ? `${logSuccess.results.length} Complaints Logged`
                  : 'Complaint Logged Successfully'}
              </h2>

              {logSuccess.results.length > 1 ? (
                <>
                  <p className="ec-ls-id-label">{logSuccess.results.length} Complaint IDs Generated</p>
                  <div className="ec-ls-multi-ids">
                    {logSuccess.results.map((r, i) => (
                      <div key={i} className="ec-ls-id-row">
                        <span className="ec-ls-id-num">#{i + 1}</span>
                        <span className="ec-ls-id-val">{r.complaintno}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="ec-ls-id-label">Case ID</p>
                  <p className="ec-ls-id-big">{logSuccess.results[0].complaintno}</p>
                </>
              )}

              <div className="ec-ls-grid">
                <div><span>Store</span><strong>{logSuccess.payload.storeName || logSuccess.payload.storeCode}</strong></div>
                <div><span>Employee</span><strong>{logSuccess.payload.employeeName || logSuccess.payload.employeeCode || '—'}</strong></div>
                <div><span>Product</span><strong>{logSuccess.payload.productName}</strong></div>
                <div><span>Vendor</span><strong>{logSuccess.payload.vendorName || '—'}</strong></div>
                <div><span>Nature of Problem</span><strong>{logSuccess.payload.natureOfComplaint}</strong></div>
                <div><span>Complaint Type</span><strong>{logSuccess.payload.complaintType}</strong></div>
                <div><span>TAT</span><strong>{logSuccess.payload.tatDays} day{logSuccess.payload.tatDays !== 1 ? 's' : ''}</strong></div>
                <div><span>Expected Closure</span><strong>{logSuccess.results[0].edcDate}</strong></div>
              </div>

              <p className="ec-ls-note">
                {logSuccess.results.length > 1
                  ? `${logSuccess.results.length} escalation emails triggered. Confirmation reply sent to store.`
                  : 'Escalation email triggered. Confirmation reply sent to store.'}
              </p>

              <button className="ec-ls-done-btn" onClick={() => setLogSuccess(null)}>
                Back to Inbox
              </button>
            </div>
          ) : !selected ? (
            <div className="ec-no-select">
              <div className="ec-no-select-icon">✉</div>
              <p>Select an email from the list to review and process it</p>
            </div>
          ) : (
            <>
              {/* Email Header */}
              <div className="ec-email-header">
                <div className="ec-email-header-top">
                  <div className="ec-email-header-subject">{selected.subject}</div>
                  <button className="ec-fullview-btn" onClick={() => setEmailModal(selected)} title="Open full email in popup">
                    ⤢ Full View
                  </button>
                </div>
                <div className="ec-email-header-meta">
                  <span>From: <strong>{selected.fromDisplay || selected.fromAddr}</strong></span>
                  {selected.storeCode && <span className="ec-store-pill">{selected.storeCode}</span>}
                  <span>{fmtTime(selected.receivedAt)}</span>
                </div>
                {selected.toDisplay && (
                  <div className="ec-email-header-meta" style={{ marginTop: 4 }}>
                    <span>To: <span style={{ color: '#374151' }}>{selected.toDisplay}</span></span>
                  </div>
                )}
              </div>

              {/* ── Attachments Panel ── */}
              {selected.hasAttachments && (
                <div className="ec-attachments">
                  <div className="ec-attach-header">
                    <span className="ec-attach-label">📎 Attachments</span>
                    {!attachmentData && (
                      <button
                        className="ec-load-attach-btn"
                        disabled={loadingAttach}
                        onClick={async () => {
                          setLoadingAttach(true);
                          try {
                            const res = await vmm.fetchAttachments(selected.id);
                            const attachments = res.attachments || [];
                            setAttachmentData(attachments);
                            // Persist so re-selecting the email shows Open instead of Load
                            localStorage.setItem(`vmm_attach_${selected.id}`, JSON.stringify(attachments));
                            showToast('Attachments saved to Drive', 'ok');
                          } catch { showToast('Could not save attachments to Drive', 'err'); }
                          finally { setLoadingAttach(false); }
                        }}
                      >
                        {loadingAttach ? 'Saving...' : 'Load & Save to Drive'}
                      </button>
                    )}
                  </div>
                  <div className="ec-attach-list">
                    {!attachmentData && !loadingAttach && (
                      <span className="ec-attach-note">Click "Load & Save to Drive" to store files and create download links</span>
                    )}
                    {attachmentData && attachmentData.length === 0 && (
                      <span className="ec-attach-note">No downloadable attachments found</span>
                    )}
                    {attachmentData && attachmentData.map((a, i) => (
                      <div key={i} className="ec-attach-item">
                        <div className="ec-attach-info">
                          <span className="ec-attach-name">{a.name}</span>
                          {a.size > 0 && (
                            <span className="ec-attach-size">
                              {a.size > 1048576 ? `${(a.size/1048576).toFixed(1)} MB` : `${Math.round(a.size/1024)} KB`}
                            </span>
                          )}
                        </div>
                        {a.content && (
                          <button
                            className="ec-download-btn"
                            onClick={() => {
                              try {
                                const bytes = atob(a.content);
                                const arr = new Uint8Array(bytes.length);
                                for (let j = 0; j < bytes.length; j++) arr[j] = bytes.charCodeAt(j);
                                const blob = new Blob([arr], { type: a.contentType || 'application/octet-stream' });
                                const url = URL.createObjectURL(blob);
                                const link = document.createElement('a');
                                link.href = url; link.download = a.name;
                                link.click();
                                URL.revokeObjectURL(url);
                              } catch { showToast('Download failed', 'err'); }
                            }}
                          >
                            ↓ Download
                          </button>
                        )}
                        {(a.viewLink || a.downloadLink) && (
                          <div className="ec-attach-actions">
                            {a.viewLink && (
                              <a className="ec-view-btn" href={a.viewLink} target="_blank" rel="noreferrer">
                                Open
                              </a>
                            )}
                        </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Action Buttons ── */}
              {(() => {
                const wipMatch = wipList.find(w =>
                  w.id === selected.id ||
                  (selected.conversationId && w.conversationId && selected.conversationId === w.conversationId) ||
                  w.subject === selected.subject ||
                  (selected.complaintId && w.subject?.includes(selected.complaintId))
                );
                const detectedId = selected.complaintId || (wipMatch?.complaintNo) || '';

                return (
                  <>
                    {/* WIP Match Notice */}
                    {wipMatch && (
                      <div className="ec-wip-match">
                        <span className="ec-wip-match-icon">↩ WIP</span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>Store replied to your pending case</div>
                          <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>"{wipMatch.subject}"</div>
                        </div>
                      </div>
                    )}

                    {/* Detected complaint ID notice */}
                    {detectedId && !wipMatch && (
                      <div className="ec-detected-id">
                        <span>Complaint detected in subject:</span>
                        <strong className="ec-detected-badge">#{detectedId}</strong>
                      </div>
                    )}

                    {/* Three Action Buttons */}
                    <div className="ec-action-bar">
                      <button
                        className={`ec-action-btn ec-action-primary ${activeAction === 'log-new' ? 'selected' : ''}`}
                        onClick={() => { setActiveAction(activeAction === 'log-new' ? null : 'log-new'); setParsed(null); }}
                      >
                        ✦ Log New Complaint
                      </button>
                      <button
                        className={`ec-action-btn ec-action-update ${activeAction === 'update-case' ? 'selected' : ''}`}
                        onClick={() => {
                          const next = activeAction === 'update-case' ? null : 'update-case';
                          setActiveAction(next);
                          if (next === 'update-case') {
                            const from = selected?.fromDisplay || selected?.fromAddr || '';
                            const to   = selected?.toDisplay   || '';
                            const OWN_ADDR = 'vmm.helpdesk@openmind.in';
                            const latestInbound = [...threadMessages]
                              .sort((a, b) => new Date(b.receivedDateTime) - new Date(a.receivedDateTime))
                              .find(m => (m.from || '').toLowerCase() !== OWN_ADDR);
                            const body = (
                              stripHtml(latestInbound?.uniqueBodyHtml || '')
                              || latestInbound?.bodyPreview
                              || selected?.bodyPreview
                              || ''
                            ).replace(/\n{3,}/g, '\n\n').trim();
                            const autoRemarks = `Email received from ${from} and sent to ${to}\n\n${body}`.trim();
                            setUpdateForm(f => ({ ...f, complaintId: detectedId, remarks: autoRemarks }));
                            setUpdSrc('Email Reply');
                            setUpdEmailRef(selected?.subject || '');
                            setUpdDelayMain(''); setUpdDelaySub(''); setUpdStatus('Closed'); setUpdClosedBy('');
                          } else {
                            setUpdateForm(f => ({ ...f, complaintId: detectedId }));
                          }
                          if (next === 'update-case' && !detectedId) {
                            const sc = selected?.storeCode;
                            if (sc) {
                              setLoadingRecent(true);
                              vmm.getRecentComplaints(sc)
                                .then(r => setRecentCases(r.complaints || []))
                                .catch(() => setRecentCases([]))
                                .finally(() => setLoadingRecent(false));
                            }
                          } else if (next === null) {
                            setRecentCases([]);
                          }
                        }}
                      >
                        ↻ Update a Case
                      </button>
                      <button
                        className={`ec-action-btn ec-action-reply ${activeAction === 'reply' ? 'selected' : ''}`}
                        onClick={() => {
                          const next = activeAction === 'reply' ? null : 'reply';
                          setActiveAction(next);
                          if (!next) setQuickReplyBody('');
                        }}
                      >
                        ✉ Reply
                      </button>
                      <button
                        className="ec-action-btn ec-action-grey"
                        onClick={() => {
                          tagEmail(selected.id, 'nonrelevant', 'Non-Relevant');
                          setSelected(null);
                          showToast('Email tagged as non-relevant', 'info');
                        }}
                      >
                        ✕ Non-Relevant
                      </button>
                    </div>
                  </>
                );
              })()}

              {/* ── Update Case Form ── */}
              {activeAction === 'update-case' && (
                <div className="ec-update-form">
                  <div className="ec-update-title">Update Existing Complaint</div>

                  {/* Complaint Number + Search */}
                  <div className="ec-update-row">
                    <label>Complaint Number</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        placeholder="e.g. 26052317667 or EL-26042916099"
                        value={updateForm.complaintId}
                        style={{ flex: 1 }}
                        onChange={e => { setUpdateForm(f => ({ ...f, complaintId: e.target.value })); setUpdateAction(null); setFoundComplaint(null); }}
                        onKeyDown={async e => {
                          if (e.key !== 'Enter' || !updateForm.complaintId.trim()) return;
                          setSearchingComplaint(true); setFoundComplaint(null); setUpdateAction(null);
                          try {
                            const res = await vmm.getComplaintDetail(updateForm.complaintId.trim());
                            setFoundComplaint(res?.complaint ? res : { notFound: true });
                          } catch { setFoundComplaint({ notFound: true }); }
                          finally { setSearchingComplaint(false); }
                        }}
                      />
                      <button
                        style={{ padding: '0 14px', background: '#334155', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}
                        disabled={searchingComplaint || !updateForm.complaintId.trim()}
                        onClick={async () => {
                          setSearchingComplaint(true); setFoundComplaint(null); setUpdateAction(null);
                          try {
                            const res = await vmm.getComplaintDetail(updateForm.complaintId.trim());
                            setFoundComplaint(res?.complaint ? res : { notFound: true });
                          } catch { setFoundComplaint({ notFound: true }); }
                          finally { setSearchingComplaint(false); }
                        }}>
                        {searchingComplaint ? '…' : 'Search'}
                      </button>
                    </div>
                  </div>

                  {/* Recent active complaints — shown when no complaint ID typed yet */}
                  {!updateForm.complaintId && !foundComplaint && (
                    <div style={{ marginBottom: 8 }}>
                      {loadingRecent ? (
                        <div style={{ fontSize: 12, color: '#94a3b8', padding: '6px 0' }}>Loading recent complaints…</div>
                      ) : recentCases.length > 0 ? (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                            Recent open complaints for this store
                          </div>
                          <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
                            {recentCases.slice(0, 8).map((c, i) => (
                              <div
                                key={c.id || i}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: i < Math.min(recentCases.length, 8) - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 ? '#f8fafc' : '#fff', cursor: 'pointer', fontSize: 12 }}
                                onClick={async () => {
                                  const no = c.complaintno || c.id;
                                  setUpdateForm(f => ({ ...f, complaintId: no }));
                                  setSearchingComplaint(true); setFoundComplaint(null);
                                  try {
                                    const res = await vmm.getComplaintDetail(no);
                                    setFoundComplaint(res?.complaint ? res : { notFound: true });
                                  } catch { setFoundComplaint({ notFound: true }); }
                                  finally { setSearchingComplaint(false); }
                                }}
                              >
                                <span style={{ fontWeight: 600, color: '#334155', flex: '0 0 auto' }}>{c.complaintno}</span>
                                <span style={{ color: '#64748b', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.productname}</span>
                                <span style={{ flex: '0 0 auto', padding: '2px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: c.current_status === 'Open' ? '#dbeafe' : c.current_status === 'Escalated' ? '#fef3c7' : '#f1f5f9', color: c.current_status === 'Open' ? '#1d4ed8' : c.current_status === 'Escalated' ? '#b45309' : '#475569' }}>
                                  {c.current_status || 'Open'}
                                </span>
                                <span style={{ fontSize: 11, color: '#94a3b8', flex: '0 0 auto' }}>Select →</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* Search result */}
                  {foundComplaint?.notFound && (
                    <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12, color: '#dc2626', marginBottom: 8 }}>
                      Complaint not found — check the number and try again.
                    </div>
                  )}
                  {foundComplaint?.complaint && (
                    <div style={{ padding: '10px 12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ fontWeight: 700, color: '#15803d' }}>✓ Complaint Found</div>
                        <a
                          href={`${window.location.origin}/crm-vmm/complaints/${foundComplaint.complaint.complaintno}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 11, color: '#2563eb', textDecoration: 'none', fontWeight: 600, padding: '2px 8px', background: '#dbeafe', borderRadius: 4 }}
                        >
                          View full ↗
                        </a>
                      </div>
                      <div style={{ color: '#374151' }}><strong>Store:</strong> {foundComplaint.complaint.storecode} — {foundComplaint.complaint.storename}</div>
                      <div style={{ color: '#374151' }}><strong>Product:</strong> {foundComplaint.complaint.productname}</div>
                      <div style={{ color: '#374151' }}><strong>Status:</strong> {foundComplaint.complaint.current_status || foundComplaint.complaint.status} &nbsp;|&nbsp; <strong>EDC:</strong> {foundComplaint.complaint.edc || foundComplaint.complaint.edcdate || '—'}</div>
                    </div>
                  )}

                  {/* Action selector — only after complaint is confirmed found */}
                  {foundComplaint?.complaint && (
                    <div className="ec-update-actions" style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
                      {[
                        { key: 'update',   label: '✏ Update',  style: { background: '#475569' } },
                        { key: 'escalate', label: '↑ Escalate', style: { background: '#d97706' } },
                        { key: 'close',    label: '✓ Close',   style: { background: '#16a34a' } },
                      ].map(({ key, label, style }) => (
                        <button key={key}
                          onClick={() => {
                            const next = updateAction === key ? null : key;
                            setUpdateAction(next);
                            setEscEmailMode(null); setEscPrevMsg(null);
                            setEscToEmail(''); setEscCc(''); setEscSubject(''); setEscBody('');
                            if (next === 'update' || next === 'escalate') {
                              const fc         = foundComplaint?.complaint;
                              const sortedLogs   = [...(foundComplaint?.logs || [])].sort((a, b) => new Date(b.created) - new Date(a.created));
                              const latestLog    = sortedLogs[0];
                              const latestEdcLog = sortedLogs.find(l => l.closureinformdate);
                              const existingEdc  = fc?.edc || latestEdcLog?.closureinformdate || '';
                              setUpdateForm(f => ({ ...f, newEdc: existingEdc ? String(existingEdc).split('T')[0] : '' }));
                              const storedMain = latestLog?.reasonfordelay || '';
                              const storedSub  = latestLog?.subreasonfordelay || '';
                              setUpdDelayMain(storedMain);
                              setUpdDelaySub(matchDelaySub(storedSub, storedMain));
                              if (next === 'escalate') {
                                setEscEmailMode('loading');
                                const _compno = fc?.complaintno;
                                const _nextLvl = parseInt(fc?.escalationlevel || 0) + 1;
                                searchSentEmails(_compno).then(results => {
                                  const prev = results[0] || null;
                                  if (prev) {
                                    setEscPrevMsg(prev);
                                    setEscToEmail(prev.to.join(', '));
                                    setEscCc(prev.cc.join(', '));
                                    setEscEmailMode('reply');
                                  } else {
                                    setEscSubject(`Escalation L${_nextLvl} | ${_compno} | ${fc?.storename} (${fc?.storecode}) | ${fc?.productname}`);
                                    setEscEmailMode('new');
                                  }
                                }).catch(() => {
                                  setEscSubject(`Escalation L${_nextLvl} | ${_compno} | ${fc?.storename} (${fc?.storecode}) | ${fc?.productname}`);
                                  setEscEmailMode('new');
                                });
                              }
                            }
                          }}
                          style={{ ...style, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13, opacity: updateAction && updateAction !== key ? 0.45 : 1 }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Update Source — shown for all actions */}
                  {updateAction && (
                    <div className="ec-update-row">
                      <label>Update Source</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {['Call', 'Email Reply', 'Vendor Update'].map(s => (
                          <button key={s} onClick={() => setUpdSrc(s)}
                            style={{ padding: '6px 14px', borderRadius: 6, border: '2px solid',
                              borderColor: updSrc === s ? '#4f46e5' : '#e2e8f0',
                              background: updSrc === s ? '#eef2ff' : 'transparent',
                              fontWeight: 600, fontSize: 12, cursor: 'pointer',
                              color: updSrc === s ? '#4f46e5' : '#64748b' }}>
                            {s === 'Call' ? '📞' : s === 'Email Reply' ? '📧' : '🏭'} {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Source-specific fields */}
                  {updateAction && updSrc === 'Call' && (
                    <div className="ec-update-row-2">
                      <div>
                        <label>TXN / Call ID</label>
                        <input type="text" placeholder="SparkTG TXN ID" value={updTxnId} onChange={e => setUpdTxnId(e.target.value)} />
                      </div>
                      <div>
                        <label>Mobile Called</label>
                        <input type="text" placeholder="Number dialled" value={updMobile} onChange={e => setUpdMobile(e.target.value)} />
                      </div>
                    </div>
                  )}
                  {updateAction && updSrc === 'Email Reply' && (
                    <div className="ec-update-row">
                      <label>Email Subject / Reference</label>
                      <input type="text" placeholder="Subject line of the email" value={updEmailRef} onChange={e => setUpdEmailRef(e.target.value)} />
                    </div>
                  )}
                  {updateAction && updSrc === 'Vendor Update' && (
                    <div className="ec-update-row">
                      <label>Vendor Ticket No</label>
                      <input type="text" placeholder="Vendor's ticket / reference number" value={updVendorTicket} onChange={e => setUpdVendorTicket(e.target.value)} />
                    </div>
                  )}

                  {/* Delay Reason — for Escalate and Update */}
                  {(updateAction === 'escalate' || updateAction === 'update') && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Delay Reason — Main</label>
                        <select style={{ padding: '7px 10px', border: '1.5px solid #d1d5db', borderRadius: 7, fontSize: 12, color: '#111827', width: '100%', outline: 'none' }} value={updDelayMain} onChange={e => {
                          setUpdDelayMain(e.target.value); setUpdDelaySub('');
                        }}>
                          <option value="">— Select —</option>
                          {Object.keys(DELAY_REASONS).map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Delay Reason — Sub</label>
                        <select style={{ padding: '7px 10px', border: '1.5px solid #d1d5db', borderRadius: 7, fontSize: 12, color: '#111827', width: '100%', outline: 'none' }} value={updDelaySub} disabled={!updDelayMain} onChange={e => {
                          const sub = e.target.value;
                          setUpdDelaySub(sub);
                          const item = (DELAY_REASONS[updDelayMain] || []).find(r => r.label === sub);
                          if (item?.tat) {
                            const d = new Date(); d.setDate(d.getDate() + item.tat);
                            setUpdateForm(f => ({ ...f, newEdc: d.toISOString().split('T')[0] }));
                          }
                        }}>
                          <option value="">— Select —</option>
                          {(DELAY_REASONS[updDelayMain] || []).map(r => (
                            <option key={r.label} value={r.label}>{r.tat ? `${r.label} (${r.tat}d)` : r.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Close Type — for Close action */}
                  {updateAction === 'close' && (
                    <div className="ec-update-row">
                      <label>Close Type</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {['Closed', 'Partially Closed'].map(s => (
                          <button key={s} onClick={() => setUpdStatus(s)}
                            style={{ padding: '6px 14px', borderRadius: 6, border: '2px solid',
                              borderColor: updStatus === s ? '#16a34a' : '#e2e8f0',
                              background: updStatus === s ? '#f0fdf4' : 'transparent',
                              fontWeight: 600, fontSize: 12, cursor: 'pointer',
                              color: updStatus === s ? '#15803d' : '#64748b' }}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Date — required for Escalate/Close, optional for Update */}
                  {(updateAction === 'escalate' || updateAction === 'close' || updateAction === 'update') && (
                    <div className="ec-update-row">
                      <label>
                        {updateAction === 'close' && updStatus === 'Closed' ? 'Date of Closure' : 'New EDC'}
                        <span style={{ color: '#dc2626' }}> *</span>
                      </label>
                      <input type="date" value={updateForm.newEdc} onChange={e => setUpdateForm(f => ({ ...f, newEdc: e.target.value }))} />
                    </div>
                  )}

                  {/* Closed By — for full Closed only */}
                  {updateAction === 'close' && updStatus === 'Closed' && (
                    <div className="ec-update-row">
                      <label>Case Closed By</label>
                      <input type="text" placeholder="Name of person who confirmed closure" value={updClosedBy} onChange={e => setUpdClosedBy(e.target.value)} />
                    </div>
                  )}

                  {/* Remarks — shown for all actions */}
                  {updateAction && (
                    <div className="ec-update-row">
                      <label>Remarks <span style={{ color: '#dc2626' }}>*</span></label>
                      <textarea
                        rows={3}
                        placeholder={updateAction === 'escalate' ? 'Reason for escalation, pending actions…' : updateAction === 'close' ? 'Closure details, what was done…' : 'Update details, vendor response, next steps…'}
                        value={updateForm.remarks}
                        onChange={e => setUpdateForm(f => ({ ...f, remarks: e.target.value }))}
                      />
                    </div>
                  )}

                  {/* Escalation Email */}
                  {updateAction === 'escalate' && (
                    <div style={{ marginTop: 14, borderTop: '1.5px dashed #fde68a', paddingTop: 14 }}>
                      <div style={{ fontWeight: 700, color: '#d97706', fontSize: 13, marginBottom: 10 }}>📧 Escalation Email</div>

                      {escEmailMode === 'loading' && (
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>Checking for previous emails…</div>
                      )}

                      {(escEmailMode === 'reply' || escEmailMode === 'new') && (<>
                        {escEmailMode === 'reply' && escPrevMsg && (
                          <div style={{ fontSize: 12, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 12px', marginBottom: 10 }}>
                            ↩ Replying to: <strong>{escPrevMsg.subject}</strong>
                            {escPrevMsg.sentAt && <span style={{ color: '#92400e' }}> · {new Date(escPrevMsg.sentAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
                          </div>
                        )}
                        <div className="ec-update-row">
                          <label>To</label>
                          <input type="text" value={escToEmail} onChange={e => setEscToEmail(e.target.value)}
                            placeholder="recipient@email.com"
                            style={{ padding: '7px 10px', border: '1.5px solid #d1d5db', borderRadius: 7, fontSize: 12, width: '100%', outline: 'none' }} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                          <div>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>CC</label>
                            <input type="text" value={escCc} onChange={e => setEscCc(e.target.value)}
                              placeholder="cc1, cc2"
                              style={{ padding: '7px 10px', border: '1.5px solid #d1d5db', borderRadius: 7, fontSize: 12, width: '100%', outline: 'none' }} />
                          </div>
                          {escEmailMode === 'new' && (
                            <div>
                              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Subject</label>
                              <input type="text" value={escSubject} onChange={e => setEscSubject(e.target.value)}
                                style={{ padding: '7px 10px', border: '1.5px solid #d1d5db', borderRadius: 7, fontSize: 12, width: '100%', outline: 'none' }} />
                            </div>
                          )}
                        </div>
                        <div className="ec-update-row" style={{ marginTop: 8 }}>
                          <label>Message</label>
                          <textarea rows={4} value={escBody} onChange={e => setEscBody(e.target.value)}
                            placeholder={escEmailMode === 'reply' ? 'Write your follow-up message…' : 'Write your escalation message…'}
                            style={{ padding: '7px 10px', border: '1.5px solid #d1d5db', borderRadius: 7, fontSize: 12, width: '100%', outline: 'none', resize: 'vertical' }} />
                        </div>
                        <button onClick={() => setEscEmailMode('skip')}
                          style={{ fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4, padding: 0, textDecoration: 'underline' }}>
                          Don't send email
                        </button>
                      </>)}

                      {escEmailMode === 'skip' && (
                        <div style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 8 }}>
                          No email will be sent.
                          <button onClick={() => {
                            const fc = foundComplaint?.complaint;
                            setEscEmailMode('loading'); setEscPrevMsg(null);
                            setEscToEmail(''); setEscCc(''); setEscSubject(''); setEscBody('');
                            searchSentEmails(fc?.complaintno).then(results => {
                              const prev = results[0] || null;
                              if (prev) {
                                setEscPrevMsg(prev);
                                setEscToEmail(prev.to.join(', '));
                                setEscCc(prev.cc.join(', '));
                                setEscEmailMode('reply');
                              } else {
                                const nl = parseInt(fc?.escalationlevel || 0) + 1;
                                setEscSubject(`Escalation L${nl} | ${fc?.complaintno} | ${fc?.storename} (${fc?.storecode}) | ${fc?.productname}`);
                                setEscEmailMode('new');
                              }
                            }).catch(() => {
                              const nl = parseInt(fc?.escalationlevel || 0) + 1;
                              setEscSubject(`Escalation L${nl} | ${fc?.complaintno} | ${fc?.storename} (${fc?.storecode}) | ${fc?.productname}`);
                              setEscEmailMode('new');
                            });
                          }} style={{ fontSize: 11, color: '#d97706', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                            Add email
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Confirm-before-save modal */}
                  {confirmECPending && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: 440, maxWidth: '95vw', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
                        <div style={{ fontWeight: 800, fontSize: 17, color: '#1e293b', marginBottom: 4 }}>
                          Confirm {updateAction === 'escalate' ? 'Escalation' : updateAction === 'close' ? 'Closure' : 'Update'}
                        </div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 18 }}>
                          Verify all details before saving to the case log.
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9', padding: '16px 0', marginBottom: 20 }}>
                          {[
                            ['Status', updateAction === 'escalate' ? 'Escalated' : updateAction === 'close' ? updStatus : (foundComplaint?.complaint?.current_status || 'Open')],
                            ['EDC', updateForm.newEdc || '—'],
                            updDelayMain ? ['Delay Reason', `${updDelayMain}${updDelaySub ? ` — ${updDelaySub}` : ''}`] : null,
                            ['Remarks', updateForm.remarks],
                          ].filter(Boolean).map(([label, value]) => (
                            <div key={label} style={{ display: 'flex', gap: 14 }}>
                              <div style={{ width: 110, flexShrink: 0, fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</div>
                              <div style={{ fontSize: 13, color: '#1e293b', fontWeight: 500, flex: 1 }}>{value}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                          <button onClick={() => setConfirmECPending(false)}
                            style={{ padding: '9px 22px', borderRadius: 7, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                            Cancel
                          </button>
                          <button disabled={loggingActivity}
                            style={{ padding: '9px 22px', borderRadius: 7, border: 'none', background: updateAction === 'escalate' ? '#d97706' : updateAction === 'close' ? '#16a34a' : '#7c3aed', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                            onClick={async () => {
                              setConfirmECPending(false);
                              setLoggingActivity(true);
                              try {
                                const c = foundComplaint?.complaint;
                                const effectiveStatus = updateAction === 'escalate' ? 'Escalated'
                                  : updateAction === 'close' ? updStatus : (foundComplaint?.complaint?.current_status || 'Open');
                                const followupMethod = updSrc === 'Email Reply' ? 'Email Reply'
                                  : updSrc === 'Vendor Update' ? 'Vendor Update' : 'Call';
                                const nextLevel = parseInt(c?.escalationlevel || 0) + 1;
                                const basePayload = {
                                  complaintId:    c?.id,
                                  followupMethod,
                                  txnId:          updSrc === 'Call'          ? updTxnId        : '',
                                  mobileCalled:   updSrc === 'Call'          ? updMobile       : '',
                                  emailSubject:   updSrc === 'Email Reply'   ? updEmailRef     : '',
                                  vendorTicketNo: updSrc === 'Vendor Update' ? updVendorTicket : '',
                                  remarks:        updateForm.remarks,
                                  uid:            currentUser?.id ?? 1,
                                };
                                let res;
                                if (updateAction === 'update') {
                                  res = await vmm.updateComplaint({
                                    ...basePayload,
                                    delayMain:      updDelayMain,
                                    delaySub:       updDelaySub,
                                    newClosureDate: updateForm.newEdc || '',
                                    closureStatus:  effectiveStatus,
                                  });
                                } else if (updateAction === 'escalate') {
                                  res = await vmm.escalateComplaint({
                                    ...basePayload,
                                    closureStatus:   effectiveStatus,
                                    delayMain:       updDelayMain,
                                    delaySub:        updDelaySub,
                                    newClosureDate:  updateForm.newEdc || '',
                                    escalationLevel: nextLevel,
                                  });
                                } else {
                                  res = await vmm.closeComplaint({
                                    ...basePayload,
                                    closureStatus: effectiveStatus,
                                    closureDate:   updateForm.newEdc || '',
                                    closedBy:      updClosedBy || '',
                                  });
                                }
                                if (res?.success !== false && !res?.error) {
                                  // Send escalation email from frontend if user composed one
                                  if (updateAction === 'escalate' && (escEmailMode === 'reply' || escEmailMode === 'new') && escBody.trim() && escToEmail.trim()) {
                                    const _edcDisplay = updateForm.newEdc
                                      ? new Date(updateForm.newEdc).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                                      : '—';
                                    const emailHtml = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;max-width:600px">`
                                      + `<p style="margin:0 0 16px;white-space:pre-line">${escBody.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`
                                      + `<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">`
                                      + `<p style="font-size:12px;color:#64748b;margin:0">Complaint: <strong>${c?.complaintno}</strong> &nbsp;|&nbsp; ${c?.storename} (${c?.storecode}) &nbsp;|&nbsp; ${c?.productname} &nbsp;|&nbsp; EDC: ${_edcDisplay}</p>`
                                      + `<p style="font-size:13px;margin:16px 0 0">Regards,<br/><strong>VMM Helpdesk</strong><br/>Open Mind Services Limited</p>`
                                      + `</div>`;
                                    try {
                                      if (escEmailMode === 'reply' && escPrevMsg?.id) {
                                        await replyOnThread({ messageId: escPrevMsg.id, htmlBody: emailHtml, toEmail: escToEmail, ccEmails: escCc });
                                      } else {
                                        await vmm.sendFollowupEmail({ toEmail: escToEmail, ccEmails: escCc, subject: escSubject, htmlBody: emailHtml });
                                      }
                                    } catch { /* email fail does not block DB log */ }
                                  }
                                  const tagType  = updateAction === 'escalate' ? 'escalated' : updateAction === 'close' ? 'closed' : 'updated';
                                  const tagLabel = `${updateAction === 'escalate' ? 'Escalated' : updateAction === 'close' ? 'Closed' : 'Updated'} • ${updateForm.complaintId.trim()}`;
                                  const graphCat = updateAction === 'escalate' ? 'Escalated' : updateAction === 'close' ? 'Case Closed' : 'Case Updated';
                                  tagEmail(selected.id, tagType, tagLabel);
                                  patchEmailCategories(selected.id, [graphCat, 'New CRM']);
                                  vmm.categorizeEmail(selected.id, [graphCat, 'New CRM']).catch(() => {});
                                  showToast(`${updateAction === 'escalate' ? 'Escalated' : updateAction === 'close' ? 'Closed' : 'Updated'}: ${updateForm.complaintId.trim()}`, 'ok');
                                  setActiveAction(null);
                                  setUpdateForm({ complaintId: '', remarks: '', newStatus: '', newEdc: '', escalationLevel: '', reasonForDelay: '' });
                                  setUpdateAction(null);
                                  setUpdSrc('Email Reply'); setUpdTxnId(''); setUpdMobile(''); setUpdEmailRef('');
                                  setUpdVendorTicket(''); setUpdDelayMain(''); setUpdDelaySub(''); setUpdStatus('Closed'); setUpdClosedBy('');
                                  setEscEmailMode(null); setEscPrevMsg(null);
                                  setEscToEmail(''); setEscCc(''); setEscSubject(''); setEscBody('');
                                } else {
                                  showToast(res?.message || 'Update failed', 'err');
                                }
                              } catch { showToast('Could not save update', 'err'); }
                              finally { setLoggingActivity(false); }
                            }}>
                            {loggingActivity ? 'Saving…' : 'Confirm & Save'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Submit — opens confirm dialog */}
                  {updateAction && (
                    <button
                      className="ec-submit-update-btn"
                      disabled={loggingActivity || !updateForm.complaintId.trim() || !updateForm.remarks.trim()
                        || !updateForm.newEdc}
                      onClick={() => setConfirmECPending(true)}
                    >
                      {loggingActivity ? 'Saving…'
                        : updateAction === 'escalate' ? '↑ Escalate Complaint'
                        : updateAction === 'close'    ? '✓ Close Complaint'
                        : '✏ Save Update'}
                    </button>
                  )}
                </div>
              )}

              {/* ── Quick Reply Panel ── */}
              {activeAction === 'reply' && (
                <div className="ec-quick-reply-panel">
                  <div className="ec-update-title">Reply to Email</div>
                  <div className="ec-quick-reply-meta">
                    <div><span className="ec-qr-label">To:</span> <span className="ec-qr-val">{replyTo.join(', ') || selected.fromAddr || '—'}</span></div>
                    {replyCc.length > 0 && <div><span className="ec-qr-label">CC:</span> <span className="ec-qr-val">{replyCc.join(', ')}</span></div>}
                  </div>
                  <textarea
                    className="ec-quick-reply-body"
                    rows={6}
                    placeholder="Type your reply…"
                    value={quickReplyBody}
                    onChange={e => setQuickReplyBody(e.target.value)}
                    autoFocus
                  />
                  <button
                    className="ec-submit-update-btn"
                    disabled={sendingQuickReply || !quickReplyBody.trim()}
                    onClick={async () => {
                      setSendingQuickReply(true);
                      try {
                        const htmlBody = '<div style="font-family:Arial,sans-serif;font-size:13px;color:#1e293b;line-height:1.6">'
                          + quickReplyBody.split('\n').map(l => l.trim() ? `<p style="margin:0 0 8px">${l}</p>` : '<br/>').join('')
                          + '<hr style="margin:16px 0;border:none;border-top:1px solid #e2e8f0"/>'
                          + '<p style="font-size:11px;color:#64748b">Open Mind Services Limited — VMM CRM</p></div>';
                        const replyMsgId = selected.id;
                        await vmm.sendEmailReply({
                          messageId:    replyMsgId,
                          htmlBody,
                          toRecipients: replyTo,
                          ccRecipients: replyCc,
                        });
                        patchEmailCategories(selected.id, ['Case Updated', 'New CRM']);
                        vmm.categorizeEmail(selected.id, ['Case Updated', 'New CRM']).catch(() => {});
                        tagEmail(selected.id, 'updated', 'Replied');
                        showToast('Reply sent', 'ok');
                        setActiveAction(null);
                        setQuickReplyBody('');
                      } catch (e) { showToast(e?.message || 'Could not send reply', 'err'); }
                      finally { setSendingQuickReply(false); }
                    }}
                  >
                    {sendingQuickReply ? 'Sending…' : '✉ Send Reply'}
                  </button>
                </div>
              )}

              {/* Email Body — shows sanitised HTML body when available; falls back to plain preview + prompt to open Full View */}
              <div className="ec-email-body">
                {(selected.bodyHtml || selected.body) ? (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: (selected.bodyHtml || selected.body)
                        .replace(/<script[\s\S]*?<\/script>/gi, '')
                        .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
                        .replace(/<object[\s\S]*?<\/object>/gi, '')
                        .replace(/on\w+="[^"]*"/gi, '')
                        .replace(/on\w+='[^']*'/gi, '')
                    }}
                  />
                ) : (
                  <>
                    <p style={{ whiteSpace: 'pre-wrap', margin: 0, color: '#374151', lineHeight: 1.7 }}>
                      {selected.bodyPreview || '(No preview available)'}
                    </p>
                    <p style={{ marginTop: 12, fontSize: 12, color: '#94a3b8' }}>
                      Click <strong>⤢ Full View</strong> above to read the complete email thread.
                    </p>
                  </>
                )}
              </div>

              {/* AI Parse — only when Log New Complaint is selected */}
              {activeAction === 'log-new' && !parsed && (
                <button className="ec-parse-btn" onClick={parseEmail} disabled={parsing}>
                  {parsing ? '✦ Parsing with AI…' : '✦ Parse with AI'}
                </button>
              )}

              {/* Parsed Results */}
              {parsed && (
                <div className="ec-parsed">
                  {/* WIP banner — shown when editing a saved WIP case */}
                  {selected.parsed && (
                    <div className="ec-wip-edit-banner">
                      <span className="ec-wip-edit-icon">WIP</span>
                      <div className="ec-wip-banner-body">
                        <span className="ec-wip-banner-title">Editing saved WIP — fields restored from earlier parse.</span>
                        <span className="ec-wip-banner-sub">
                          If the store has replied with the missing info, click <strong>Re-parse</strong> above — it will read the full thread and extract the new details automatically.
                          {selected.savedBy && <> &nbsp;·&nbsp; Saved by <strong>{selected.savedBy}</strong></>}
                        </span>
                        {(selected.parsed?.missingFromTemplate || []).length > 0 && (
                          <span className="ec-wip-still-missing">
                            Still missing: {selected.parsed.missingFromTemplate.map(f => camelToLabel(f)).join(' · ')}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="ec-parsed-head">
                    <span>{selected.parsed ? 'Saved WIP Fields — Edit & Log' : 'AI Extracted Fields'}</span>
                    <button className="ec-reparse-btn" onClick={parseEmail} disabled={parsing}>↺ Re-parse</button>
                  </div>

                  {/* Template selector */}
                  <div className="ec-template-row">
                    <span className="ec-template-label">Template used:</span>
                    <select
                      className="ec-template-select"
                      value={selectedTemplateId || ''}
                      onChange={e => handleTemplateChange(e.target.value)}
                    >
                      <option value="">— Select template —</option>
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.id}. {t.name} ({t.category})</option>
                      ))}
                    </select>
                  </div>

                  {/* AI product not found in the product master */}
                  {unmatchedProducts.length > 0 && (
                    <div className="ec-product-not-found" role="alert">
                      <strong>⚠ Product doesn&apos;t exist in the dropdown</strong>
                      <span>
                        AI extracted {unmatchedProducts.map(n => `“${n}”`).join(', ')}.
                        {' '}Select a product from the Step 1 dropdown (or add it with ➕) before logging.
                      </span>
                    </div>
                  )}

                  {/* Already provided */}
                  {parsed.alreadyProvided && Object.keys(parsed.alreadyProvided).length > 0 && (
                    <div className="ec-already-provided">
                      <span className="ec-already-label">✓ Already provided in thread:</span>
                      <div className="ec-already-chips">
                        {Object.entries(parsed.alreadyProvided).map(([k, v]) => (
                          <span key={k} className="ec-already-chip">{camelToLabel(k)}: <strong>{v}</strong></span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Tab bar ── */}
                  <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', marginBottom: 14, gap: 2 }}>
                    {[['form', 'Complaint Form'], ['matrix', '📋 Escalation Matrix']].map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => {
                          setEmTab(key);
                          if (key === 'matrix' && !escalationMatrix.length && !emLoading) {
                            setEmLoading(true);
                            vmm.getEscalationMatrix().then(r => setEscalationMatrix(r.contacts || [])).catch(() => {}).finally(() => setEmLoading(false));
                          }
                        }}
                        style={{
                          padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none',
                          cursor: 'pointer', borderRadius: '6px 6px 0 0', marginBottom: -2,
                          background: emTab === key ? '#4f46e5' : 'transparent',
                          color: emTab === key ? '#fff' : '#64748b',
                          borderBottom: emTab === key ? '2px solid #4f46e5' : '2px solid transparent',
                        }}
                      >{label}</button>
                    ))}
                  </div>

                  {emTab === 'form' && <>
                    {/* ── Shared store / employee fields (email-specific) ── */}
                    <div className="ec-fields-grid">
                      {Object.entries(FIELD_LABELS).map(([key, label]) => {
                        // Employee Name — show lookup status, not raw AI value
                        if (key === 'employeeName') {
                          const STATUS = {
                            idle:        { cls: 'missing',     val: '—' },
                            loading:     { cls: resolvedEmpName ? 'filled' : 'missing', val: resolvedEmpName || 'Looking up…' },
                            found:       { cls: 'filled',      val: resolvedEmpName },
                            'not-found': { cls: resolvedEmpName ? 'filled' : 'missing-req', val: resolvedEmpName || '⚠ Employee code not found in system' },
                          };
                          const s = STATUS[empLookupStatus] || STATUS.idle;
                          return (
                            <div key={key} className={`ec-field ${s.cls}`}>
                              <span className="ec-field-label">
                                Employee Name
                                {empLookupSource && (
                                  <span style={{ fontSize: 10, color: '#7c3aed', marginLeft: 4 }}>
                                    {empLookupSource === 'store' ? 'from store master' : `from ${empLookupSource}`}
                                  </span>
                                )}
                              </span>
                              <span className="ec-field-val">{s.val}</span>
                            </div>
                          );
                        }
                        // Store Code — always editable; auto-filled from email domain or employee record
                        if (key === 'storeCode') {
                          const storeVal = parsedEdits.storeCode || parsed.storeCode || selected?.storeCode || '';
                          const autoSrc  = !parsed.storeCode && !selected?.storeCode && parsedEdits.storeCode
                            ? ' (from employee record)' : '';
                          return (
                            <div key={key} className={`ec-field ${storeVal ? 'filled' : 'missing-req'}`}>
                              <span className="ec-field-label">
                                Store Code<span className="req"> *</span>
                                {autoSrc && <span style={{ fontSize: 10, color: '#7c3aed', marginLeft: 4 }}>auto-filled{autoSrc}</span>}
                              </span>
                              <input
                                className="ec-field-input"
                                placeholder="Enter store code manually…"
                                value={parsedEdits.storeCode}
                                onChange={e => setParsedEdits(prev => ({ ...prev, storeCode: e.target.value.toUpperCase() }))}
                              />
                            </div>
                          );
                        }
                        // Employee Code — editable; changing triggers auto-lookup
                        if (key === 'employeeCode') {
                          const val = parsedEdits.employeeCode;
                          return (
                            <div key={key} className={`ec-field ${val ? 'filled' : 'missing'}`}>
                              <span className="ec-field-label">Employee Code</span>
                              <input
                                className="ec-field-input"
                                placeholder="Enter employee code…"
                                value={val}
                                onChange={e => {
                                  setEmpLookupSource('');
                                  setParsedEdits(prev => ({ ...prev, employeeCode: e.target.value.toUpperCase() }));
                                }}
                              />
                            </div>
                          );
                        }
                        // Employee Email — editable, auto-filled from the employee record
                        if (key === 'employeeEmail') {
                          const val = parsedEdits.employeeEmail;
                          return (
                            <div key={key} className={`ec-field ${val ? 'filled' : 'missing'}`}>
                              <span className="ec-field-label">Employee Email</span>
                              <input
                                className="ec-field-input"
                                placeholder="Enter employee email…"
                                value={val}
                                onChange={e => setParsedEdits(prev => ({ ...prev, employeeEmail: e.target.value }))}
                              />
                            </div>
                          );
                        }
                        // Contact Number — editable
                        if (key === 'contactNumber') {
                          const val = parsedEdits.contactNumber;
                          return (
                            <div key={key} className={`ec-field ${val ? 'filled' : 'missing'}`}>
                              <span className="ec-field-label">Contact Number</span>
                              <input
                                className="ec-field-input"
                                placeholder="Enter contact number…"
                                value={val}
                                onChange={e => setParsedEdits(prev => ({ ...prev, contactNumber: e.target.value }))}
                              />
                            </div>
                          );
                        }
                        const val    = parsed[key];
                        const isMiss = !val;
                        const isReq  = REQUIRED_FIELDS.includes(key);
                        return (
                          <div key={key} className={`ec-field ${isMiss ? (isReq ? 'missing-req' : 'missing') : 'filled'}`}>
                            <span className="ec-field-label">{label}{isReq && <span className="req"> *</span>}</span>
                            <span className="ec-field-val">{val || (isReq ? '⚠ Missing' : '—')}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* ── Complaint tabs — one independent 9-step wizard per item ── */}
                    {complaintItems.length > 1 && (
                      <div className="ec-complaint-tabs">
                        {complaintItems.map((item, idx) => (
                          <button
                            key={item.id}
                            className={`ec-complaint-tab ${item.id === activeComplaintId ? 'active' : ''} ${itemErrors[idx] && Object.keys(itemErrors[idx]).length ? 'incomplete' : ''}`}
                            onClick={() => { setActiveComplaintId(item.id); setShowValidation(false); }}
                          >
                            <span className="ec-complaint-tab-num">{idx + 1}</span>
                            <span className="ec-complaint-tab-label">{item.productName || 'New complaint'}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {activeItem && (
                      <>
                        <div className="ec-wizard-card">
                          <div className="ec-wizard-title-row">
                            <span className="ec-wizard-title">
                              {complaintItems.length > 1 ? `Complaint #${complaintItems.findIndex(x => x.id === activeItem.id) + 1}` : 'Complaint Details'}
                              {activeItem.productName && (
                                <span className="ec-wizard-product">— {activeItem.productName}</span>
                              )}
                              {activeItem.productUnmatched && (
                                <span className="ec-wizard-product unmatched">
                                  — “{activeItem.aiProductName || activeItem.productName}” ⚠ not in dropdown
                                </span>
                              )}
                            </span>
                            {complaintItems.length > 1 && (
                              <button className="ec-wizard-remove" onClick={() => removeItem(activeItem.id)}>Remove</button>
                            )}
                          </div>

                          <EmailComplaintWizard
                            item={activeItem}
                            allItems={complaintItems}
                            products={products}
                            natures={natures}
                            storeCode={parsedEdits.storeCode || parsed?.storeCode || selected?.storeCode || ''}
                            amcRows={amcRows}
                            driveAttachments={attachmentData || []}
                            errors={activeErrors}
                            onChange={updateActiveItem}
                            onSelectItem={(id) => { setActiveComplaintId(id); setShowValidation(false); }}
                            onAddNature={addCustomNature}
                          />
                        </div>

                        {/* ── Email-specific escalation controls for this complaint ── */}
                        {activeItem.contractType && (
                          <div className="ec-esc-block">
                            <div className="ec-esc-title">✉ Escalation Email — {activeItem.productName || 'this complaint'}</div>
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                                To <span style={{ color: '#9ca3af', fontWeight: 400 }}>(auto from store AMC, or override below)</span>
                              </div>
                              {activeEscVendorEmails && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                                  {activeEscVendorEmails.split(',').map(e => e.trim()).filter(Boolean).map(email => (
                                    <span key={email} className="ec-esc-chip">
                                      {email}
                                      {activeManualVendorEmailSet.has(email) && (
                                        <button onClick={() => toggleVendorEmail(activeItem.id, email)} title="Remove">×</button>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {activeAmcVendor && !activeManualVendorEmails && (
                                <div style={{ fontSize: 10, color: '#16a34a', marginBottom: 4 }}>
                                  ✓ Auto-resolved: {activeAmcVendor.name} — {activeAmcVendor.source}
                                </div>
                              )}
                              <input className="ec-field-input" type="text"
                                placeholder="Override vendor@email.com (comma-separate for multiple)"
                                value={activeManualVendorEmails}
                                onChange={e => updateActiveItem({ vendorEmail: e.target.value })}
                                style={{ background: '#fff' }} />
                              {!activeEscVendorEmails && (
                                <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 3 }}>
                                  ⚠ No vendor email resolved — escalation will fall back to FM (if configured)
                                </div>
                              )}
                            </div>
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 6 }}>CC <span style={{ color: '#9ca3af', fontWeight: 400 }}>(auto)</span></div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {[
                                  ['SM', '#dbeafe', '#1d4ed8', 'Store Manager (auto)'],
                                  ['FM', '#dcfce7', '#166534', 'Facility Manager (auto)'],
                                  ['HO', '#fef3c7', '#92400e', getItemHoEmail(activeItem.productName)],
                                ].map(([tag, bg, fg, txt]) => (
                                  !(activeItem.removedAutoCC || []).includes(tag) && txt && (
                                    <div key={tag} style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ background: bg, color: fg, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>{tag}</span>
                                      {txt}
                                      <button onClick={() => updateActiveItem({ removedAutoCC: [...(activeItem.removedAutoCC || []), tag] })} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 13, lineHeight: 1 }} title={`Remove ${tag}`}>✕</button>
                                    </div>
                                  )
                                ))}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Extra CC <span style={{ color: '#9ca3af', fontWeight: 400 }}>(comma separated)</span></div>
                              <input className="ec-field-input" type="text" placeholder="email1@example.com, email2@example.com"
                                value={activeItem.extraEscCc}
                                onChange={e => updateActiveItem({ extraEscCc: e.target.value })}
                                style={{ background: '#fff' }} />
                            </div>
                          </div>
                        )}

                        {/* Product-specific fields extracted from the thread */}
                        {parsed.productSpecificFields && Object.keys(parsed.productSpecificFields).length > 0 && (
                          <>
                            <div className="ec-subsection-label">Product-Specific Details (extracted from thread)</div>
                            <div className="ec-fields-grid">
                              {Object.entries(parsed.productSpecificFields).map(([key, val]) => {
                                const isMissing = parsed.missingProductFields?.includes(key);
                                return (
                                  <div key={key} className={`ec-field ${isMissing ? 'missing-req' : 'filled'}`}>
                                    <span className="ec-field-label">{camelToLabel(key)}</span>
                                    <span className="ec-field-val">{val || '⚠ Missing'}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </>
                    )}

                    <button onClick={addItem} className="ec-add-complaint-btn">
                      + Add Another Complaint (different product / vendor)
                    </button>

                    {/* Missing product-specific fields not yet in the grid */}
                    {parsed.missingProductFields?.filter(f => !parsed.productSpecificFields?.[f]).length > 0 && (
                      <div className="ec-fields-grid" style={{ marginTop: 4 }}>
                        {parsed.missingProductFields.filter(f => !parsed.productSpecificFields?.[f]).map(key => (
                          <div key={key} className="ec-field missing-req">
                            <span className="ec-field-label">{camelToLabel(key)}</span>
                            <span className="ec-field-val">⚠ Missing</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Action buttons — below all fields */}
                    <div className="ec-parsed-actions">
                      <button className={`ec-log-btn ${!canLog ? 'disabled-look' : ''}`}
                        onClick={attemptLog} disabled={logging}
                        title={canLog ? '' : 'Complete the highlighted wizard fields before logging'}>
                        {logging ? 'Logging…' : complaintItems.length > 1 ? `✓ Log ${complaintItems.length} Complaints` : '✓ Log Complaint'}
                      </button>
                      <button
                        className={`ec-ask-info-btn ${showReplyEditor ? 'active' : ''}`}
                        onClick={openReplyEditor}
                      >
                        ✉ {showReplyEditor ? 'Edit Reply' : 'Ask for Missing Info'}
                      </button>
                    </div>
                  </>}

                  {emTab === 'matrix' && (
                    <div>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                        <input
                          placeholder="Search vendor…"
                          value={emSearch}
                          onChange={e => setEmSearch(e.target.value)}
                          style={{ flex: '1 1 140px', padding: '6px 10px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, outline: 'none' }}
                        />
                        <select value={emRegion} onChange={e => setEmRegion(e.target.value)}
                          style={{ padding: '6px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>
                          <option value="">All Regions</option>
                          {['Pan India','North','South','East','West'].map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <select value={emLevel} onChange={e => setEmLevel(e.target.value)}
                          style={{ padding: '6px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>
                          <option value="">All Levels</option>
                          {['First Call','Level 1','Level 2','Level 3','Level 4','Level 5'].map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </div>

                      {complaintItems[0]?.vendorEmail && (
                        <div style={{ marginBottom: 8, fontSize: 11, color: '#16a34a', background: '#dcfce7', borderRadius: 6, padding: '6px 10px', fontWeight: 600 }}>
                          ✓ TO ({complaintItems[0].vendorEmail.split(',').map(e => e.trim()).filter(Boolean).length}): {complaintItems[0].vendorEmail}
                          <button onClick={() => updateItem(complaintItems[0].id, { vendorEmail: '' })} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>× Clear all</button>
                        </div>
                      )}

                      {emLoading ? (
                        <div style={{ textAlign: 'center', color: '#94a3b8', padding: 24, fontSize: 12 }}>Loading escalation matrix…</div>
                      ) : (
                        <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', minWidth: 580 }}>
                            <thead>
                              <tr style={{ background: '#1e1b4b', color: '#fff', position: 'sticky', top: 0, zIndex: 1 }}>
                                {['Vendor','Region','Level','Contact','Mobile','Email',''].map(h => (
                                  <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(() => {
                                const rows = escalationMatrix.filter(c =>
                                  (!emSearch || c.vendorName.toLowerCase().includes(emSearch.toLowerCase())) &&
                                  (!emRegion || c.region === emRegion) &&
                                  (!emLevel  || c.level  === emLevel)
                                );
                                if (!rows.length) return (
                                  <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No contacts match filters</td></tr>
                                );
                                return rows.map((c, i) => (
                                  <tr key={i} style={{ background: i % 2 === 0 ? '#f8fafc' : '#fff', borderBottom: '1px solid #e2e8f0' }}>
                                    <td style={{ padding: '7px 10px', fontWeight: 600, color: '#1e1b4b', whiteSpace: 'nowrap' }}>{c.vendorName}</td>
                                    <td style={{ padding: '7px 10px', color: '#475569', whiteSpace: 'nowrap' }}>{c.region}</td>
                                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                                      <span style={{ background: '#dbeafe', color: '#1d4ed8', borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>{c.level}</span>
                                    </td>
                                    <td style={{ padding: '7px 10px', color: '#374151' }}>{c.contactPerson || '—'}</td>
                                    <td style={{ padding: '7px 10px', color: '#374151', whiteSpace: 'nowrap' }}>{c.mobile1 || c.customerCareNo || '—'}</td>
                                    <td style={{ padding: '7px 10px', color: '#0369a1', wordBreak: 'break-all' }}>{c.email || '—'}</td>
                                    <td style={{ padding: '7px 10px' }}>
                                      {c.email && (() => {
                                        const isAdded = (complaintItems[0]?.vendorEmail || '').split(',').map(e => e.trim()).includes(c.email);
                                        return (
                                          <button
                                            onClick={() => complaintItems[0] && toggleVendorEmail(complaintItems[0].id, c.email)}
                                            style={{ padding: '3px 10px', fontSize: 11, background: isAdded ? '#dcfce7' : '#4f46e5', color: isAdded ? '#16a34a' : '#fff', border: `1px solid ${isAdded ? '#86efac' : '#4f46e5'}`, borderRadius: 5, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                                          >{isAdded ? '✓ Added' : 'Add →'}</button>
                                        );
                                      })()}
                                    </td>
                                  </tr>
                                ));
                              })()}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}

              {/* Reply Editor — only shown when agent clicks Ask for Missing Info */}
              {parsed && showReplyEditor && (
                <div className="ec-reply-section">
                  <div className="ec-reply-head-row">
                    <span className="ec-reply-head">Reply — Request Missing Details</span>
                    {/* Template picker for reply */}
                    <select
                      className="ec-reply-tpl-select"
                      value={selectedTemplateId || ''}
                      onChange={e => {
                        const id = e.target.value;
                        setSelectedTemplateId(id);
                        if (!id) return;
                        const tpl = templates.find(t => t.id === parseInt(id));
                        if (tpl) {
                          const plain = tpl.body
                            .replace(/<table[^>]*>[\s\S]*?<\/table>/gi, '\n[Table — fill in required fields]\n')
                            .replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
                          setReplyBody(plain);
                        }
                      }}
                    >
                      <option value="">— Custom / AI draft —</option>
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.id}. {t.name} ({t.category})</option>
                      ))}
                    </select>
                  </div>

                  {/* Recipient editor */}
                  <div className="ec-recipients">
                    {[
                      { label: 'To', list: replyTo, setList: setReplyTo, input: toInput, setInput: setToInput },
                      { label: 'CC', list: replyCc, setList: setReplyCc, input: ccInput, setInput: setCcInput },
                    ].map(({ label, list, setList, input, setInput }) => (
                      <div key={label} className="ec-recip-row">
                        <span className="ec-recip-label">{label}</span>
                        <div className="ec-recip-chips">
                          {list.map((addr, i) => (
                            <span key={i} className="ec-recip-chip">
                              {addr}
                              <button type="button" onClick={() => setList(l => l.filter((_, j) => j !== i))} title="Remove">×</button>
                            </span>
                          ))}
                          <input
                            className="ec-recip-input" type="email"
                            placeholder={`Add ${label} address…`} value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => { if ((e.key === 'Enter' || e.key === ',') && input.trim()) { e.preventDefault(); setList(l => [...l, input.trim()]); setInput(''); } }}
                            onBlur={() => { if (input.trim()) { setList(l => [...l, input.trim()]); setInput(''); } }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <textarea
                    className="ec-reply-body"
                    rows={12}
                    value={replyBody}
                    onChange={e => setReplyBody(e.target.value)}
                    placeholder="Edit the reply before sending…"
                    style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: '1.6' }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="ec-send-btn" onClick={sendReply} disabled={sending || !replyBody.trim()}>
                      {sending ? 'Sending…' : '✉ Send & Save as WIP'}
                    </button>
                    <button className="ec-send-btn" onClick={sendReplyOnly} disabled={sending || !replyBody.trim()}
                      style={{ background: '#475569' }} title="Send reply without saving to WIP">
                      {sending ? 'Sending…' : '✉ Send Only'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
