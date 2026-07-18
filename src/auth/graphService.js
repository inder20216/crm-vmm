import { msalInstance, loginRequest, SHARED_MAILBOX } from './msalConfig';
import { AC_VENDOR_MAP, LIFT_VENDOR_MAP, getSmEmail, HO_POC, getVendorEscalation } from './escalationMatrix';

const GRAPH = 'https://graph.microsoft.com/v1.0';

// Delta link persisted in sessionStorage so refresh survives page reloads within the session
const DELTA_KEY = 'vmm_inbox_delta_link';

async function getAccessToken() {
  const accounts = msalInstance.getAllAccounts();
  if (!accounts.length) throw new Error('Not signed in');
  const res = await msalInstance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
  return res.accessToken;
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function buildRecipients(emailStr) {
  if (!emailStr) return [];
  return emailStr.split(/[;,]/).map(e => e.trim()).filter(Boolean).map(address => {
    const m = address.match(/^(.+?)\s*<(.+?)>$/);
    return m
      ? { emailAddress: { name: m[1].trim(), address: m[2].trim() } }
      : { emailAddress: { address } };
  });
}

function formatMessage(m) {
  const fromAddr = m.from?.emailAddress?.address || '';
  const fromName = m.from?.emailAddress?.name || fromAddr;
  const toArray  = (m.toRecipients || []).map(r => r.emailAddress?.address || '').filter(Boolean);
  const ccArray  = (m.ccRecipients || []).map(r => r.emailAddress?.address || '').filter(Boolean);

  const rawHtml = m.body?.content || m.bodyPreview || '';
  const bodyHtml = rawHtml
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .slice(0, 80000);

  const body = rawHtml
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s{3,}/g, '\n\n').trim();

  // Extract store code
  const allAddrs = [fromAddr, ...toArray, ...ccArray];
  let storeCode = null;
  for (const addr of allAddrs) {
    const hit = addr.match(/([A-Z]{2}\d{2,3})\.s[m]@/i);
    if (hit) { storeCode = hit[1].toUpperCase(); break; }
  }
  if (!storeCode) {
    const hit = (m.subject || '').match(/\b([A-Z]{2}\d{2,3})\b/);
    if (hit) storeCode = hit[1].toUpperCase();
  }

  const subject = m.subject || '';
  let complaintId = null;
  const cMatch = subject.match(/\[([A-Z]{0,4}-?\d{8,})\]/) || subject.match(/ticket\s+([A-Z]{0,4}-?\d{8,})/i);
  if (cMatch) complaintId = cMatch[1];

  let emailType = 'general';
  const isToHelpdesk = [...toArray, ...ccArray].some(a => a.toLowerCase().includes('vmm') || a.toLowerCase().includes('helpdesk'));
  if (complaintId)       emailType = 'complaint-reply';
  else if (isToHelpdesk) emailType = 'new-complaint';

  return {
    id: m.id,
    conversationId: m.conversationId || '',
    subject,
    fromAddr, fromName,
    fromDisplay: fromName !== fromAddr ? `${fromName} <${fromAddr}>` : fromAddr,
    toDisplay: toArray.join(', '),
    ccDisplay: ccArray.join(', '),
    toArray, ccArray,
    storeCode, complaintId, emailType,
    receivedAt: m.receivedDateTime || '',
    isRead: m.isRead || false,
    bodyPreview: body.slice(0, 250),
    body: body.slice(0, 20000),
    bodyHtml,
    hasStoreCode: !!storeCode,
    hasAttachments: m.hasAttachments || false,
    categories: m.categories || [],
  };
}

