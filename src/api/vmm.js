// Self-hosted n8n — CRM workflows
const BASE = import.meta.env.VITE_API_BASE || '/webhook';

// Cloud n8n — Email workflows
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
  logComplaint:        (data)   => post(BASE, 'vmm-log-complaint',       data),
  sendEscalationEmail: (data)   => post(BASE, 'vmm-send-escalation-email', data),
  polishRemarks:       (text)   => post(BASE, 'vmm-ai-polish',           { text }),
  getRecentComplaints: (code)   => get(BASE,  'vmm-recent-complaints',   { storeCode: code }),
  emailClaim:          (data)   => post(BASE, 'vmm-email-claim',         data),
  searchComplaints:    (params) => get(BASE, 'vmm-search-complaints',    params),
  dashboardStats:    ()       => get(BASE, 'vmm-dashboard-stats'),
  getComplaintDetail:(id)     => get(BASE, 'vmm-complaint-detail',   { id }),
  getReports:        ()       => get(BASE, 'vmm-reports'),

  // ── Cloud n8n — Email ────────────────────────────────
  fetchInbox:         ()        => get(CLOUD,  'vmm-fetch-inbox'),
  fetchSent:          ()        => get(CLOUD,  'vmm-fetch-sent'),
  fetchAttachments:   (msgId)   => get(CLOUD,  'vmm-fetch-attachments', { messageId: msgId }),
  getEmailTemplates:  ()        => get(CLOUD,  'vmm-email-templates'),
  parseEmail:        (data)   => post(CLOUD, 'vmm-parse-email',      data),
  sendEmailReply:    (data)   => post(CLOUD, 'vmm-send-email-reply', data),
  // Self-hosted — log email activity on existing complaint
  logEmailActivity:  (data)   => post(BASE,  'vmm-email-log-activity', data),

  // ── Follow-up ────────────────────────────────────────
  getFollowUpComplaints: ()     => get(BASE,  'vmm-followup-complaints'),
  closeComplaint:   (data)      => post(BASE, 'vmm-close-complaint',   data),
  notConnected:     (data)      => post(BASE, 'vmm-not-connected',     data),
  updateEdc:        (data)      => post(BASE, 'vmm-update-edc',        data),
};
