import * as graph from '../auth/graphService';

// Core CRM data is backed by SQL. During local development it is forced to the
// demo_vmm database through the Vite middleware; production keeps the live API.
// Email workflows stay on their own base so they do not accidentally hit the
// demo endpoint.
const LIVE_SQL = import.meta.env.VITE_API_BASE || 'https://automation.openmindhelpline.com/webhook';
const PHP = import.meta.env.VITE_PHP_BASE || LIVE_SQL;
const APP_BASE = import.meta.env.BASE_URL || '/';

// Dev: every SQL-backed CRM call goes to the local /demo-api middleware, which
// only accepts DB_NAME=demo_vmm. Live writes are therefore impossible locally.
const SQL = import.meta.env.DEV
  ? `${APP_BASE}demo-api`
  : (import.meta.env.VITE_SQL_API_BASE || LIVE_SQL);

// Self-hosted n8n — email workflows only (never redirected to the demo DB).
const BASE = import.meta.env.VITE_EMAIL_API_BASE || LIVE_SQL;

// Demo/test guard: outbound mail is suppressed while running in dev mode.
export const DEMO_MODE = import.meta.env.DEV && import.meta.env.VITE_ALLOW_LIVE_EMAIL !== 'true';
const demoEmailResult = (data = {}) => Promise.resolve({ success: true, demo: true, ...data });

// In dev, WIP records stay in this browser. They only hold parsed email fields
// used to continue the same case — never a live write to the email workflow.
const DEMO_WIP_KEY = 'vmm_demo_wips';
function readDemoWips() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEMO_WIP_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function writeDemoWips(wips) {
  localStorage.setItem(DEMO_WIP_KEY, JSON.stringify(wips));
}
function saveDemoWip(data = {}) {
  const id = String(data.emailId || data.id || '').trim();
  if (!id) return Promise.resolve({ success: false, error: 'emailId required' });
  const row = { ...data, emailId: id, id: data.id || id, updatedAt: new Date().toISOString() };
  const wips = readDemoWips();
  const at = wips.findIndex(w => String(w.emailId || w.id) === id);
  if (at >= 0) wips[at] = { ...wips[at], ...row };
  else wips.unshift(row);
  writeDemoWips(wips);
  return Promise.resolve({ success: true, wip: row });
}
function resolveDemoWip(emailId) {
  const id = String(emailId || '').trim();
  writeDemoWips(readDemoWips().filter(w => String(w.emailId || w.id) !== id));
  return Promise.resolve({ success: true });
}

// Cloud n8n — non-email workflows only
const CLOUD = import.meta.env.VITE_CLOUD_API_BASE || '/cloud-webhook';

async function get(base, path, params = {}) {
  const url = new URL(`${base}/${path}`, window.location.origin);
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) url.searchParams.set(k, v); });
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`${path} failed: ${r.status}`);
  return r.json();
}

// The employee endpoint only filters by `code` or `mobile`. When neither is
// available (common for store replies signed only with a name), it returns the
// full employee master, so cache that single response for the session.
let employeeListPromise = null;

async function getEmployeeList() {
  if (!employeeListPromise) {
    employeeListPromise = get(SQL, 'vmm-sp-employee')
      .then(r => r.employees || [])
      .catch(err => {
        employeeListPromise = null;
        throw err;
      });
  }
  return employeeListPromise;
}

async function post(base, path, body) {
  const r = await fetch(`${base}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} failed: ${r.status}`);
  return r.json();
}

// Store-wise AMC vendors: local Vite middleware in dev, PHP SQL API in production.
const AMC_READ_URL = import.meta.env.DEV
  ? `${APP_BASE}api/amc-vendors`
  : `${PHP}/vmm-amc-vendors`;
const AMC_WRITE_URL = import.meta.env.DEV
  ? `${APP_BASE}api/amc-vendors`
  : `${PHP}/vmm-amc-vendor-save`;

async function fetchAmcVendors() {
  const r = await fetch(AMC_READ_URL);
  if (!r.ok) throw new Error(`vmm-amc-vendors failed: ${r.status}`);
  const data = await r.json();
  return data.rows || [];
}

async function saveAmcVendorRow(row) {
  const r = await fetch(AMC_WRITE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success === false) throw new Error(data.error || `AMC save failed: ${r.status}`);
  return data.row || row;
}