// ── Inbox with delta support ──────────────────────────────────────────────────
// Returns { emails, isIncremental }
// isIncremental = true means these are only new/changed since last call
export async function fetchInbox({ deltaMode = true } = {}) {
  const token = await getAccessToken();
  const mailbox = encodeURIComponent(SHARED_MAILBOX);
  // No `body` here — full body is fetched on-demand via fetchThread when user opens an email
  const SELECT = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,conversationId,isRead,hasAttachments,categories';

  const storedDeltaLink = sessionStorage.getItem(DELTA_KEY);
  const isIncremental   = deltaMode && !!storedDeltaLink;

  let url = isIncremental
    ? storedDeltaLink
    : `${GRAPH}/users/${mailbox}/mailFolders/inbox/messages/delta?$select=${SELECT}&$top=999`;

  const allMessages = [];
  let nextUrl = url;

  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      // Delta link expired — reset and do a full fetch next time
      if (res.status === 410) {
        sessionStorage.removeItem(DELTA_KEY);
        return fetchInbox({ deltaMode: false });
      }
      throw new Error(`Inbox fetch failed: ${res.status}`);
    }
    const data = await res.json();
    allMessages.push(...(data.value || []));
    if (data['@odata.deltaLink']) sessionStorage.setItem(DELTA_KEY, data['@odata.deltaLink']);
    nextUrl = data['@odata.nextLink'] || null;
  }

  // Filter out tombstones (@removed entries from delta)
  const active = allMessages.filter(m => !m['@removed']);
  const emails = active.map(formatMessage).sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));

  return { emails, isIncremental };
}

export function resetInboxDelta() {
  sessionStorage.removeItem(DELTA_KEY);
}

// ── Sent items ────────────────────────────────────────────────────────────────
export async function fetchSent() {
  const token = await getAccessToken();
  const mailbox = encodeURIComponent(SHARED_MAILBOX);
  const SELECT = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,conversationId,isRead,hasAttachments,categories';

  const res = await fetch(
    `${GRAPH}/users/${mailbox}/mailFolders/sentItems/messages?$select=${SELECT}&$top=999`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Sent fetch failed: ${res.status}`);
  const data = await res.json();
  const emails = (data.value || []).map(formatMessage);
  return { emails };
}

// ── Search ────────────────────────────────────────────────────────────────────
export async function searchEmails(q) {
  const token = await getAccessToken();
  const mailbox = encodeURIComponent(SHARED_MAILBOX);
  const SELECT = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,conversationId,isRead,hasAttachments';

  const res = await fetch(
    `${GRAPH}/users/${mailbox}/messages?$search="${encodeURIComponent(q)}"&$select=${SELECT}&$top=25`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const data = await res.json();
  const emails = (data.value || []).map(formatMessage);
  return { emails };
}

// ── Thread fetch ──────────────────────────────────────────────────────────────
export async function fetchThread(conversationId) {
  const token = await getAccessToken();
  const mailbox = encodeURIComponent(SHARED_MAILBOX);
  const SELECT = 'id,subject,from,sender,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,bodyPreview,body,conversationId,isRead,hasAttachments,categories';

  // Use URLSearchParams so conversationId (contains +/=/etc.) is properly encoded
  const params = new URLSearchParams({
    '$filter': `conversationId eq '${conversationId}'`,
    '$select': SELECT,
    '$top':    '50',
    '$orderby': 'receivedDateTime asc',
  });

  const res = await fetch(
    `${GRAPH}/users/${mailbox}/messages?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  // If $filter+$orderby together aren't allowed, retry without $orderby
  if (res.status === 400) {
    const params2 = new URLSearchParams({
      '$filter': `conversationId eq '${conversationId}'`,
      '$select': SELECT,
      '$top':    '50',
    });
    const res2 = await fetch(
      `${GRAPH}/users/${mailbox}/messages?${params2.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res2.ok) throw new Error(`Thread fetch failed: ${res2.status}`);
    const data2 = await res2.json();
    return buildThreadResult(data2.value || []);
  }

  if (!res.ok) throw new Error(`Thread fetch failed: ${res.status}`);
  const data = await res.json();
  return buildThreadResult(data.value || []);
}

function buildThreadResult(raw) {
  const messages = raw
    .sort((a, b) => new Date(a.receivedDateTime) - new Date(b.receivedDateTime))
    .map(m => {
      const fromAddr = m.from?.emailAddress?.address || m.sender?.emailAddress?.address || '';
      const fromName = m.from?.emailAddress?.name   || m.sender?.emailAddress?.name   || fromAddr;
      return {
        id:               m.id,
        subject:          m.subject || '',
        from:             fromAddr,
        fromName,
        fromDisplay:      fromName && fromName !== fromAddr ? `${fromName} <${fromAddr}>` : fromAddr,
        to:               (m.toRecipients  || []).map(r => r.emailAddress?.address || '').filter(Boolean).join(', '),
        toFull:           (m.toRecipients  || []).map(r => r.emailAddress?.name ? `${r.emailAddress.name} <${r.emailAddress.address}>` : r.emailAddress?.address || '').filter(Boolean).join(', '),
        cc:               (m.ccRecipients  || []).map(r => r.emailAddress?.address || '').filter(Boolean).join(', '),
        ccFull:           (m.ccRecipients  || []).map(r => r.emailAddress?.name ? `${r.emailAddress.name} <${r.emailAddress.address}>` : r.emailAddress?.address || '').filter(Boolean).join(', '),
        bcc:              (m.bccRecipients || []).map(r => r.emailAddress?.address || '').filter(Boolean).join(', '),
        receivedDateTime: m.receivedDateTime || m.sentDateTime || '',
        sentDateTime:     m.sentDateTime     || '',
        bodyPreview:      m.bodyPreview || '',
        body:             m.body?.content || m.bodyPreview || '',
        bodyHtml:         m.body?.content || '',
        conversationId:   m.conversationId || '',
        isRead:           m.isRead || false,
        hasAttachments:   m.hasAttachments || false,
        categories:       m.categories || [],
      };
    });

  return { messages, count: messages.length };
}

// ── Send new email from shared mailbox ────────────────────────────────────────
export async function sendSharedMailboxEmail({ toEmail, ccEmails, subject, htmlBody }) {
  const token = await getAccessToken();
  const base = `${GRAPH}/users/${encodeURIComponent(SHARED_MAILBOX)}`;

  const draftRes = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      subject,
      body: { contentType: 'HTML', content: htmlBody },
      toRecipients: buildRecipients(toEmail),
      ccRecipients: buildRecipients(ccEmails),
    }),
  });
  if (!draftRes.ok) throw new Error(`Create draft failed: ${draftRes.status}`);
  const draft = await draftRes.json();

  const sendRes = await fetch(`${base}/messages/${draft.id}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!sendRes.ok) throw new Error(`Send failed: ${sendRes.status}`);

  return { messageId: draft.id, conversationId: draft.conversationId };
}

// ── Reply on thread ───────────────────────────────────────────────────────────
export async function replyOnThread({ messageId, htmlBody, toEmail, ccEmails }) {
  const token = await getAccessToken();
  const base = `${GRAPH}/users/${encodeURIComponent(SHARED_MAILBOX)}`;

  const res = await fetch(`${base}/messages/${messageId}/reply`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      message: {
        toRecipients: buildRecipients(toEmail),
        ccRecipients: buildRecipients(ccEmails),
      },
      comment: htmlBody,
    }),
  });
  if (!res.ok) throw new Error(`Reply failed: ${res.status}`);
  return { success: true };
}

