import * as graph from '../auth/graphService';
import { vmm } from '../api/vmm';

export const STAGES = {
  fetch:    { label: 'Fetch',            engine: 'Mailbox connector (required)' },
  thread:   { label: 'Load Thread',      engine: 'Mailbox connector (required)' },
  parse:    { label: 'Parse',            engine: 'Local parser · optional AI assist' },
  verify:   { label: 'Verify',           engine: 'Backend lookup (required)' },
  decide:   { label: 'Complete?',        engine: 'Local decision' },
  reply:    { label: 'Missing-details reply', engine: 'Mailbox connector (required)' },
  log:      { label: 'Log Complaint',    engine: 'Backend (required)' },
  escalate: { label: 'Escalation email', engine: 'Mailbox connector (required)' },
};

const REQUIRED_FIELDS = ['storeCode', 'productName', 'natureOfProblem', 'description'];

export function normalizeText(value) {
  return (value || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function findBestByText(items, text, fields) {
  const target = normalizeText(text);
  if (!target) return null;
  let best = null;
  let bestScore = 0;
  for (const item of items || []) {
    for (const field of fields) {
      const value = normalizeText(item[field]);
      if (!value) continue;
      const score = value === target ? 100 : value.includes(target) || target.includes(value) ? Math.min(value.length, target.length) : 0;
      if (score > bestScore) { best = item; bestScore = score; }
    }
  }
  return best;
}

function camelToLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
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
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseLocally({ email, threadText = '', products = [], natures = [], templates = [] }) {
  const rawBody = (email.body || email.bodyPreview || threadText || '').replace(/<[^>]*>/g, ' ');
  const plain = stripHtml(email.body || threadText || '');
  const fullText = `${email.subject || ''}\n${rawBody}`;

  let storeCode = email.storeCode || '';
  if (!storeCode) {
    const hit = rawBody.match(/\bstore\s*(?:code)?\s*[-:]\s*([A-Z]{2}\d{2,3})\b/i);
    if (hit) storeCode = hit[1].toUpperCase();
  }

  let employeeCode = '';
  const empHit = rawBody.match(/\b(?:employee|emp|staff)\s*(?:code|id|no\.?)?\s*[-:]\s*(\d{5,7}|VMM\d{3})\b/i);
  if (empHit) employeeCode = empHit[1];

  const matchedProduct = findBestByText(products, (email.parsedProduct || '').trim() || '', ['name'])
    || findBestByText(products, fullText, ['name']);
  const matchedNature = findBestByText(natures, fullText, ['nature']);

  const description = (email.parsedDescription || '').trim() || plain.trim().slice(0, 400);

  const productName = matchedProduct?.name || email.parsedProduct || '';
  const natureOfProblem = matchedNature?.nature || '';
  const complaintType = matchedNature?.type || (natureOfProblem ? 'Repair' : '');
  const vendorName = matchedProduct?.vendor || '';

  const provided = {
    storeCode, employeeCode, productName, natureOfProblem,
    description: description ? 'provided' : '',
  };
  const missingFromTemplate = REQUIRED_FIELDS.filter(f => !provided[f] || !String(provided[f]).trim());

  const lines = [
    'Dear SM,',
    '',
    'Thank you for reaching out. To process your complaint, kindly share the following details:',
    '',
    ...(missingFromTemplate.length > 0
      ? missingFromTemplate.map(f => `• ${camelToLabel(f)}`)
      : ['• Additional details as per the template']),
    '',
    'Please reply at the earliest so we can log and assign the complaint.',
    '',
    'Regards,',
    'VMM Helpdesk Team',
    'Open Mind Services Limited',
  ];
  const suggestedReply = lines.join('\n');

  const matchedTemplate = missingFromTemplate.length === 0 && templates.length > 0
    ? templates.find(t => getTemplateTopMatches(t, productName, natureOfProblem))
    : null;

  return {
    storeCode, employeeCode, productName, vendorName, natureOfProblem, complaintType,
    description, missingFromTemplate, suggestedReply,
    aiAssistUsed: false,
    selectedTemplateId: matchedTemplate?.id ?? null,
  };
}

function getTemplateTopMatches(tpl, productName, nature) {
  const hay = (tpl.name || '').toLowerCase();
  const p = (productName || '').toLowerCase();
  const n = (nature || '').toLowerCase();
  return hay.includes(p) || hay.includes(n);
}

export function buildReplyHtml(text) {
  return '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7">'
    + (text || '').split('\n').map(l => l.trim() ? `<p style="margin:0 0 8px">${l}</p>` : '<br/>').join('')
    + '<hr style="margin:16px 0;border:none;border-top:1px solid #e2e8f0"/>'
    + '<p style="font-size:11px;color:#64748b">Open Mind Services Limited — VMM CRM</p></div>';
}

export async function runFetch() {
  const res = await vmm.fetchInbox();
  return { emails: res.emails || [], isIncremental: res.isIncremental };
}

export async function runThread(email) {
  if (!email?.conversationId) return { messages: [] };
  const res = await vmm.fetchThread(email.conversationId);
  return { messages: res.messages || [] };
}

export function cleanDescription(text) {
  return stripHtml(text || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, 400);
}

export function normalizeEmployeeCode(code) {
  const c = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (/^VMM\d{3}$/.test(c)) return c;
  const digits = c.replace(/\D+/g, '');
  if (digits.length >= 5 && digits.length <= 7) return digits;
  return c;
}

export function normalizeStoreCode(code) {
  const c = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
  const m = c.match(/[A-Z]{2}\d{2,3}/);
  return m ? m[0] : c;
}

export function normalizeParseResult(raw, { products = [], natures = [] } = {}) {
  if (!raw || typeof raw !== 'object') return { ...raw, score: 0, autoFixed: [], missingFromTemplate: [] };
  const changes = [];

  const rawStore = String(raw.storeCode || '').trim();
  const storeCode = normalizeStoreCode(raw.storeCode);
  if (rawStore && rawStore.toUpperCase() !== storeCode) changes.push(`store code → ${storeCode}`);

  const rawEmp = String(raw.employeeCode || '').trim();
  const employeeCode = normalizeEmployeeCode(raw.employeeCode);
  if (rawEmp && rawEmp.toUpperCase() !== employeeCode) changes.push(`employee code → ${employeeCode}`);

  let productName = raw.productName || '';
  if (productName && products.length) {
    const matched = findBestByText(products, productName, ['name']);
    if (matched && matched.name !== productName) {
      changes.push(`product → ${matched.name}`);
      productName = matched.name;
    }
  }

  let natureOfProblem = raw.natureOfProblem || '';
  if (natureOfProblem && natures.length) {
    const matched = findBestByText(natures, natureOfProblem, ['nature']);
    if (matched && matched.nature !== natureOfProblem) {
      changes.push(`nature → ${matched.nature}`);
      natureOfProblem = matched.nature;
    }
  }

  const natureRow = natures.find(n => n.nature === natureOfProblem);
  const complaintType = raw.complaintType || natureRow?.type || 'Repair';

  const description = cleanDescription(raw.description);
  if (raw.rawDescription && raw.rawDescription !== description) changes.push('description cleaned');

  const missingFromTemplate = (raw.missingFromTemplate || []).slice();

  const score = Math.round(
    (storeCode ? 25 : 0) + (employeeCode ? 20 : 0) + (productName ? 20 : 0) + (natureOfProblem ? 20 : 0) + (description ? 15 : 0)
  );

  return {
    ...raw,
    storeCode,
    employeeCode,
    productName,
    natureOfProblem,
    complaintType,
    description,
    missingFromTemplate,
    score,
    autoFixed: changes,
  };
}

export async function runParse(email, threadMessages, { products = [], natures = [], templates = [], aiAssist = false, lockedFields = {} } = {}) {
  const threadText = threadMessages.length > 0
    ? threadMessages.map(m => `[From: ${m.fromName || m.from}]\n${m.body || m.bodyHtml || m.bodyPreview || ''}`).join('\n\n---\n\n')
    : '';
  const emailBody = email.body || email.bodyPreview || threadText;
  const rawText = emailBody.replace(/<[^>]*>/g, ' ');

  let storeCode = lockedFields.storeCode || email.storeCode || '';
  if (!storeCode) {
    const hit = rawText.match(/\bstore\s*(?:code)?\s*[-:]\s*([A-Z]{2}\d{2,3})\b/i);
    if (hit) storeCode = hit[1].toUpperCase();
  }
  let employeeCode = lockedFields.employeeCode || '';
  const empHit = rawText.match(/\b(?:employee|emp|staff)\s*(?:code|id|no\.?)?\s*[-:]\s*(\d{5,7}|VMM\d{3})\b/i);
  if (!employeeCode && empHit) employeeCode = empHit[1];

  const local = parseLocally({ email, threadText, products, natures, templates });
  const baseLocal = normalizeParseResult({ ...local, rawDescription: local.description }, { products, natures });

  try {
    const res = await vmm.parseEmail({
      fromEmail: email.fromAddr,
      subject: email.subject,
      emailBody,
      storeCode,
      templates,
      natures: natures.map(n => ({ nature: n.nature, type: n.type })),
      productNames: [...new Set(products.map(p => p.name))],
      lockedFields: {
        ...lockedFields,
        employeeCode: /^VMM\d{3}$|^\d{5,7}$/.test(employeeCode) ? employeeCode : '',
      },
    });
    const merged = {
      ...baseLocal,
      ...res,
      rawDescription: res.description,
      missingFromTemplate: res.missingFromTemplate || baseLocal.missingFromTemplate,
      suggestedReply: res.suggestedReply || baseLocal.suggestedReply,
      selectedTemplateId: res.selectedTemplateId || baseLocal.selectedTemplateId,
      aiAssistUsed: true,
      source: 'api',
    };
    return normalizeParseResult(merged, { products, natures });
  } catch {
    return baseLocal;
  }
}

export async function runParseAll(emails, { products = [], natures = [], templates = [], onProgress = null } = {}) {
  const items = [];
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    try {
      const result = await runParse(email, [], { products, natures, templates, aiAssist: true });
      items.push({ email, result, ok: true, source: result.source });
    } catch (e) {
      items.push({ email, result: null, ok: false, error: e?.message || e });
    }
    if (onProgress) onProgress(i + 1, emails.length);
  }
  return items;
}

export async function runVerify(parseResult) {
  const out = { store: null, employee: null };
  if (parseResult?.storeCode) {
    try { const r = await vmm.lookupStore(parseResult.storeCode); out.store = r?.store || null; } catch { out.store = null; }
  }
  if (parseResult?.employeeCode) {
    try { const r = await vmm.lookupEmployee(parseResult.employeeCode); out.employee = r?.employee || null; } catch { out.employee = null; }
  }
  return out;
}

export function decideComplete(parseResult, verified) {
  const missing = parseResult?.missingFromTemplate || [];
  const storePresent = !!(parseResult?.storeCode || verified?.store);
  const missingFinal = missing.filter(f => f !== 'storeCode' || !storePresent);
  return { complete: missingFinal.length === 0, missing: missingFinal };
}

export function buildReplyPreview(parseResult, email, threadMessages) {
  const OWN = 'vmm.helpdesk@openmind.in';
  const sorted = [...threadMessages].sort((a, b) => new Date(a.receivedDateTime) - new Date(b.receivedDateTime));
  const originalFrom = sorted[0]?.from || email.fromAddr;
  const to = [originalFrom].filter(Boolean);
  if ((email.fromAddr || '').toLowerCase() !== OWN && !to.includes(email.fromAddr)) to.push(email.fromAddr);
  const cc = new Set();
  (sorted[0]?.cc || '').split(',').map(c => c.trim()).filter(Boolean).forEach(c => {
    if (c.toLowerCase() !== OWN && c.toLowerCase() !== (originalFrom || '').toLowerCase()) cc.add(c);
  });
  const subject = email.subject || '';
  return {
    to,
    cc: [...cc],
    subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
    body: parseResult?.suggestedReply || '',
    htmlBody: buildReplyHtml(parseResult?.suggestedReply || ''),
  };
}

export function buildLogPreview(parseResult, verified, email) {
  const store = verified?.store || {};
  const employee = verified?.employee || {};
  return {
    storeCode: parseResult?.storeCode || store.code || '',
    storeName: store.name || '',
    city: store.city || '',
    region: store.region || '',
    state: store.state || '',
    zone: store.zone || '',
    employeeCode: parseResult?.employeeCode || employee.code || '',
    employeeName: employee.name || '',
    contactNumber: employee.mobile || '',
    productName: parseResult?.productName || '',
    vendorName: parseResult?.vendorName || '',
    natureOfComplaint: parseResult?.natureOfProblem || '',
    complaintType: parseResult?.complaintType || 'Repair',
    description: parseResult?.description || '',
    emailFrom: email?.fromAddr || '',
  };
}

export function buildEscalatePreview(parseResult, verified, email, logPreview) {
  const store = verified?.store || {};
  const content = graph.buildEscalationEmailContent({
    storeCode: parseResult?.storeCode || store.code || '',
    storeName: store.name || '',
    storeEmail: store.email || '',
    fmName: store.fmName || '',
    fmEmail: store.fmEmail || '',
    region: store.region || '',
    zone: store.zone || '',
    storeState: store.state || '',
    storeCity: store.city || '',
    vendorName: parseResult?.vendorName || '',
    productName: parseResult?.productName || '',
    natureOfComplaint: parseResult?.natureOfProblem || '',
    complaints: [{
      complaintno: 'PREVIEW',
      productLocation: parseResult?.description || '',
      natureOfProblem: parseResult?.natureOfProblem || '',
      edcDate: '',
      description: parseResult?.description || '',
    }],
    manualVendorEmail: '',
  });
  return content;
}

export async function sendReply(messageId, preview) {
  return graph.replyOnThread({
    messageId,
    htmlBody: preview.htmlBody,
    toEmail: preview.to.join(';'),
    ccEmails: preview.cc.join(';'),
  });
}

export async function executePipeline(email, threadMessages, opts = {}) {
  const { products = [], natures = [], templates = [], aiAssist = false, stages = {}, parsedOverride = null, preloadedEmails = [] } = opts;
  const results = [];
  const push = (key, ok, detail, extra = {}) => results.push({ key, ok, detail, ...extra });

  if (stages.fetch) {
    try {
      const emails = preloadedEmails && preloadedEmails.length ? preloadedEmails : (await runFetch()).emails;
      push('fetch', true, `${emails.length} emails${preloadedEmails.length ? ' (already loaded — no API call)' : ' via mailbox connector'}`, {
        preview: {
          total: emails.length,
          unread: emails.filter(e => !e.isRead).length,
          sample: emails.slice(0, 5).map(e => ({ from: e.fromAddr, subject: e.subject, date: e.receivedDateTime })),
        },
      });
    } catch (e) {
      push('fetch', false, `Fetch failed: ${e?.message || e}`, {
        preview: { status: 'failed', error: e?.message || String(e) },
      });
    }
  }

  if (!email) return results;

  let msgs = threadMessages;
  if (stages.thread) {
    try {
      const r = await runThread(email);
      msgs = r.messages;
      push('thread', true, `${msgs.length} messages via mailbox connector`, {
        preview: {
          conversationId: email.conversationId || email.id || '—',
          total: msgs.length,
          messages: msgs.map(m => ({ from: m.fromName || m.from, date: m.receivedDateTime, snippet: (m.body || m.bodyPreview || '').slice(0, 120) })),
        },
      });
    } catch (e) {
      push('thread', false, `Thread failed: ${e?.message || e}`, {
        preview: { status: 'failed', error: e?.message || String(e), emailId: email.conversationId || email.id },
      });
    }
  }

  let parsedRes = null;
  if (stages.parse) {
    try {
      parsedRes = opts.parsedOverride || await runParse(email, msgs, { products, natures, templates, aiAssist });
      push('parse', true, `score ${parsedRes.score ?? '—'}/100 · ${parsedRes.autoFixed?.length ? `${parsedRes.autoFixed.length} auto-fixed · ` : ''}store: ${parsedRes.storeCode || '—'} · product: ${parsedRes.productName || '—'} · nature: ${parsedRes.natureOfProblem || '—'} · ${parsedRes.source === 'api' ? 'AI' : 'local'}`, {
        preview: parsedRes,
      });
    } catch (e) { push('parse', false, `Parse failed: ${e?.message || e}`, { preview: { status: 'failed', error: e?.message || String(e) } }); }
  }

  let verified = null;
  if (stages.verify && parsedRes) {
    try {
      verified = await runVerify(parsedRes);
      push('verify', true, `store: ${verified.store?.name || '—'} · employee: ${verified.employee?.name || '—'}`, {
        preview: { store: verified.store || null, employee: verified.employee || null },
      });
    } catch (e) { push('verify', false, `Verify failed: ${e?.message || e}`, { preview: { status: 'failed', error: e?.message || String(e) } }); }
  }

  let decision = null;
  if ((stages.decide) && parsedRes) {
    decision = decideComplete(parsedRes, verified);
    push('decide', true, decision.complete ? 'Complete — ready to log' : `Missing: ${decision.missing.map(camelToLabel).join(', ')}`, {
      preview: {
        complete: decision.complete,
        missing: decision.missing.map(camelToLabel),
        required: REQUIRED_FIELDS.map(camelToLabel),
      },
    });
  }

  if (stages.reply && parsedRes) {
    const preview = buildReplyPreview(parsedRes, email, msgs);
    push('reply', true, `to: ${preview.to.join(', ')} · ${preview.body.split('\n').slice(0, 4).join(' ')}`, { preview });
  }

  if (stages.log && parsedRes) {
    const preview = buildLogPreview(parsedRes, verified, email);
    push('log', true, `${preview.productName || '—'} @ ${preview.storeCode || '—'} · type: ${preview.complaintType}`, { preview });
  }

  if (stages.escalate && parsedRes) {
    try {
      const preview = buildEscalatePreview(parsedRes, verified, email, null);
      push('escalate', true, `to: ${preview.toEmail || '—'} · cc: ${preview.ccEmails || '—'}`, { preview });
    } catch (e) { push('escalate', false, `Escalation preview failed: ${e?.message || e}`, { preview: { status: 'failed', error: e?.message || String(e) } }); }
  }

  return results;
}