// Build a Teams Adaptive Card payload from the same recipient resolution used
// by the real escalation email. The card is preview-only; no mail is sent.
function buildTeamsEscalationCard(data) {
  const built = graph.buildEscalationEmailContent(data);
  if (!built) throw new Error('No escalation recipients resolved');

  const complaints = Array.isArray(data.complaints) ? data.complaints : [];
  const lines = [
    `Store: ${data.storeName || ''} (${data.storeCode || ''})`,
    `Product: ${data.productName || ''}`,
    `Nature: ${data.natureOfComplaint || '—'}`,
    data.vendorName ? `Vendor: ${data.vendorName}` : `Assigned FM: ${data.fmName || '—'}`,
    data.fmName ? `FM: ${data.fmName}${data.fmEmail ? ` <${data.fmEmail}>` : ''}` : '',
    ...complaints.flatMap(c => [
      `Complaint ${c.complaintno}`,
      `  Location: ${c.productLocation || '—'}`,
      `  Expected closure: ${c.edcDate || '—'}`,
      c.description ? `  Remarks: ${c.description}` : '',
    ]),
    data.vendorName || data.manualVendorEmail || data.amcVendorEmail
      ? 'Please attend the complaint and confirm assignment within 24 hours.'
      : 'Please attend to this complaint and coordinate with the store within 24 hours.',
    'DEMO PREVIEW ONLY — no email was sent.',
  ].filter(Boolean);

  return {
    kind: 'Escalation mail',
    to: built.toEmail,
    cc: built.ccEmails,
    subject: `[DEMO] for testing purpose only — ${built.subject}`,
    lines,
    sample: true,
  };
}