// ── Categorize/tag email ──────────────────────────────────────────────────────
export async function categorizeEmail(messageId, categories) {
  const token = await getAccessToken();
  const mailbox = encodeURIComponent(SHARED_MAILBOX);

  const res = await fetch(`${GRAPH}/users/${mailbox}/messages/${messageId}`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ categories: Array.isArray(categories) ? categories : [categories] }),
  });
  if (!res.ok) throw new Error(`Categorize failed: ${res.status}`);
  return { success: true };
}

// ── Mark as read ──────────────────────────────────────────────────────────────
export async function markAsRead(messageId) {
  const token = await getAccessToken();
  const mailbox = encodeURIComponent(SHARED_MAILBOX);

  const res = await fetch(`${GRAPH}/users/${mailbox}/messages/${messageId}`, {
    method: 'PATCH',
    headers: authHeader(token),
    body: JSON.stringify({ isRead: true }),
  });
  if (!res.ok) throw new Error(`Mark read failed: ${res.status}`);
  return { success: true };
}

// ── Internal recipients for escalation ───────────────────────────────────────
const ESCALATION_TEAM = ['inder@openmind.in', 'deepansh@openmind.in'];

async function sendFromSharedMailbox({ subject, htmlBody, toAddresses, ccAddresses = [] }) {
  const token = await getAccessToken();
  const base = `${GRAPH}/users/${encodeURIComponent(SHARED_MAILBOX)}`;
  const draftRes = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({
      subject,
      body: { contentType: 'HTML', content: htmlBody },
      toRecipients: toAddresses.map(a =>
        typeof a === 'string' ? { emailAddress: { address: a } } : a
      ),
      ccRecipients: ccAddresses.map(a =>
        typeof a === 'string' ? { emailAddress: { address: a } } : a
      ),
    }),
  });
  if (!draftRes.ok) throw new Error(`Draft failed: ${draftRes.status}`);
  const draft = await draftRes.json();
  const sendRes = await fetch(`${base}/messages/${draft.id}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!sendRes.ok) throw new Error(`Send failed: ${sendRes.status}`);
  return { success: true, messageId: draft.id };
}

// ── Resolve vendor email for escalation routing ───────────────────────────────
// Priority: store-specific AMC map → state-wise OEM escalation → pan-India fallback
function resolveVendorEmail(storeCode, productName, vendorName, storeState, storeCity) {
  const prod = (productName || '').toLowerCase().trim();
  const code = (storeCode || '').toUpperCase();

  // AC / Server Room AC → store-specific AMC vendor (most accurate)
  if (prod === 'ac' || prod === 'air conditioner' || prod === 'server room ac') {
    const entry = AC_VENDOR_MAP[code];
    if (entry?.ve) return { email: entry.ve, name: entry.vn || vendorName };
  }

  // Lift / Escalator → store-specific vendor
  if (prod === 'lift' || prod === 'escalator' || prod === 'lift battery') {
    const entry = LIFT_VENDOR_MAP[code];
    if (entry?.ve) return { email: entry.ve, name: entry.vn || vendorName };
  }

  // City+state-wise OEM escalation (Carrier, BlueStar, Hitachi, Fuji, Adtech, KONE, Atandra…)
  const oemHit = getVendorEscalation(vendorName, storeState, 1, storeCity);
  if (oemHit) return { email: oemHit.email, name: vendorName, level: 1, vendor: oemHit.vendor };

  // Product-name-based OEM lookup when no vendorName provided
  const oemByProd = getVendorEscalation(productName, storeState, 1, storeCity);
  if (oemByProd) return { email: oemByProd.email, name: productName, level: 1, vendor: oemByProd.vendor };

  return null;
}

// ── Escalation email ──────────────────────────────────────────────────────────
export async function sendEscalationEmailDirect({
  storeCode, storeName, storeEmail, fmName, fmEmail, region, zone, storeState, storeCity,
  vendorName, productName, natureOfComplaint, complaints = [],
}) {
  const nos = complaints.map(c => c.complaintno).join(', ');
  const isMultiple = complaints.length > 1;

  // Resolve routing: vendor email, SM email, HO contact
  const vendorResolved  = resolveVendorEmail(storeCode, productName, vendorName, storeState, storeCity);
  const smEmail         = getSmEmail(storeCode);
  const hoPoc           = HO_POC[productName] || HO_POC['DEFAULT'];
  const resolvedVendor  = vendorResolved?.name || vendorName || '—';

  // Determine routing mode
  const isVendorCase = !!vendorResolved?.email;

  const subject = isMultiple
    ? `[VMM] New Complaints — ${storeCode} | ${productName} | ${complaints.length} Units`
    : `[VMM] New Complaint — ${storeCode} | ${productName} | ${nos}`;

  const rows = complaints.map((c, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'}">
      <td style="padding:9px 14px;border-bottom:1px solid #e2e8f0">${c.complaintno}</td>
      <td style="padding:9px 14px;border-bottom:1px solid #e2e8f0">${c.productLocation || '—'}</td>
      <td style="padding:9px 14px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#059669">${c.edcDate || '—'}</td>
    </tr>`).join('');

  const htmlBody = `
<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;max-width:640px;margin:0 auto">
  <div style="background:#1e1b4b;padding:18px 28px;border-radius:8px 8px 0 0">
    <div style="color:#a5b4fc;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px">VMM Facility Management</div>
    <h2 style="color:#fff;margin:0;font-size:18px">New Complaint${isMultiple ? 's' : ''} — Action Required</h2>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e2e8f0;border-top:none">
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr><td style="padding:5px 0;color:#64748b;width:140px;vertical-align:top">Store</td><td style="padding:5px 0;font-weight:600">${storeName || ''} (${storeCode})</td></tr>
      ${region ? `<tr><td style="padding:5px 0;color:#64748b">Region / Zone</td><td style="padding:5px 0">${region}${zone ? ' / ' + zone : ''}</td></tr>` : ''}
      <tr><td style="padding:5px 0;color:#64748b">Product</td><td style="padding:5px 0">${productName}</td></tr>
      ${natureOfComplaint ? `<tr><td style="padding:5px 0;color:#64748b">Nature</td><td style="padding:5px 0">${natureOfComplaint}</td></tr>` : ''}
      <tr><td style="padding:5px 0;color:#64748b">Vendor</td><td style="padding:5px 0;font-weight:600;color:#1e1b4b">${resolvedVendor}</td></tr>
      ${fmName ? `<tr><td style="padding:5px 0;color:#64748b">FM</td><td style="padding:5px 0">${fmName}${fmEmail ? ' &lt;' + fmEmail + '&gt;' : ''}</td></tr>` : ''}
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#1e1b4b">
          <th style="padding:9px 14px;color:#fff;text-align:left;font-weight:600">Complaint No</th>
          <th style="padding:9px 14px;color:#fff;text-align:left;font-weight:600">Location</th>
          <th style="padding:9px 14px;color:#fff;text-align:left;font-weight:600">Expected Closure</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div style="margin-top:20px;padding:12px 16px;background:#fef9c3;border-left:4px solid #f59e0b;border-radius:0 6px 6px 0;font-size:13px;color:#92400e">
      ${isVendorCase
        ? 'Please attend the complaint and confirm assignment within 24 hours.'
        : 'Please coordinate with the concerned team and update the status within 24 hours.'}
    </div>
  </div>
  <div style="padding:12px 28px;background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;font-size:11px;color:#94a3b8">
    Open Mind Services Limited &nbsp;·&nbsp; VMM CRM &nbsp;·&nbsp; vmm.helpdesk@openmind.in
  </div>
</div>`;

  // Build TO / CC based on routing
  const makeAddr = (email, name) => ({ emailAddress: { address: email, name: name || '' } });
  const addUniq = (list, email, name) => {
    if (email && !list.some(x => x.emailAddress.address === email)) list.push(makeAddr(email, name));
  };

  let toAddresses, ccAddresses;

  if (isVendorCase) {
    // Vendor case: TO vendor, CC Store + FM + SM + HO + internal
    toAddresses = [makeAddr(vendorResolved.email, resolvedVendor)];
    ccAddresses = [];
    if (storeEmail) addUniq(ccAddresses, storeEmail, storeName);
    if (fmEmail)    addUniq(ccAddresses, fmEmail, fmName);
    if (smEmail)    addUniq(ccAddresses, smEmail, `SM ${storeCode}`);
    if (hoPoc?.email) addUniq(ccAddresses, hoPoc.email, hoPoc.name);
    ESCALATION_TEAM.forEach(a => addUniq(ccAddresses, a, ''));
  } else {
    // Non-vendor case: TO FM + HO, CC Store + SM + internal
    toAddresses = [];
    if (fmEmail)      addUniq(toAddresses, fmEmail, fmName);
    if (hoPoc?.email) addUniq(toAddresses, hoPoc.email, hoPoc.name);
    if (!toAddresses.length) toAddresses = ESCALATION_TEAM.map(a => makeAddr(a, ''));
    ccAddresses = [];
    if (storeEmail) addUniq(ccAddresses, storeEmail, storeName);
    if (smEmail)    addUniq(ccAddresses, smEmail, `SM ${storeCode}`);
    ESCALATION_TEAM.forEach(a => addUniq(ccAddresses, a, ''));
  }

  return sendFromSharedMailbox({ subject, htmlBody, toAddresses, ccAddresses });
}

