import * as graph from '../auth/graphService';

// Self-hosted n8n — CRM workflows
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
  // ── Self-hosted n8n ──────────────────────────────────
  lookupStore:       (code)   => get(BASE, 'vmm-sp-store',          { code }),
  lookupEmployee:    (code)   => get(BASE, 'vmm-sp-employee',        { code }),
  getProducts:       ()       => get(BASE, 'vmm-sp-products'),
  getNatures:        ()       => get(BASE, 'vmm-sp-natures'),
  getVendors:        ()       => get(BASE, 'vmm-sp-vendors'),
  getAmcVendor:        (storeCode, product) => get(BASE, 'vmm-sp-amc-vendor', { storeCode, product }),
  getEscalationMatrix: (params = {})        => get(BASE, 'vmm-sp-escalation-matrix', params),
  logComplaint:        (data)   => post(BASE, 'vmm-log-complaint',           data),
  sendEscalationEmail: (data)   => graph.sendEscalationEmailDirect(data),
  sendClosureEmail:    (data)   => graph.sendClosureEmailDirect(data),
  polishRemarks:       (text)   => post(BASE, 'vmm-ai-polish',           { text }),
  getRecentComplaints: (code)   => get(BASE,  'vmm-recent-complaints',   { storeCode: code }),
  emailClaim:          (data)   => post(BASE, 'vmm-email-claim',         data),
  searchComplaints:    (params) => get(BASE, 'vmm-search-complaints',    params),
  dashboardStats:    ()       => get(BASE, 'vmm-dashboard-stats'),
  getComplaintDetail:(id)     => get(BASE, 'vmm-complaint-detail',   { id }),
  getReports:        ()       => get(BASE, 'vmm-reports'),

  // ── Email — direct Graph API (no n8n / Power Automate) ─────────────────────
  fetchInbox:         (opts)    => graph.fetchInbox(opts),
  resetInboxDelta:    ()        => graph.resetInboxDelta(),
  searchEmails:       (q)       => graph.searchEmails(q),
  fetchSent:          ()        => graph.fetchSent(),
  fetchThread:        (convId)  => graph.fetchThread(convId),
  sendEmailReply:     (data)    => graph.replyOnThread({ messageId: data.messageId, htmlBody: data.htmlBody, toEmail: data.toRecipients, ccEmails: data.ccRecipients }),
  categorizeEmail:    (messageId, categories) => graph.categorizeEmail(messageId, categories),
  markEmailRead:      (messageId) => graph.markAsRead(messageId),
  sendNewEmail:       (data)    => graph.sendSharedMailboxEmail(data),

  // Still via n8n (no Graph API equivalent needed)
  fetchAttachments:   (msgId)   => get(CLOUD,  'vmm-fetch-attachments', { messageId: msgId }),
  getEmailTemplates:  ()        => get(CLOUD,  'vmm-email-templates'),
  parseEmail:         (data)    => post(BASE,  'vmm-parse-email',       data),
  // Self-hosted — log email activity on existing complaint
  logEmailActivity:  (data)   => post(BASE,  'vmm-email-log-activity', data),

  // ── WIP Emails ──────────────────────────────────────
  saveWip:        (data) => post(BASE, 'vmm-wip-save',    data),
  getOpenWips:    ()     => get(BASE,  'vmm-wip-list'),
  resolveWip:     (emailId) => post(BASE, 'vmm-wip-resolve', { emailId }),

  // ── Non-Trading Requests ─────────────────────────────
  listNtr:     ()    => get(BASE,  'vmm-ntr-list'),
  getNtrItems: (id)  => get(BASE,  'vmm-ntr-items', { requestId: id }),

  // ── User Management (MySQL-backed roles) ─────────────
  getUserRole:  (email)  => get(BASE, 'vmm-user-role',   { email }),
  listUsers:    ()       => get(BASE, 'vmm-users-list'),
  createUser:   (data)   => post(BASE, 'vmm-user-create', data),
  updateUser:   (data)   => post(BASE, 'vmm-user-update', data),
  deleteUser:   (data)   => post(BASE, 'vmm-user-delete', data),

  // ── Follow-up ────────────────────────────────────────
  getFollowUpComplaints: ()     => get(BASE,  'vmm-followup-complaints'),
  closeComplaint:   (data)      => post(BASE, 'vmm-close-complaint',   data),
  notConnected:     (data)      => post(BASE, 'vmm-not-connected',     data),
  updateEdc:        (data)      => post(BASE, 'vmm-update-edc',        data),
};