export const vmm = {
  // ── SQL-backed CRM data (live n8n workflows) ────────
  lookupStore:       (code)   => get(SQL, 'vmm-sp-store',          { code }),
  lookupEmployee:         (code)   => get(SQL, 'vmm-sp-employee', { code }),
  lookupEmployeeByMobile: (mobile) => get(SQL, 'vmm-sp-employee', { mobile }),
  // Full master used as a fallback when AI/body text has no code or mobile.
  getEmployees:            ()       => getEmployeeList(),
  getProducts:       ()       => get(SQL, 'vmm-sp-products'),
  getNatures:        ()       => get(SQL, 'vmm-sp-natures'),
  getDelayReasons:   ()       => get(SQL, 'vmm-sp-delay-reasons'),
  getSheetMaster:    ()       => get(SQL, 'vmm-master-data'),
  saveMasterRow:     (sheet, action, row) => post(SQL, 'vmm-master-save', { sheet, action, row }),
  getVendors:        ()       => get(SQL, 'vmm-sp-vendors'),
  getAmcVendor:        (storeCode, product) => get(SQL, 'vmm-sp-amc-vendor', { storeCode, product }),
  // Store-wise AMC vendors now come from vmmdb.vmm_amc_vendors.
  getAmcVendors:      ()       => fetchAmcVendors(),
  saveAmcVendor:      (row)    => saveAmcVendorRow(row),
  getEscalationMatrix: (params = {})        => get(SQL, 'vmm-sp-escalation-matrix', params),
  logComplaint:        (data)   => post(SQL, 'vmm-log-complaint',           data),
  polishRemarks:       (text)   => post(BASE, 'vmm-ai-polish',              { text }),
  getComplaint:        (complaintno) => get(SQL, 'vmm-get-complaint',       { complaintno }),
  sendEscalationEmail:          (data) => graph.sendEscalationEmailDirect(data),
  buildEscalationEmailContent: (data) => graph.buildEscalationEmailContent(data),
  resolveEscalationRecipients: (data) => graph.resolveEscalationRecipients(data),
  teamsStatus:                 ()     => get(SQL, 'vmm-teams-status'),
  postTeamsPreview:            (card) => post(SQL, 'vmm-teams-preview', card),
  previewEscalationInTeams:    (data) => post(SQL, 'vmm-teams-preview', buildTeamsEscalationCard(data)),
  sendClosureEmail:    (data)   => graph.sendClosureEmailDirect(data),
  // vmm-recent-complaints has no live workflow — the SQL search endpoint with
  // the `store` filter returns the same store complaint list.
  getRecentComplaints: (code)   => get(SQL,  'vmm-search-complaints',   { store: code }),
  searchComplaints:    (params) => get(SQL, 'vmm-search-complaints',    params),
  dashboardStats:    (params = {}) => get(SQL, 'vmm-dashboard-stats', params),
  getComplaintDetail:(ref)    => get(SQL, 'vmm-complaint-detail',   { no: ref }),
  getUserRole:  (email)  => get(SQL, 'vmm-user-role',   { email }),
  lookupCaller: (mobile) => get(SQL, 'vmm-sparktg-inbound', { mobile }),
  getFollowUpComplaints: ()     => get(SQL,  'vmm-followup-complaints'),
  updateComplaint:  (data)      => post(SQL, 'vmm-update-complaint',   data),
  escalateComplaint:(data)      => post(SQL, 'vmm-escalate-complaint', data),
  closeComplaint:   (data)      => post(SQL, 'vmm-close-complaint',    data),
  notConnected:     (data)      => post(SQL, 'vmm-not-connected',      data),
  updateEdc:        (data)      => post(SQL, 'vmm-update-edc',         data),

  // ── Email — inbox & thread via n8n; all sending via Graph API ───────────────
  emailClaim:          (data)   => post(BASE, 'vmm-email-claim',         data),
  fetchInbox:         ()        => get(BASE, 'vmm-email-inbox').then(r => ({ emails: r.emails || [], isIncremental: false })),
  resetInboxDelta:    ()        => Promise.resolve(),
  searchEmails:       (q)       => graph.searchEmails(q),
  fetchSent:          ()        => graph.fetchSent(),
  fetchThread:        (convId)  => get(BASE, 'vmm-email-thread', { conversationId: convId }),
  sendEmailReply:     (data)    => graph.replyOnThread({ messageId: data.messageId, htmlBody: data.htmlBody, toEmail: data.toRecipients, ccEmails: data.ccRecipients }),
  categorizeEmail:    (messageId, categories) => graph.categorizeEmail(messageId, categories),
  markEmailRead:      (messageId) => graph.markAsRead(messageId),
  sendNewEmail:       (data)    => graph.sendSharedMailboxEmail(data),
  logEmailActivity:  (data)   => post(BASE,  'vmm-email-log-activity', data),
  searchSentEmail:(complaintno, date) => get(BASE, 'vmm-search-sent-email', { complaintno, ...(date ? { date } : {}) }),
  sendFollowupEmail:(data) => DEMO_MODE ? demoEmailResult(data) : post(BASE, 'vmm-send-followup-email', data),

  // ── Cloud n8n — attachments, templates, AI ──────────
  fetchAttachments:   (msgId)   => get(CLOUD,  'vmm-fetch-attachments', { messageId: msgId }),
  getEmailTemplates:  ()        => get(CLOUD,  'vmm-email-templates'),
  parseEmail:         (data)    => post(BASE,  'vmm-parse-email',       data),

  // ── WIP Emails ──────────────────────────────────────
  // Dev keeps WIP locally so a follow-up can continue the same case without
  // touching the live email workflow. Production keeps the original n8n APIs.
  saveWip:        (data)    => DEMO_MODE ? saveDemoWip(data) : post(BASE, 'vmm-wip-save',    data),
  getOpenWips:    ()        => DEMO_MODE ? Promise.resolve({ wips: readDemoWips() }) : get(BASE, 'vmm-wip-list'),
  resolveWip:     (emailId) => DEMO_MODE ? resolveDemoWip(emailId) : post(BASE, 'vmm-wip-resolve', { emailId }),

  // ── Non-Trading Requests ─────────────────────────────
  listNtr:             ()      => get(BASE,  'vmm-ntr-list'),
  getNtrItems:         (id)    => get(BASE,  'vmm-ntr-items', { requestId: id }),
  validateNtrArticles: (items) => post(BASE, 'vmm-ntr-validate', { items }),
  saveNtr:             (data)  => post(BASE, 'vmm-ntr-save',     data),
  fetchNtrMasterXlsx:  ()      => post(BASE, 'vmm-ntr-fetch-xlsx', {}),
  sendNtrEmail:        (data)  => DEMO_MODE ? demoEmailResult(data) : post(BASE, 'vmm-ntr-email', data),

  // ── User Management ──────────────────────────────────
  listUsers:    ()       => get(BASE, 'vmm-users-list'),
  createUser:   (data)   => post(BASE, 'vmm-user-create', data),
  updateUser:   (data)   => post(BASE, 'vmm-user-update', data),
  deleteUser:   (data)   => post(BASE, 'vmm-user-delete', data),

  // ── Reports ──────────────────────────────────────────
  getReports:        ()       => get(BASE, 'vmm-reports'),
};