// ── Closure email ─────────────────────────────────────────────────────────────
export async function sendClosureEmailDirect({
  storeCode, storeName, storeEmail, fmEmail, fmName,
  vendorName, productName, complaintno, closureStatus, closureDate, remarks,
}) {
  const subject = `[VMM] Complaint ${closureStatus} — ${complaintno} | ${storeCode}`;

  const statusColor = closureStatus === 'Closed' ? '#059669'
    : closureStatus === 'Resolved'  ? '#0284c7'
    : '#d97706';

  const htmlBody = `
<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;max-width:600px;margin:0 auto">
  <div style="background:#1e1b4b;padding:18px 28px;border-radius:8px 8px 0 0">
    <div style="color:#a5b4fc;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px">VMM Facility Management</div>
    <h2 style="color:#fff;margin:0;font-size:18px">Complaint ${closureStatus}</h2>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e2e8f0;border-top:none">
    <p style="margin:0 0 16px">Dear Store Team,</p>
    <p style="margin:0 0 20px">
      Your complaint has been <strong style="color:${statusColor}">${closureStatus}</strong> by the VMM Helpdesk team.
    </p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr style="background:#f8fafc"><td style="padding:8px 14px;color:#64748b;width:150px">Complaint No</td><td style="padding:8px 14px;font-weight:700">${complaintno}</td></tr>
      <tr><td style="padding:8px 14px;color:#64748b">Store</td><td style="padding:8px 14px">${storeName || ''} (${storeCode})</td></tr>
      <tr style="background:#f8fafc"><td style="padding:8px 14px;color:#64748b">Product</td><td style="padding:8px 14px">${productName || '—'}</td></tr>
      <tr><td style="padding:8px 14px;color:#64748b">Vendor</td><td style="padding:8px 14px">${vendorName || '—'}</td></tr>
      <tr style="background:#f8fafc"><td style="padding:8px 14px;color:#64748b">Status</td><td style="padding:8px 14px;font-weight:600;color:${statusColor}">${closureStatus}</td></tr>
      ${closureDate ? `<tr><td style="padding:8px 14px;color:#64748b">Closure Date</td><td style="padding:8px 14px">${closureDate}</td></tr>` : ''}
      ${remarks ? `<tr style="background:#f8fafc"><td style="padding:8px 14px;color:#64748b;vertical-align:top">Remarks</td><td style="padding:8px 14px">${remarks}</td></tr>` : ''}
    </table>

    <p style="margin:0;font-size:13px;color:#64748b">If you have any further queries, please write to us at vmm.helpdesk@openmind.in</p>
    <p style="margin:16px 0 0;font-size:13px">Regards,<br/><strong>VMM Helpdesk Team</strong><br/>Open Mind Services Limited</p>
  </div>
  <div style="padding:12px 28px;background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;font-size:11px;color:#94a3b8">
    Open Mind Services Limited &nbsp;·&nbsp; VMM CRM &nbsp;·&nbsp; vmm.helpdesk@openmind.in
  </div>
</div>`;

  const makeAddr = (email, name) => ({ emailAddress: { address: email, name: name || '' } });
  const addUniq = (list, email, name) => {
    if (email && !list.some(x => x.emailAddress.address === email)) list.push(makeAddr(email, name));
  };

  const smEmail = getSmEmail(storeCode);
  const hoPoc   = HO_POC[productName] || HO_POC['DEFAULT'];

  const toList = [];
  if (storeEmail) addUniq(toList, storeEmail, storeName);
  if (!toList.length) ESCALATION_TEAM.forEach(a => addUniq(toList, a, ''));

  const ccList = [];
  if (fmEmail)      addUniq(ccList, fmEmail, fmName);
  if (smEmail)      addUniq(ccList, smEmail, `SM ${storeCode}`);
  if (hoPoc?.email) addUniq(ccList, hoPoc.email, hoPoc.name);
  ESCALATION_TEAM.forEach(a => addUniq(ccList, a, ''));

  return sendFromSharedMailbox({ subject, htmlBody, toAddresses: toList, ccAddresses: ccList });
}
