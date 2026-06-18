import { useState, useEffect, useRef } from 'react';
import { vmm } from '../api/vmm';
import './EmailComplaints.css';

function fmtTime(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  const now = new Date();
  const diff = now - d;
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

const REQUIRED_FIELDS = ['storeCode', 'productName', 'natureOfProblem', 'description'];
const FIELD_LABELS = {
  storeCode: 'Store Code', employeeCode: 'Employee Code', employeeName: 'Employee Name',
  contactNumber: 'Contact Number', productName: 'Product Name',
  productLocation: 'Product Location', description: 'Description',
};

function SearchableSelect({ options, value, onChange, placeholder, getLabel, getSub }) {
  const [query,   setQuery]   = useState(value || '');
  const [open,    setOpen]    = useState(false);
  const ref = useRef(null);

  useEffect(() => { setQuery(value || ''); }, [value]);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = query.trim()
    ? options.filter(o => getLabel(o).toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        type="text"
        className="ec-field-input"
        placeholder={placeholder}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div className="ec-picker-dropdown">
          {filtered.slice(0, 25).map((item, i) => (
            <div key={i} className="ec-picker-option"
              onMouseDown={() => { onChange(item); setQuery(getLabel(item)); setOpen(false); }}>
              <span className="ec-picker-main">{getLabel(item)}</span>
              {getSub && getSub(item) && <span className="ec-picker-sub">{getSub(item)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function camelToLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

function normalizeText(value) {
  return (value || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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
  const [activeTab, setActiveTab] = useState('inbox'); // 'inbox' | 'sent'
  const [emails,    setEmails]    = useState([]);
  const [fetching,  setFetching]  = useState(false);
  const [selected,  setSelected]  = useState(null);
  const [parsing,   setParsing]   = useState(false);
  const [parsed,    setParsed]    = useState(null);
  const [replyBody, setReplyBody] = useState('');
  const [sending,   setSending]   = useState(false);
  const [logging,       setLogging]       = useState(false);
  const [loggingActivity, setLoggingActivity] = useState(false);
  const [toast,         setToast]         = useState('');
  const [activeAction,    setActiveAction]    = useState(null);
  const [updateForm,      setUpdateForm]      = useState({ complaintId: '', remarks: '', newStatus: '', newEdc: '' });
  const [attachmentData,  setAttachmentData]  = useState(null);
  const [loadingAttach,   setLoadingAttach]   = useState(false);
  const [wipList,   setWipList]   = useState(() => JSON.parse(localStorage.getItem('vmm_wip_emails') || '[]'));
  const [templates,    setTemplates]    = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [products,     setProducts]     = useState([]);
  const [natures,      setNatures]      = useState([]);
  const [parsedEdits,  setParsedEdits]  = useState({ storeCode: '', productName: '', vendorName: '', natureOfProblem: '', complaintType: '' });
  const [replyTo,         setReplyTo]         = useState([]);
  const [replyCc,         setReplyCc]         = useState([]);
  const [toInput,         setToInput]         = useState('');
  const [ccInput,         setCcInput]         = useState('');
  const [empLookupStatus, setEmpLookupStatus] = useState('idle'); // idle|loading|found|not-found
  const [resolvedEmpName, setResolvedEmpName] = useState('');
  const [showReplyEditor, setShowReplyEditor] = useState(false);
  const [quantity,        setQuantity]        = useState(1);
  const [confirmModal,    setConfirmModal]    = useState(false);
  const [activeClaims,    setActiveClaims]    = useState({});
  const [logSuccess,      setLogSuccess]      = useState(null); // { results, payload } after successful log
  const [emailTags,       setEmailTags]       = useState(() => JSON.parse(localStorage.getItem('vmm_email_tags') || '{}')); // { [emailId]: { type, label, time } }
  const [tagFilter,       setTagFilter]       = useState(null); // null | 'wip' | 'logged'

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
    vmm.getNatures().then(r => setNatures(r.natures || [])).catch(() => {});
  }, []);

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(''), 3500);
  };

  const tagEmail = (id, type, label) => {
    const updated = { ...JSON.parse(localStorage.getItem('vmm_email_tags') || '{}'), [id]: { type, label, time: new Date().toISOString() } };
    localStorage.setItem('vmm_email_tags', JSON.stringify(updated));
    setEmailTags(updated);
  };

  const fetchEmails = async (tab) => {
    const folder = tab || activeTab;
    setFetching(true);
    setEmails([]);
    setSelected(null);
    setParsed(null);
    try {
      const res = folder === 'sent' ? await vmm.fetchSent() : await vmm.fetchInbox();
      setEmails(res.emails || []);
      if (!res.emails?.length) showToast(`No emails in ${folder === 'sent' ? 'Sent' : 'Inbox'}`, 'info');
    } catch {
      showToast('Could not fetch emails. Please try again.', 'err');
    } finally { setFetching(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchEmails('inbox'); }, []);

  const switchTab = (tab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setSelected(null);
    setParsed(null);
    fetchEmails(tab);
  };

  const selectEmail = (email) => {
    setSelected(email);
    setParsed(null);
    setReplyBody('');
    setActiveAction(null);
    setUpdateForm({ complaintId: email.complaintId || '', remarks: '', newStatus: '', newEdc: '' });
    // Restore cached attachments so the Load button doesn't reappear after refresh
    const cached = email.id ? localStorage.getItem(`vmm_attach_${email.id}`) : null;
    setAttachmentData(cached ? JSON.parse(cached) : null);
    // Default reply-to = the email sender; CC starts empty
    setReplyTo(email.fromAddr ? [email.fromAddr] : []);
    setReplyCc([]);
    setToInput('');
    setCcInput('');
    setShowReplyEditor(false);
    setQuantity(1);

    // WIP email — restore previously parsed fields so agent can edit and log directly
    if (email.parsed) {
      const p = email.parsed;
      setParsed(p);
      setActiveAction('log-new');
      const matchedProduct = findBestByText(products, p.productName || '', ['name']);
      const matchedNature  = findBestByText(natures,  p.natureOfProblem || '', ['nature']);
      setParsedEdits({
        storeCode:       p.storeCode || email.storeCode || '',
        productName:     matchedProduct?.name   || p.productName     || '',
        vendorName:      matchedProduct?.vendor || p.vendorName      || '',
        natureOfProblem: matchedNature?.nature  || p.natureOfProblem || '',
        complaintType:   matchedNature?.type    || p.complaintType   || '',
      });
      if (p.employeeCode) {
        setEmpLookupStatus(p.employeeName ? 'found' : 'idle');
        setResolvedEmpName(p.employeeName || '');
      } else {
        setEmpLookupStatus('idle');
        setResolvedEmpName('');
      }
      if (p.quantity && p.quantity > 1) setQuantity(Math.min(20, p.quantity));
      if (p.suggestedReply) setReplyBody(p.suggestedReply);
    } else {
      setEmpLookupStatus('idle');
      setResolvedEmpName('');
      setParsedEdits({ storeCode: email.storeCode || '', productName: '', vendorName: '', natureOfProblem: '', complaintType: '' });
    }
  };

  const claimEmail = (emailId, op = 'claim') => {
    vmm.emailClaim({ operation: op, emailId, agentId, agentLabel: `Agent ${agentId.slice(-4)}` })
      .then(r => setActiveClaims(r.claims || {}))
      .catch(() => {});
  };

  const parseEmail = async () => {
    if (!selected) return;
    setParsing(true);
    setShowReplyEditor(false);
    setReplyBody('');
    // Mark this email as "being worked on" by this agent
    claimEmail(selected.id, 'claim');
    try {
      const res = await vmm.parseEmail({
        fromEmail:  selected.fromAddr,
        subject:    selected.subject,
        emailBody:  selected.body,
        storeCode:  selected.storeCode,
        templates,
      });
      // Employee — lookup from code if present; clear if not
      if (!res.employeeCode) {
        res.employeeName = null;
        setEmpLookupStatus('idle');
        setResolvedEmpName('');
      } else {
        setEmpLookupStatus('loading');
        try {
          const empRes = await vmm.lookupEmployee(res.employeeCode);
          if (empRes.found && empRes.employee?.name) {
            res.employeeName = empRes.employee.name;
            if (!res.contactNumber && empRes.employee.mobile) {
              res.contactNumber = empRes.employee.mobile;
            }
            // If store code is missing, auto-fill from employee's store
            if (!res.storeCode && !selected.storeCode && empRes.employee.storeCode) {
              res.storeCode = empRes.employee.storeCode;
            }
            setResolvedEmpName(empRes.employee.name);
            setEmpLookupStatus('found');
          } else {
            res.employeeName = null;
            setResolvedEmpName('');
            setEmpLookupStatus('not-found');
          }
        } catch {
          res.employeeName = null;
          setResolvedEmpName('');
          setEmpLookupStatus('not-found');
        }
      }
      // Product — nearest match from real list
      const matchedProduct = findBestByText(products, res.productName || '', ['name']);
      // Nature — nearest match from real natures list
      const matchedNature  = findBestByText(natures,  res.natureOfProblem || '', ['nature']);
      setParsedEdits({
        storeCode:       res.storeCode || selected?.storeCode || '',
        productName:     matchedProduct?.name    || '',
        vendorName:      matchedProduct?.vendor  || '',
        natureOfProblem: matchedNature?.nature   || '',
        complaintType:   matchedNature?.type     || '',
      });
      setParsed(res);
      setSelectedTemplateId(res.selectedTemplateId || null);
      setQuantity(Math.max(1, Math.min(20, Math.round(Number(res.quantity) || 1))));
      if (res.suggestedReply) setReplyBody(res.suggestedReply);
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
        messageId:    selected.id,
        htmlBody:     html,
        body:         replyBody,
        toRecipients: replyTo.join(';'),
        ccRecipients: replyCc.join(';'),
      });
      // Save as WIP
      const wip = { id: selected.id, subject: selected.subject, fromAddr: selected.fromAddr,
        storeCode: selected.storeCode, receivedAt: selected.receivedAt,
        repliedAt: new Date().toISOString(), parsed, status: 'WIP',
        savedBy: `Agent ${agentId.slice(-4)}` };
      const updated = [...wipList.filter(w => w.id !== selected.id), wip];
      setWipList(updated);
      localStorage.setItem('vmm_wip_emails', JSON.stringify(updated));
      setEmails(prev => prev.filter(e => e.id !== selected.id));
      setSelected(null); setParsed(null); setReplyBody('');
      showToast('Reply sent — email saved as WIP', 'ok');
    } catch {
      showToast('Failed to send reply', 'err');
    } finally { setSending(false); }
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
      const [storeRes, empRes] = await Promise.all([
        storeCode ? vmm.lookupStore(storeCode).catch(() => null) : Promise.resolve(null),
        parsed.employeeCode ? vmm.lookupEmployee(parsed.employeeCode).catch(() => null) : Promise.resolve(null),
      ]);

      const store    = storeRes?.store    || {};
      const employee = empRes?.employee   || {};
      const product  = products.find(p =>
        p.name.toLowerCase() === (parsedEdits.productName || '').toLowerCase()
      ) || findBestByText(products, parsedEdits.productName || parsed.productName || '', ['name']) || {
        name:   parsedEdits.productName || parsed.productName || '',
        vendor: parsedEdits.vendorName  || '',
      };
      const nature = natures.find(n =>
        n.nature.toLowerCase() === (parsedEdits.natureOfProblem || '').toLowerCase()
      ) || { nature: parsedEdits.natureOfProblem || '', type: parsedEdits.complaintType || 'Repair', tatDays: 7 };
      const driveAttachments = (attachmentData || []).filter(a => a.viewLink);
      const attachmentText = driveAttachments.length
        ? '\n\nAttachments:\n' + driveAttachments.map(a => `- ${a.name}: ${a.viewLink}`).join('\n')
        : '';
      const providedText = parsed.alreadyProvided && Object.keys(parsed.alreadyProvided).length
        ? '\n\nDetails provided:\n' + Object.entries(parsed.alreadyProvided).map(([k, v]) => `- ${camelToLabel(k)}: ${v}`).join('\n')
        : '';

      const payload = {
        storeCode,
        storeName:           store.name || parsed.storeName || '',
        city:                store.city || '',
        region:              store.region || '',
        state:               store.state || '',
        zone:                store.zone || '',
        storeEmail:          store.email || '',
        fmName:              store.fmName || employee.fmName || '',
        fmEmail:             store.fmEmail || '',
        fmMobile:            store.fmMobile || '',
        managerName:         store.managerName || employee.managerName || '',
        managerMobile:       store.managerMobile || '',
        asmName:             store.asmName || employee.asmName || '',
        asmMobile:           store.asmMobile || '',
        employeeCode:        parsed.employeeCode || employee.code || '',
        employeeName:        parsed.employeeName || employee.name || '',
        contactNumber:       parsed.contactNumber || employee.mobile || '',
        designation:         employee.designation || '',
        productName:         product.name    || parsedEdits.productName    || parsed.productName    || '',
        vendorName:          parsedEdits.vendorName  || product.vendor || '',
        productType:         product.category || '',
        natureOfComplaint:   nature.nature   || parsedEdits.natureOfProblem || parsed.natureOfProblem || '',
        complaintType:       parsedEdits.complaintType || nature.type || 'Repair',
        tatDays:             nature.tatDays  || 7,
        productLocation:     parsed.productLocation || 'See email',
        remarks:             `${parsed.description || ''}${providedText}${attachmentText}`.trim(),
        source:              'E-mail',
        emailSubject:        selected.subject,
        callTxnId:           '',
        emailMessageId:      selected.id,
        emailConversationId: selected.conversationId || '',
        emailFrom:           selected.fromAddr || '',
        emailTo:             selected.toDisplay || '',
        attachmentLinks:     driveAttachments,
        uid: 1,
      };

      // Log one complaint per unit (e.g. 5 ACs = 5 separate complaint numbers)
      const qty = Math.max(1, Math.min(quantity, 20));
      const allResults = [];
      for (let i = 0; i < qty; i++) {
        const res = await vmm.logComplaint(payload);
        if (res.success) allResults.push(res);
        else { showToast(`Failed on complaint ${i + 1}: ${res.message || 'Unknown error'}`, 'err'); break; }
      }

      if (allResults.length === qty) {
        const nos = allResults.map(r => r.complaintno).join(', ');
        const confirmBody = qty > 1
          ? `Dear Store Team,\n\nYour complaints (${qty} units) have been registered successfully.\n\nComplaint Nos: ${nos}\nProduct: ${payload.productName}\nExpected Closure: ${allResults[0].edcDate}\n\nOur team will follow up within the expected closure date.\n\nRegards,\nOpen Mind Services`
          : `Dear Store Team,\n\nYour complaint has been registered successfully.\n\nComplaint No: ${allResults[0].complaintno}\nProduct: ${payload.productName}\nExpected Closure: ${allResults[0].edcDate}\n\nOur team will follow up within the expected closure date.\n\nRegards,\nOpen Mind Services`;
        await vmm.sendEmailReply({ messageId: selected.id, body: confirmBody }).catch(() => {});
        // Send consolidated escalation email (one email for all units)
        vmm.sendEscalationEmail({
          storeEmail:  payload.storeEmail  || '',
          storeName:   payload.storeName   || '',
          storeCode:   payload.storeCode   || '',
          vendorName:  payload.vendorName  || '',
          productName: payload.productName || '',
          complaints:  allResults.map(r => ({
            complaintno:     r.complaintno,
            productLocation: payload.productLocation,
            edcDate:         r.edcDate,
            type:            'regular',
          })),
        }).catch(() => {});
        claimEmail(selected.id, 'release');
        tagEmail(selected.id, 'logged', `Logged • ${nos} • Agent ${agentId.slice(-4)}`);
        setWipList(prev => { const u = prev.filter(w => w.id !== selected.id); localStorage.setItem('vmm_wip_emails', JSON.stringify(u)); return u; });
        // Keep the email visible in the list with its logged tag (restore if it was previously in WIP)
        setEmails(prev => prev.find(e => e.id === selected.id) ? prev : [{ ...selected, hasStoreCode: !!selected.storeCode }, ...prev]);
        setLogSuccess({ results: allResults, payload });
        setSelected(null); setParsed(null); setReplyBody(''); setQuantity(1);
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

  const missingRequired = parsed ? (parsed.missingFromTemplate || []) : [];
  const productInList   = products.some(p => p.name.toLowerCase() === parsedEdits.productName.trim().toLowerCase());
  // Can log if: store code present + employee verified (if code was given). Missing template fields are advisory only.
  const storeOk    = !!(parsedEdits.storeCode || parsed?.storeCode || selected?.storeCode);
  const employeeOk = !parsed?.employeeCode || empLookupStatus === 'found';
  const canLog     = parsed && storeOk && employeeOk;

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

  return (
    <div className="ec-page">
      {toast && <div className={`ec-toast ec-toast-${toast.type}`}>{toast.msg}</div>}

      {/* Confirmation modal */}
      {confirmModal && (
        <div className="ec-confirm-overlay" onClick={() => setConfirmModal(false)}>
          <div className="ec-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="ec-confirm-title">Confirm before logging</div>
            <div className="ec-confirm-subtitle">Please verify all details are correct:</div>
            <div className="ec-confirm-grid">
              {[
                { label: 'Store Code',        val: parsedEdits.storeCode || parsed?.storeCode || selected?.storeCode, req: true  },
                { label: 'Employee Code',     val: parsed?.employeeCode,                     req: false },
                { label: 'Employee Name',     val: resolvedEmpName || parsed?.employeeName,  req: false },
                { label: 'Contact Number',    val: parsed?.contactNumber,                    req: false },
                { label: 'Product',           val: parsedEdits.productName || parsed?.productName, req: true  },
                { label: 'Vendor',            val: parsedEdits.vendorName,                   req: false },
                { label: 'Nature of Problem', val: parsedEdits.natureOfProblem || parsed?.natureOfProblem, req: true  },
                { label: 'Number of Units',   val: quantity,                                 req: true  },
              ].map(({ label, val, req }) => (
                <div key={label} className={`ec-confirm-row${!val && req ? ' warn' : ''}`}>
                  <span className="ec-confirm-label">{label}</span>
                  <span className={`ec-confirm-val${!val ? ' empty' : ''}`}>{val || (req ? '⚠ Missing' : '—')}</span>
                </div>
              ))}
            </div>
            <div className="ec-confirm-actions">
              <button className="ec-confirm-cancel" onClick={() => setConfirmModal(false)}>Go Back &amp; Edit</button>
              <button className="ec-confirm-ok" onClick={() => { setConfirmModal(false); logComplaint(); }}>
                {quantity > 1 ? `Confirm — Log ${quantity} Complaints` : 'Confirm — Log Complaint'}
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
              {activeTab === 'inbox' && emails.length > 0 && (
                <span className="ec-tab-count">{emails.length}</span>
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
          </div>
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
              {activeTab === 'sent' ? '↑ Sent Items' : '✉ Inbox'}
            </span>
            {fetching
              ? <span className="ec-loading-dot">Loading…</span>
              : emails.length > 0 && (
                  <span className="ec-count">{emails.length} {activeTab === 'sent' ? 'emails' : 'unread'}</span>
                )
            }
          </div>

          {/* Tag filter bar */}
          {(wipList.length > 0 || emails.some(e => emailTags[e.id]?.type === 'logged')) && (
            <div className="ec-tag-filter-bar">
              <button className={`ec-tag-filter-btn ${tagFilter === null ? 'active' : ''}`} onClick={() => setTagFilter(null)}>All</button>
              {wipList.length > 0 && (
                <button className={`ec-tag-filter-btn wip ${tagFilter === 'wip' ? 'active' : ''}`} onClick={() => setTagFilter(tagFilter === 'wip' ? null : 'wip')}>
                  WIP<span className="ec-filter-count">{wipList.length}</span>
                </button>
              )}
              {emails.some(e => emailTags[e.id]?.type === 'logged') && (
                <button className={`ec-tag-filter-btn logged ${tagFilter === 'logged' ? 'active' : ''}`} onClick={() => setTagFilter(tagFilter === 'logged' ? null : 'logged')}>
                  Logged<span className="ec-filter-count">{emails.filter(e => emailTags[e.id]?.type === 'logged').length}</span>
                </button>
              )}
            </div>
          )}

          <div className="ec-email-list">
            {tagFilter !== 'logged' && wipList.length > 0 && (
              <div className="ec-section-label">WIP — Awaiting Reply</div>
            )}
            {tagFilter !== 'logged' && wipList.map(w => (
              <div key={w.id} className={`ec-email-row wip ${selected?.id === w.id ? 'active' : ''}`}
                onClick={() => selectEmail({ ...w, body: '' })}>
                <div className="ec-email-store">
                  {w.storeCode ? <span className="ec-store-code">{w.storeCode}</span> : '?'}
                  <span className="ec-wip-tag">WIP</span>
                  {w.savedBy && <span className="ec-wip-agent-tag">{w.savedBy}</span>}
                  <span className="ec-email-time">{fmtTime(w.repliedAt)}</span>
                  <button
                    className="ec-wip-dismiss-x"
                    title="Dismiss WIP — removes this WIP entry. Only do this if the case is resolved or no longer needed."
                    onClick={e => {
                      e.stopPropagation();
                      if (!window.confirm(`Dismiss WIP for "${w.subject}"?\n\nThis will remove the saved partial data. Only confirm if this case is no longer pending.`)) return;
                      setWipList(prev => { const u = prev.filter(x => x.id !== w.id); localStorage.setItem('vmm_wip_emails', JSON.stringify(u)); return u; });
                      if (selected?.id === w.id) { setSelected(null); setParsed(null); }
                      showToast('WIP dismissed', 'info');
                    }}
                  >×</button>
                </div>
                <div className="ec-email-subject">{w.subject}</div>
                <div className="ec-email-meta ec-wip-meta">
                  {w.parsed?.employeeCode && <span className="ec-wip-detail">Emp: {w.parsed.employeeCode}</span>}
                  {w.parsed?.productName  && <span className="ec-wip-detail">{w.parsed.productName}</span>}
                  {!w.parsed?.employeeCode && !w.parsed?.productName && (
                    <span>{w.fromAddr}</span>
                  )}
                  {(w.parsed?.missingFromTemplate || []).length > 0 && (
                    <span className="ec-wip-missing">Missing: {(w.parsed.missingFromTemplate).slice(0, 2).map(f => camelToLabel(f)).join(', ')}{w.parsed.missingFromTemplate.length > 2 ? ` +${w.parsed.missingFromTemplate.length - 2}` : ''}</span>
                  )}
                </div>
              </div>
            ))}

            {tagFilter !== 'wip' && emails.length > 0 && (() => {
              const filtered = tagFilter === 'logged' ? emails.filter(e => emailTags[e.id]?.type === 'logged') : emails;
              return filtered.length > 0 ? (
                <div className="ec-section-label">
                  {tagFilter === 'logged' ? `Logged (${filtered.length})` : activeTab === 'sent' ? `Sent Items (${filtered.length})` : `Unread Inbox (${filtered.length})`}
                </div>
              ) : null;
            })()}
            {emails.length === 0 && wipList.length === 0 && (
              <div className="ec-empty">
                Click "Fetch {activeTab === 'sent' ? 'Sent' : 'Inbox'}" to load emails from VMM2.
              </div>
            )}
            {tagFilter !== 'wip' && (tagFilter === 'logged' ? emails.filter(e => emailTags[e.id]?.type === 'logged') : emails).map(e => {
              const typeLabel = e.emailType === 'complaint-reply' ? { label: `#${e.complaintId}`, cls: 'ec-complaint-badge' }
                : e.emailType === 'new-complaint'    ? { label: 'New', cls: 'ec-new-badge' }
                : { label: 'Other', cls: 'ec-reply-badge' };
              const claim          = activeClaims[e.id];
              const claimedByOther = claim && claim.agentId !== agentId;
              const tag            = emailTags[e.id];
              return (
                <div key={e.id} className={`ec-email-row ${selected?.id === e.id ? 'active' : ''} ${!e.hasStoreCode ? 'no-store' : ''} ${claimedByOther ? 'claimed' : ''} ${tag ? `tagged-${tag.type}` : ''}`}
                  onClick={() => selectEmail(e)}>
                  <div className="ec-email-store">
                    {e.storeCode
                      ? <span className="ec-store-code">{e.storeCode}</span>
                      : <span className="ec-unknown">? Unknown</span>}
                    <span className={typeLabel.cls}>{typeLabel.label}</span>
                    {claimedByOther && <span className="ec-in-use-tag" title={`${claim.agentLabel} is working on this`}>In use</span>}
                    <span className="ec-email-time">{fmtTime(e.receivedAt)}</span>
                  </div>
                  <div className="ec-email-subject">
                    {e.hasAttachments && <span className="ec-attach-icon" title="Has attachments">📎</span>}
                    {e.subject}
                  </div>
                  {tag && (
                    <div className={`ec-email-tag-row ec-etag-${tag.type}`}>
                      {tag.type === 'logged'      && <span className="ec-etag-icon">✓</span>}
                      {tag.type === 'updated'     && <span className="ec-etag-icon">↻</span>}
                      {tag.type === 'nonrelevant' && <span className="ec-etag-icon">✕</span>}
                      <span className="ec-etag-label">{tag.label}</span>
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
                <div className="ec-email-header-subject">{selected.subject}</div>
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
                  w.subject === selected.subject ||
                  w.id === selected.id ||
                  (selected.complaintId && w.subject?.includes(selected.complaintId))
                );
                const detectedId = selected.complaintId || (wipMatch?.complaintNo) || '';

                return (
                  <>
                    {/* WIP Match Notice */}
                    {wipMatch && (
                      <div className="ec-wip-match">
                        <span className="ec-wip-match-icon">WIP</span>
                        <span>This email thread has a pending WIP case — reply was sent earlier awaiting store response.</span>
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
                          setActiveAction(activeAction === 'update-case' ? null : 'update-case');
                          setUpdateForm(f => ({ ...f, complaintId: detectedId }));
                        }}
                      >
                        ↻ Update a Case
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
                  <div className="ec-update-title">Log Activity on Existing Complaint</div>
                  <div className="ec-update-row">
                    <label>Complaint Number</label>
                    <input
                      type="text"
                      placeholder="e.g. 26052317667 or EL-26042916099"
                      value={updateForm.complaintId}
                      onChange={e => setUpdateForm(f => ({ ...f, complaintId: e.target.value }))}
                    />
                  </div>
                  <div className="ec-update-row">
                    <label>Remarks / Update</label>
                    <textarea
                      rows={3}
                      placeholder="Summarise the update from this email…"
                      value={updateForm.remarks}
                      onChange={e => setUpdateForm(f => ({ ...f, remarks: e.target.value }))}
                    />
                  </div>
                  <div className="ec-update-row-2">
                    <div>
                      <label>Status</label>
                      <select value={updateForm.newStatus} onChange={e => setUpdateForm(f => ({ ...f, newStatus: e.target.value }))}>
                        <option value="">— No change —</option>
                        <option>Open</option>
                        <option>Escalated</option>
                        <option>Not Connected</option>
                        <option>Partially Closed</option>
                        <option>Closed</option>
                      </select>
                    </div>
                    <div>
                      <label>New EDC (optional)</label>
                      <input
                        type="date"
                        value={updateForm.newEdc}
                        onChange={e => setUpdateForm(f => ({ ...f, newEdc: e.target.value }))}
                      />
                    </div>
                  </div>
                  <button
                    className="ec-submit-update-btn"
                    disabled={loggingActivity || !updateForm.complaintId.trim()}
                    onClick={async () => {
                      setLoggingActivity(true);
                      try {
                        const res = await vmm.logEmailActivity({
                          complaintNo: updateForm.complaintId.trim(),
                          remarks:     updateForm.remarks,
                          newStatus:   updateForm.newStatus,
                          newEdc:      updateForm.newEdc,
                          uid:         1,
                        });
                        if (res.found) {
                          tagEmail(selected.id, 'updated', `Updated • ${updateForm.complaintId.trim()}`);
                          showToast(`Activity logged on ${updateForm.complaintId}`, 'ok');
                          setActiveAction(null);
                          setUpdateForm({ complaintId: '', remarks: '', newStatus: '', newEdc: '' });
                        } else {
                          showToast(res.message || 'Complaint not found', 'err');
                        }
                      } catch { showToast('Could not log activity', 'err'); }
                      finally { setLoggingActivity(false); }
                    }}
                  >
                    {loggingActivity ? 'Saving…' : 'Save Activity Log'}
                  </button>
                </div>
              )}

              {/* Email Body */}
              {selected.body && (
                <div
                  className="ec-email-body"
                  dangerouslySetInnerHTML={{
                    __html: selected.body
                      .replace(/<script[\s\S]*?<\/script>/gi, '')
                      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
                      .replace(/<object[\s\S]*?<\/object>/gi, '')
                      .replace(/on\w+="[^"]*"/gi, '')
                      .replace(/on\w+='[^']*'/gi, '')
                  }}
                />
              )}

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
                          If a follow-up email arrived with the missing info, open that email, parse it, and log from there.
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

                  {/* Standard fields */}
                  <div className="ec-fields-grid">
                    {Object.entries(FIELD_LABELS).map(([key, label]) => {
                      // Employee Name — show lookup status, not raw AI value
                      if (key === 'employeeName') {
                        const STATUS = {
                          idle:        { cls: 'missing',     val: '—' },
                          loading:     { cls: 'missing',     val: 'Looking up…' },
                          found:       { cls: 'filled',      val: resolvedEmpName },
                          'not-found': { cls: 'missing-req', val: '⚠ Employee code not found in system' },
                        };
                        const s = STATUS[empLookupStatus] || STATUS.idle;
                        return (
                          <div key={key} className={`ec-field ${s.cls}`}>
                            <span className="ec-field-label">Employee Name</span>
                            <span className="ec-field-val">{s.val}</span>
                          </div>
                        );
                      }
                      // Product — searchable dropdown from real list
                      if (key === 'productName') {
                        return (
                          <div key={key} className={`ec-field ${productInList ? 'filled' : 'missing-req'}`}>
                            <span className="ec-field-label">Product Name<span className="req"> *</span></span>
                            <SearchableSelect
                              options={products}
                              value={parsedEdits.productName}
                              placeholder="Search product…"
                              getLabel={p => p.name}
                              getSub={p => p.vendor || ''}
                              onChange={p => setParsedEdits(prev => ({ ...prev, productName: p.name, vendorName: p.vendor || prev.vendorName }))}
                            />
                            {parsedEdits.productName && !productInList && (
                              <span style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>⚠ Not in product list</span>
                            )}
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
                      // All other fields
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
                    {/* Vendor — auto-filled from selected product, but editable in case it's wrong */}
                    <div className={`ec-field ${parsedEdits.vendorName ? 'filled' : 'missing'}`}>
                      <span className="ec-field-label">Vendor</span>
                      <input
                        className="ec-field-input"
                        placeholder="Enter vendor name…"
                        value={parsedEdits.vendorName}
                        onChange={e => setParsedEdits(prev => ({ ...prev, vendorName: e.target.value }))}
                      />
                    </div>
                    {/* Nature of Problem — searchable fixed list */}
                    {(() => {
                      const natureInList = natures.some(n => n.nature === parsedEdits.natureOfProblem);
                      return (
                        <div className={`ec-field ${natureInList ? 'filled' : 'missing-req'}`}>
                          <span className="ec-field-label">Nature of Problem<span className="req"> *</span></span>
                          <SearchableSelect
                            options={natures}
                            value={parsedEdits.natureOfProblem}
                            placeholder="Search nature…"
                            getLabel={n => n.nature}
                            getSub={n => `${n.type} · ${n.tatDays}d TAT`}
                            onChange={n => setParsedEdits(prev => ({ ...prev, natureOfProblem: n.nature, complaintType: n.type }))}
                          />
                        </div>
                      );
                    })()}
                    {/* Complaint Type — auto from nature */}
                    {parsedEdits.complaintType && (
                      <div className="ec-field filled">
                        <span className="ec-field-label">Complaint Type</span>
                        <span className="ec-field-val">{parsedEdits.complaintType}</span>
                      </div>
                    )}
                    {/* Number of Units — editable, sits in the grid like other fields */}
                    <div className="ec-field filled">
                      <span className="ec-field-label">Number of Units</span>
                      <input
                        type="number"
                        className="ec-field-qty-input"
                        min={1} max={20}
                        value={quantity}
                        onChange={e => setQuantity(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                      />
                    </div>
                  </div>

                  {/* Product-specific fields */}
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
                    {canLog && (
                      <button className="ec-log-btn" onClick={() => setConfirmModal(true)} disabled={logging}>
                        {logging ? 'Logging…' : quantity > 1 ? `✓ Log ${quantity} Complaints` : '✓ Log Complaint'}
                      </button>
                    )}
                    <button
                      className={`ec-ask-info-btn ${showReplyEditor ? 'active' : ''}`}
                      onClick={openReplyEditor}
                    >
                      ✉ {showReplyEditor ? 'Edit Reply' : 'Ask for Missing Info'}
                    </button>
                  </div>

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
                  <button className="ec-send-btn" onClick={sendReply} disabled={sending || !replyBody.trim()}>
                    {sending ? 'Sending…' : '✉ Send Reply & Save as WIP'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
