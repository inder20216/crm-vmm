import * as graph from '../auth/graphService';

// PHP REST API on vmm.openmindservices.in — all core DB operations
const PHP = import.meta.env.VITE_PHP_BASE || 'https://vmm.openmindservices.in/webhook';

// Self-hosted n8n — email workflows only
const BASE = import.meta.env.VITE_API_BASE || '/webhook';

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
  // ── PHP REST API — core DB operations ───────────────
  lookupStore:       (code)   => get(PHP, 'vmm-sp-store',          { code }),
  lookupEmployee:         (code)   => get(PHP, 'vmm-sp-employee', { code }),
  lookupEmployeeByMobile: (mobile) => get(PHP, 'vmm-sp-employee', { mobile }),
  getProducts:       ()       => get(PHP, 'vmm-sp-products'),
  getNatures:        ()       => get(PHP, 'vmm-sp-natures'),
  getDelayReasons:   ()       => get(PHP, 'vmm-sp-delay-reasons'),
  getVendors:        ()       => get(PHP, 'vmm-sp-vendors'),
  getAmcVendor:        (storeCode, product) => get(PHP, 'vmm-sp-amc-vendor', { storeCode, product }),
  getEscalationMatrix: (params = {})        => get(PHP, 'vmm-sp-escalation-matrix', params),
  logComplaint:        (data)   => post(PHP, 'vmm-log-complaint',           data),
  getComplaint:        (complaintno) => get(PHP, 'vmm-get-complaint',       { complaintno }),
  sendEscalationEmail:          (data) => graph.sendEscalationEmailDirect(data),
  buildEscalationEmailContent: (data) => graph.buildEscalationEmailContent(data),
  resolveEscalationRecipients: (data) => graph.resolveEscalationRecipients(data),
  sendClosureEmail:    (data)   => graph.sendClosureEmailDirect(data),
  polishRemarks:       (text)   => post(BASE, 'vmm-ai-polish',           { text }),
  getRecentComplaints: (code)   => get(PHP,  'vmm-recent-complaints',   { storeCode: code }),
  searchComplaints:    (params) => get(PHP, 'vmm-search-complaints',    params),
  dashboardStats:    (params = {}) => get(PHP, 'vmm-dashboard-stats', params),
  getComplaintDetail:(ref)    => get(PHP, 'vmm-complaint-detail',   { no: ref }),
  getUserRole:  (email)  => get(PHP, 'vmm-user-role',   { email }),
  lookupCaller: (mobile) => get(PHP, 'vmm-sparktg-inbound', { mobile }),
  getFollowUpComplaints: ()     => get(PHP,  'vmm-followup-complaints'),
  updateComplaint:  (data)      => post(PHP, 'vmm-update-complaint',   data),
  escalateComplaint:(data)      => post(PHP, 'vmm-escalate-complaint', data),
  closeComplaint:   (data)      => post(PHP, 'vmm-close-complaint',    data),
  notConnected:     (data)      => post(PHP, 'vmm-not-connected',      data),
  updateEdc:        (data)      => post(PHP, 'vmm-update-edc',         data),

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
