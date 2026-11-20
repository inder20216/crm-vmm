import * as graph from '../auth/graphService';

// Core CRM data is backed by SQL and exposed by the deployed self-hosted n8n
// workflows. The old PHP host (VITE_PHP_BASE) is not deployed, so use the live
// SQL API for all case-logging lookups and reference data.
const SQL = import.meta.env.VITE_API_BASE || 'https://automation.openmindhelpline.com/webhook';
const PHP = import.meta.env.VITE_PHP_BASE || SQL;

// Self-hosted n8n — email workflows only
const BASE = SQL;

// Cloud n8n — non-email workflows only
const CLOUD = import.meta.env.VITE_CLOUD_API_BASE || '/cloud-webhook';

async function get(base, path, params = {}) {
  const url = new URL(`${base}/${path}`, window.location.origin);
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) url.searchParams.set(k, v); });
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`${path} failed: ${r.status}`);
  return r.json();
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

export const vmm = {
  // ── SQL-backed CRM data (live n8n workflows) ────────
  lookupStore:       (code)   => get(SQL, 'vmm-sp-store',          { code }),
  lookupEmployee:         (code)   => get(SQL, 'vmm-sp-employee', { code }),
  lookupEmployeeByMobile: (mobile) => get(SQL, 'vmm-sp-employee', { mobile }),
  getProducts:       ()       => get(SQL, 'vmm-sp-products'),
  getNatures:        ()       => get(SQL, 'vmm-sp-natures'),
  getDelayReasons:   ()       => get(SQL, 'vmm-sp-delay-reasons'),
  getSheetMaster:    ()       => get(SQL, 'vmm-master-data'),
  saveMasterRow:     (sheet, action, row) => post(SQL, 'vmm-master-save', { sheet, action, row }),
  getVendors:        ()       => get(SQL, 'vmm-sp-vendors'),
  getAmcVendor:        (storeCode, product) => get(SQL, 'vmm-sp-amc-vendor', { storeCode, product }),
  // The facility portal's live store-AMC workflows return vendor_name directly.
  // vmm-sp-amc-vendor has no matching SQL rows, so use these for the New Case form.
  getPortalAmcVendor: (storeCode, product) => {
    const key = (product || '').trim().toLowerCase();
    const webhook = ['ac', 'server room ac'].includes(key) ? 'AC-AMC'
                  : ['lift', 'escalator'].includes(key) ? 'Lift-AMC'
                  : null;
    if (!webhook) return Promise.resolve({ found: false, vendor: '' });
    return post(BASE, webhook, { store_id: storeCode }).then(res => {
      const raw = String(res?.vendor_name || '').trim();
      // index (47).html: empty / "Not Applicable" both route to HO Direct.
      const notApplicable = !raw || raw.toLowerCase() === 'not applicable';
      return {
        found: true,
        notApplicable,
        vendor: notApplicable ? 'N/A — HO Direct' : raw,
      };
    });
  },
  getEscalationMatrix: (params = {})        => get(SQL, 'vmm-sp-escalation-matrix', params),
  logComplaint:        (data)   => post(SQL, 'vmm-log-complaint',           data),
  polishRemarks:       (text)   => post(BASE, 'vmm-ai-polish',              { text }),
  getComplaint:        (complaintno) => get(SQL, 'vmm-get-complaint',       { complaintno }),
  sendEscalationEmail:          (data) => graph.sendEscalationEmailDirect(data),
  buildEscalationEmailContent: (data) => graph.buildEscalationEmailContent(data),
  resolveEscalationRecipients: (data) => graph.resolveEscalationRecipients(data),
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
  sendFollowupEmail:(data) => post(BASE, 'vmm-send-followup-email', data),

  // ── Cloud n8n — attachments, templates, AI ──────────
  fetchAttachments:   (msgId)   => get(CLOUD,  'vmm-fetch-attachments', { messageId: msgId }),
  getEmailTemplates:  ()        => get(CLOUD,  'vmm-email-templates'),
  parseEmail:         (data)    => post(BASE,  'vmm-parse-email',       data),

  // ── WIP Emails ──────────────────────────────────────
  saveWip:        (data) => post(BASE, 'vmm-wip-save',    data),
  getOpenWips:    ()     => get(BASE,  'vmm-wip-list'),
  resolveWip:     (emailId) => post(BASE, 'vmm-wip-resolve', { emailId }),

  // ── Non-Trading Requests ─────────────────────────────
  listNtr:             ()      => get(BASE,  'vmm-ntr-list'),
  getNtrItems:         (id)    => get(BASE,  'vmm-ntr-items', { requestId: id }),
  validateNtrArticles: (items) => post(BASE, 'vmm-ntr-validate', { items }),
  saveNtr:             (data)  => post(BASE, 'vmm-ntr-save',     data),
  fetchNtrMasterXlsx:  ()      => post(BASE, 'vmm-ntr-fetch-xlsx', {}),
  sendNtrEmail:        (data)  => post(BASE, 'vmm-ntr-email', data),

  // ── User Management ──────────────────────────────────
  listUsers:    ()       => get(BASE, 'vmm-users-list'),
  createUser:   (data)   => post(BASE, 'vmm-user-create', data),
  updateUser:   (data)   => post(BASE, 'vmm-user-update', data),
  deleteUser:   (data)   => post(BASE, 'vmm-user-delete', data),

  // ── Reports ──────────────────────────────────────────
  getReports:        ()       => get(BASE, 'vmm-reports'),
};
