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

const HO_EMAIL = 'ho.vmm@openmind.in';

// Products where an external vendor handles AMC & Warranty (auto-lookup for AMC, user picks for Warranty)
const AMC_WARRANTY_PRODUCTS = new Set(['ac','server room ac','air curtain','electrical panel','fly catcher','genset','led light','lift','servo','track light']);
// Products where vendor handles AMC only (user picks vendor; Warranty = FM/HO)
const AMC_ONLY_PRODUCTS     = new Set(['civil work','weighing scale','pest control','shampoo dispenser machine','safe lock','sensormatic']);
// Everything else → FM / HO Team (no external vendor)

const REQUIRED_FIELDS = ['storeCode', 'productName', 'natureOfProblem', 'description'];
const FIELD_LABELS = {
  storeCode: 'Store Code', employeeCode: 'Employee Code', employeeName: 'Employee Name',
  contactNumber: 'Contact Number', productName: 'Product Name',
  productLocation: 'Product Location', description: 'Description',
};

// onFreeText fires on blur/Enter when the user typed a custom value (not picked from list)
function SearchableSelect({ options, value, onChange, placeholder, getLabel, getSub, onFreeText }) {
  const [query,   setQuery]   = useState(value || '');
  const [open,    setOpen]    = useState(false);
  const pickedRef = useRef(false);
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

  const commitFreeText = () => {
    if (onFreeText && !pickedRef.current) onFreeText(query.trim());
    pickedRef.current = false;
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        type="text"
        className="ec-field-input"
        placeholder={placeholder}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); pickedRef.current = false; }}
        onFocus={() => setOpen(true)}
        onBlur={commitFreeText}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter') { e.preventDefault(); commitFreeText(); } }}
      />
      {open && filtered.length > 0 && (
        <div className="ec-picker-dropdown">
          {filtered.slice(0, 25).map((item, i) => (
            <div key={i} className="ec-picker-option"
              onMouseDown={() => { pickedRef.current = true; onChange(item); setQuery(getLabel(item)); setOpen(false); }}>
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
  const [activeTab,    setActiveTab]    = useState('inbox'); // 'inbox' | 'sent'
  const [inboxEmails,  setInboxEmails]  = useState(() => {
    try { const c = sessionStorage.getItem('vmm_inbox_list'); return c ? JSON.parse(c) : []; } catch { return []; }
  });
  const [sentEmails,   setSentEmails]   = useState([]);
  const emails = activeTab === 'sent' ? sentEmails : inboxEmails;
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
  const [updateForm,      setUpdateForm]      = useState({ complaintId: '', remarks: '', newStatus: '', newEdc: '', escalationLevel: '', reasonForDelay: '' });
  const [updateAction,    setUpdateAction]    = useState(null); // 'escalate' | 'close' | 'update'
  const [searchingComplaint, setSearchingComplaint] = useState(false);
  const [foundComplaint,     setFoundComplaint]     = useState(null); // complaint data from system
  const [attachmentData,  setAttachmentData]  = useState(null);
  const [loadingAttach,   setLoadingAttach]   = useState(false);
  const [wipList,   setWipList]   = useState([]);
  const [templates,    setTemplates]    = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [products,     setProducts]     = useState([]);  // raw rows: each row = { name, vendor, category, hoName, hoEmail, vendorEmail }
  const [natures,      setNatures]      = useState([]);
  const [parsedEdits,  setParsedEdits]  = useState({ storeCode: '', productName: '', vendorName: '', natureOfProblem: '', complaintType: '', employeeCode: '', contactNumber: '', productLocation: '', description: '' });
  const [replyTo,         setReplyTo]         = useState([]);
  const [replyCc,         setReplyCc]         = useState([]);
  const [toInput,         setToInput]         = useState('');
  const [ccInput,         setCcInput]         = useState('');
  const [empLookupStatus, setEmpLookupStatus] = useState('idle'); // idle|loading|found|not-found
  const [resolvedEmpName, setResolvedEmpName] = useState('');
  const [showReplyEditor, setShowReplyEditor] = useState(false);
  const [quantity,        setQuantity]        = useState(1);
  const [contractType,    setContractType]    = useState('');   // 'AMC' | 'Warranty' | 'NotApplicable'
  const [vendorEmail,     setVendorEmail]     = useState('');   // For Warranty/NotApplicable — agent-entered vendor email (To)
  const [amcLookup,       setAmcLookup]       = useState('idle'); // 'idle' | 'loading' | 'found' | 'not-found'
  const [emTab,           setEmTab]           = useState('form');  // 'form' | 'matrix'
  const [escalationMatrix, setEscalationMatrix] = useState([]);
  const [emLoading,       setEmLoading]       = useState(false);
  const [emSearch,        setEmSearch]        = useState('');
  const [emRegion,        setEmRegion]        = useState('');
  const [emLevel,         setEmLevel]         = useState('');
  const [confirmModal,    setConfirmModal]    = useState(false);
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
    vmm.getNatures().then(r => setNatures(r.natures || [])).catch(() => {});
    vmm.getOpenWips().then(res => setWipList(res.wips || [])).catch(() => {});
    fetchEmails('inbox');
  }, []); // eslint-disable-line

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(''), 3500);
  };

  const tagEmail = (id, type, label) => {
    const updated = { ...JSON.parse(localStorage.getItem('vmm_email_tags') || '{}'), [id]: { type, label, time: new Date().toISOString() } };
    localStorage.setItem('vmm_email_tags', JSON.stringify(updated));
    setEmailTags(updated);
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
        msgs.forEach(m => (m.cc || '').split(',').map(c => c.trim()).filter(Boolean).forEach(cc => {
          if (cc.toLowerCase() !== OWN && cc.toLowerCase() !== (originalFrom || '').toLowerCase()) allCCs.add(cc);
        }));
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
        msgs.forEach(m => (m.cc || []).forEach(cc => {
          if (cc && cc.toLowerCase() !== OWN && cc.toLowerCase() !== (originalFrom || '').toLowerCase()) allCCs.add(cc);
        }));
        setReplyCc([...allCCs]);
      })
      .catch(() => setThreadMessages([]))
      .finally(() => setThreadLoading(false));
  }, [selected?.conversationId]); // eslint-disable-line

  // Re-run employee lookup whenever the employee code field is edited
  useEffect(() => {
    if (!parsed) return;
    const code = (parsedEdits.employeeCode || '').trim().toUpperCase();
    if (!code) { setEmpLookupStatus('idle'); setResolvedEmpName(''); return; }
    setEmpLookupStatus('loading');
    const t = setTimeout(async () => {
      try {
        const empRes = await vmm.lookupEmployee(code);
        if (empRes.found && empRes.employee?.name) {
          setResolvedEmpName(empRes.employee.name);
          setEmpLookupStatus('found');
          if (!parsedEdits.contactNumber && empRes.employee.mobile)
            setParsedEdits(prev => ({ ...prev, contactNumber: empRes.employee.mobile }));
        } else { setResolvedEmpName(''); setEmpLookupStatus('not-found'); }
      } catch { setResolvedEmpName(''); setEmpLookupStatus('not-found'); }
    }, 600);
    return () => clearTimeout(t);
  }, [parsedEdits.employeeCode]); // eslint-disable-line

  // AMC vendor lookup — fires when contractType switches to AMC and product + store are known
  useEffect(() => {
    if (contractType !== 'AMC' || !parsed) { return; }
    const storeCode   = parsedEdits.storeCode || parsed?.storeCode || selected?.storeCode || '';
    const productName = parsedEdits.productName || '';
    if (!storeCode || !productName) return;
    setAmcLookup('loading');
    vmm.getAmcVendor(storeCode, productName)
      .then(res => {
        if (res.found) {
          setParsedEdits(prev => ({ ...prev, vendorName: res.vendor }));
          setAmcLookup('found');
        } else {
          setAmcLookup('not-found');
        }
      })
      .catch(() => setAmcLookup('not-found'));
  }, [contractType]); // eslint-disable-line

  const switchTab = (tab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setSelected(null);
    setParsed(null);
    if (tab === 'sent') fetchEmails('sent');
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
    setUpdateForm({ complaintId: email.complaintId || '', remarks: '', newStatus: '', newEdc: '', escalationLevel: '', reasonForDelay: '' }); setUpdateAction(null); setFoundComplaint(null); setRecentCases([]); setLoadingRecent(false);
    // Restore cached attachments so the Load button doesn't reappear after refresh
    const cached = email.id ? localStorage.getItem(`vmm_attach_${email.id}`) : null;
    setAttachmentData(cached ? JSON.parse(cached) : null);
    // Default reply-to = sender; CC pre-filled from original email
    setReplyTo(email.fromAddr ? [email.fromAddr] : []);
    setReplyCc(Array.isArray(email.cc) ? email.cc.filter(Boolean) : []);
    setToInput('');
    setCcInput('');
    setShowReplyEditor(false);
    setQuantity(1);
    setContractType('');
    setVendorEmail('');
    setAmcLookup('idle');
    setEmTab('form');
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
        productName:     matchedProduct?.name   || p.productName     || '',
        vendorName:      p.vendorName      || '',
        natureOfProblem: matchedNature?.nature  || p.natureOfProblem || '',
        complaintType:   matchedNature?.type    || p.complaintType   || '',
        employeeCode:    p.employeeCode    || '',
        contactNumber:   p.contactNumber   || '',
        productLocation: p.productLocation || '',
        description:     p.description     || '',
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
      setParsedEdits({ storeCode: email.storeCode || '', productName: '', vendorName: '', natureOfProblem: '', complaintType: '', employeeCode: '', contactNumber: '', productLocation: '', description: '' });
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
      // If direct body is empty (e.g. WIP sidebar click), build from thread messages
      const threadBodyText = threadMessages.length > 0
        ? threadMessages.map(m => `[From: ${m.fromName || m.from}]\n${m.body}`).join('\n\n---\n\n')
        : '';
      const emailBody = selected.body || threadBodyText;

      const res = await vmm.parseEmail({
        fromEmail:  selected.fromAddr,
        subject:    selected.subject,
        emailBody,
        storeCode:  selected.storeCode,
        templates,
        natures:    natures.map(n => ({ nature: n.nature, type: n.type })),
        // Unique product names so AI picks from the real list (e.g. "Server room AC" → "AC")
        productNames: [...new Set(products.map(p => p.name))],
        // Pass currently confirmed values — backend will not overwrite these
        // Employee code is only locked if it passes format validation (VMM+3 digits OR 5-7 digits)
        lockedFields: parsedEdits ? {
          storeCode:       parsedEdits.storeCode       || '',
          employeeCode:    (/^VMM\d{3}$|^\d{5,7}$/.test(parsedEdits.employeeCode || '')) ? parsedEdits.employeeCode : '',
          employeeName:    parsedEdits.employeeName     || '',
          contactNumber:   parsedEdits.contactNumber    || '',
          productLocation: parsedEdits.productLocation  || '',
          productName:     parsedEdits.productName      || '',
          natureOfProblem: parsedEdits.natureOfProblem  || '',
          description:     parsedEdits.description      || '',
        } : {},
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
      setParsedEdits(prev => ({
        storeCode:       res.storeCode       || selected?.storeCode    || prev?.storeCode       || '',
        productName:     matchedProduct?.name || res.productName       || prev?.productName     || '',
        vendorName:      res.vendorName      || prev?.vendorName      || '',
        natureOfProblem: matchedNature?.nature  || res.natureOfProblem || prev?.natureOfProblem || '',
        complaintType:   matchedNature?.type    || res.complaintType   || prev?.complaintType   || '',
        employeeCode:    res.employeeCode    || prev?.employeeCode    || '',
        contactNumber:   res.contactNumber   || prev?.contactNumber   || '',
        productLocation: res.productLocation || prev?.productLocation || '',
        description:     res.description     || prev?.description     || '',
      }));
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

  const logComplaint = async () => {
    if (!parsed) return;
    if (selected.hasAttachments && !attachmentData) {
      showToast('Please load & save attachments to Drive before logging', 'err');
      return;
    }
    setLogging(true);
    try {
      const storeCode = parsedEdits.storeCode || parsed.storeCode || selected.storeCode || '';
      const empCode = parsedEdits.employeeCode || parsed.employeeCode || '';
      const [storeRes, empRes] = await Promise.all([
        storeCode ? vmm.lookupStore(storeCode).catch(() => null) : Promise.resolve(null),
        empCode ? vmm.lookupEmployee(empCode).catch(() => null) : Promise.resolve(null),
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
        smEmail:             store.smEmail || store.email || '',
        fmName:              store.fmName || employee.fmName || '',
        fmEmail:             store.fmEmail || '',
        fmMobile:            store.fmMobile || '',
        managerName:         store.managerName || employee.managerName || '',
        managerMobile:       store.managerMobile || '',
        asmName:             store.asmName || employee.asmName || '',
        asmMobile:           store.asmMobile || '',
        employeeCode:        parsedEdits.employeeCode || parsed.employeeCode || employee.code || '',
        employeeName:        resolvedEmpName || parsed.employeeName || employee.name || '',
        contactNumber:       parsedEdits.contactNumber || parsed.contactNumber || employee.mobile || '',
        designation:         employee.designation || '',
        productName:         product.name    || parsedEdits.productName    || parsed.productName    || '',
        vendorName:          parsedEdits.vendorName  || product.vendor || '',
        productType:         product.category || '',
        natureOfComplaint:   nature.nature   || parsedEdits.natureOfProblem || parsed.natureOfProblem || '',
        complaintType:       parsedEdits.complaintType || nature.type || 'Repair',
        contractType:        contractType || '',
        tatDays:             nature.tatDays  || 7,
        productLocation:     parsedEdits.productLocation || parsed.productLocation || 'See email',
        remarks:             `${parsedEdits.description || parsed.description || ''}${providedText}${attachmentText}`.trim(),
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

      // AC: always 1 complaint per store regardless of unit count; other products: one per unit
      const isACProduct = /\bac\b|air.?cond/i.test((parsedEdits.productName || '').toLowerCase());
      const qty = isACProduct ? 1 : Math.max(1, Math.min(quantity, 20));
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
        const confirmHtml = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7">'
          + confirmBody.split('\n').map(l => l.trim() ? `<p style="margin:0 0 8px">${l}</p>` : '<br/>').join('')
          + '<hr style="margin:16px 0;border:none;border-top:1px solid #e2e8f0"/>'
          + '<p style="font-size:11px;color:#64748b">Open Mind Services Limited — VMM CRM</p></div>';
        const OWN = 'vmm.helpdesk@openmind.in';
        const threadCCs = [...new Set(threadMessages.flatMap(m => m.cc || []).filter(cc => cc && cc.toLowerCase() !== OWN))].join(';');
        // Reply to latest message in thread, not the originally selected one
        const sortedMsgs = [...threadMessages].sort((a, b) => new Date(b.receivedDateTime) - new Date(a.receivedDateTime));
        const replyMsgId = sortedMsgs[0]?.id || selected.id;
        await vmm.sendEmailReply({ messageId: replyMsgId, htmlBody: confirmHtml, body: confirmBody, ccRecipients: threadCCs }).catch(() => {});
        // Tag the reply email and original WIP email as Case Logged
        vmm.categorizeEmail(replyMsgId, ['Case Logged', 'New CRM']).catch(() => {});
        // Find WIP by direct id match or conversationId match
        const wipMatch = wipList.find(w =>
          w.id === selected.id ||
          (w.conversationId && selected.conversationId && w.conversationId === selected.conversationId)
        );
        const wipIdToResolve = wipMatch?.id || selected.id;
        if (wipMatch && wipMatch.id !== replyMsgId) {
          vmm.categorizeEmail(wipMatch.id, ['Case Logged', 'New CRM']).catch(() => {});
        }
        // Send consolidated escalation email (one email for all units)
        vmm.sendEscalationEmail({
          escalationType:    isFMProduct ? 'fm' : 'vendor',
          storeCode:         payload.storeCode   || '',
          storeName:         payload.storeName   || '',
          smEmail:           payload.smEmail     || payload.storeEmail || '',
          fmEmail:           payload.fmEmail     || '',
          hoEmail:           hoEmailForProduct,
          vendorEmail:       vendorEmail         || '',
          vendorName:        payload.vendorName  || '',
          productName:       payload.productName || '',
          contractType:      contractType        || '',
          complaints: allResults.map(r => ({
            complaintno:     r.complaintno,
            productLocation: payload.productLocation,
            natureOfProblem: parsedEdits.natureOfProblem || '',
            edcDate:         r.edcDate,
          })),
        }).catch(() => {});
        claimEmail(selected.id, 'release');
        tagEmail(selected.id, 'logged', `Logged • ${nos} • Agent ${agentId.slice(-4)}`);
        setWipList(prev => prev.filter(w =>
          w.id !== wipIdToResolve &&
          !(selected.conversationId && w.conversationId && w.conversationId === selected.conversationId)
        ));
        vmm.resolveWip(wipIdToResolve).catch(() => {});
        // Keep the email visible in the list with its logged tag (restore if it was previously in WIP)
        setInboxEmails(prev => prev.find(e => e.id === selected.id) ? prev : [{ ...selected, hasStoreCode: !!selected.storeCode }, ...prev]);
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
  const isAC = /\bac\b|air.?cond/i.test(parsedEdits.productName || '');

  // Unique product names for dropdown (each row is product+vendor pair, deduplicate by name)
  const uniqueProducts = [...new Map(products.map(p => [p.name.toLowerCase(), p])).values()];

  // Vendors for the selected product — each products row where name matches = one vendor option
  const filteredVendors = (() => {
    const selProd = (parsedEdits.productName || '').toLowerCase().trim();
    if (!selProd || !products.length) return [];
    const exact = products.filter(p => p.name.toLowerCase() === selProd);
    if (exact.length > 0) return exact.map(p => ({ name: p.vendor, email: p.vendorEmail || '' }));
    // Fuzzy fallback: partial match (removes duplicates by vendor name)
    const fuzzy = products.filter(p => p.name.toLowerCase().includes(selProd) || selProd.includes(p.name.toLowerCase()));
    return [...new Map(fuzzy.map(p => [p.vendor.toLowerCase(), { name: p.vendor, email: p.vendorEmail || '' }])).values()];
  })();

  // HO email from the sheet row for the selected product (falls back to hardcoded constant)
  const matchedProductRow = products.find(p => p.name.toLowerCase() === (parsedEdits.productName || '').toLowerCase());
  const hoEmailForProduct = matchedProductRow?.hoEmail || HO_EMAIL;

  // Derive vendor escalation type from product name
  const prodKey           = (parsedEdits.productName || '').toLowerCase().trim();
  const productVendorType = AMC_WARRANTY_PRODUCTS.has(prodKey) ? 'amc_warranty'
    : AMC_ONLY_PRODUCTS.has(prodKey) ? 'amc_only'
    : 'fm_ho';
  // Vendor section shown for AMC&Warranty (all contracts) + AMC-Only (AMC contract only)
  const showVendorSection = productVendorType === 'amc_warranty'
    || (productVendorType === 'amc_only' && contractType === 'AMC');
  // FM is the TO recipient when there is no vendor escalation
  const isFMProduct = !showVendorSection;
  const effectiveQty = isAC ? 1 : quantity;
  // Can log if: store code present + employee verified (if code was given). Missing template fields are advisory only.
  const storeOk      = !!(parsedEdits.storeCode || parsed?.storeCode || selected?.storeCode);
  const employeeOk   = !parsed?.employeeCode || empLookupStatus === 'found';
  const typeOk       = !!parsedEdits.complaintType;
  const contractOk   = !!contractType;
  const canLog       = parsed && storeOk && employeeOk && typeOk && contractOk;

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
            <div className="ec-confirm-title">Confirm before logging</div>
            <div className="ec-confirm-subtitle">Please verify all details are correct:</div>
            <div className="ec-confirm-grid">
              {[
                { label: 'Store Code',        val: parsedEdits.storeCode || parsed?.storeCode || selected?.storeCode, req: true  },
                { label: 'Employee Code',     val: parsedEdits.employeeCode || parsed?.employeeCode,  req: false },
                { label: 'Employee Name',     val: resolvedEmpName || parsed?.employeeName,            req: false },
                { label: 'Contact Number',    val: parsedEdits.contactNumber || parsed?.contactNumber, req: false },
                { label: 'Product',           val: parsedEdits.productName || parsed?.productName, req: true  },
                { label: 'Service Contract',  val: contractType === 'AMC' ? 'Under AMC' : contractType === 'Warranty' ? 'Under Warranty' : contractType === 'NotApplicable' ? 'Not Applicable' : '', req: true },
                { label: 'Vendor',             val: parsedEdits.vendorName, req: false },
                ...(vendorEmail ? [
                  { label: 'Escalation To',    val: vendorEmail, req: false },
                  { label: 'Escalation CC',    val: isFMProduct ? 'Store Manager + HO + FM' : 'Store Manager + HO', req: false },
                ] : []),
                { label: 'Nature of Problem', val: parsedEdits.natureOfProblem || parsed?.natureOfProblem, req: true  },
                ...(!isAC ? [{ label: 'Number of Units', val: quantity, req: true }] : []),
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
                {effectiveQty > 1 ? `Confirm — Log ${effectiveQty} Complaints` : 'Confirm — Log Complaint'}
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
              {activeTab === 'sent' ? '↑ Sent Items' : activeTab === 'wip' ? '⏳ WIP Cases' : '✉ Inbox'}
            </span>
            {activeTab === 'wip'
              ? <span className="ec-count">{wipList.length} pending</span>
              : fetching
                ? <span className="ec-loading-dot">Loading…</span>
                : emails.length > 0 && (
                    <span className="ec-count">{emails.length} {activeTab === 'sent' ? 'emails' : 'unread'}</span>
                  )
            }
          </div>

          {/* Search bar */}
          <div className="ec-search-bar">
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
          </div>

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

          {/* Tag filter bar — Logged only */}
          {!searchMode && emails.some(e => emailTags[e.id]?.type === 'logged') && (
            <div className="ec-tag-filter-bar">
              <button className={`ec-tag-filter-btn ${tagFilter === null ? 'active' : ''}`} onClick={() => setTagFilter(null)}>All</button>
              <button className={`ec-tag-filter-btn logged ${tagFilter === 'logged' ? 'active' : ''}`} onClick={() => setTagFilter(tagFilter === 'logged' ? null : 'logged')}>
                Logged<span className="ec-filter-count">{emails.filter(e => emailTags[e.id]?.type === 'logged').length}</span>
              </button>
            </div>
          )}


          <div className="ec-email-list">

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
              const filtered = tagFilter === 'logged' ? baseEmails.filter(e => emailTags[e.id]?.type === 'logged') : baseEmails;
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
            {activeTab !== 'wip' && tagFilter !== 'wip' && (tagFilter === 'logged' ? baseEmails.filter(e => emailTags[e.id]?.type === 'logged') : baseEmails).map(e => {
              const typeLabel = e.emailType === 'complaint-reply' ? { label: `#${e.complaintId}`, cls: 'ec-complaint-badge' }
                : e.emailType === 'new-complaint'    ? { label: 'New', cls: 'ec-new-badge' }
                : { label: 'Other', cls: 'ec-reply-badge' };
              const claim          = activeClaims[e.id];
              const claimedByOther = claim && claim.agentId !== agentId;
              const tag            = emailTags[e.id];
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
                          setUpdateForm(f => ({ ...f, complaintId: detectedId }));
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
                          onClick={() => setUpdateAction(updateAction === key ? null : key)}
                          style={{ ...style, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13, opacity: updateAction && updateAction !== key ? 0.45 : 1 }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Remarks — shown for all actions */}
                  {updateAction && (
                    <div className="ec-update-row">
                      <label>Remarks</label>
                      <textarea
                        rows={3}
                        placeholder="Summarise the update from this email…"
                        value={updateForm.remarks}
                        onChange={e => setUpdateForm(f => ({ ...f, remarks: e.target.value }))}
                      />
                    </div>
                  )}

                  {/* Escalate fields */}
                  {updateAction === 'escalate' && (
                    <div className="ec-update-row-2">
                      <div>
                        <label>Escalation Level</label>
                        <select value={updateForm.escalationLevel} onChange={e => setUpdateForm(f => ({ ...f, escalationLevel: e.target.value }))}>
                          <option value="">— Select —</option>
                          <option>Level 1</option>
                          <option>Level 2</option>
                          <option>Level 3</option>
                        </select>
                      </div>
                      <div>
                        <label>New EDC</label>
                        <input type="date" value={updateForm.newEdc} onChange={e => setUpdateForm(f => ({ ...f, newEdc: e.target.value }))} />
                      </div>
                      <div>
                        <label>Reason for Delay</label>
                        <select value={updateForm.reasonForDelay} onChange={e => setUpdateForm(f => ({ ...f, reasonForDelay: e.target.value }))}>
                          <option value="">— Select —</option>
                          <option>Delay From Vendor Side</option>
                          <option>Delay From HO Team</option>
                          <option>Delay From Store Side</option>
                          <option>Part Unavailable</option>
                          <option>Other</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Submit */}
                  {updateAction && (
                    <button
                      className="ec-submit-update-btn"
                      disabled={loggingActivity || !updateForm.complaintId.trim() || !updateForm.remarks.trim()}
                      onClick={async () => {
                        setLoggingActivity(true);
                        try {
                          const payload = {
                            complaintNo: updateForm.complaintId.trim(),
                            remarks:     updateForm.remarks,
                            uid:         1,
                          };
                          if (updateAction === 'escalate') {
                            payload.newStatus       = 'Escalated';
                            payload.newEdc          = updateForm.newEdc;
                            payload.escalationLevel = updateForm.escalationLevel;
                            payload.reasonForDelay  = updateForm.reasonForDelay;
                          } else if (updateAction === 'close') {
                            payload.newStatus = 'Closed';
                          }
                          const res = await vmm.logEmailActivity(payload);
                          if (res.found) {
                            tagEmail(selected.id, 'updated', `${updateAction === 'escalate' ? 'Escalated' : updateAction === 'close' ? 'Closed' : 'Updated'} • ${updateForm.complaintId.trim()}`);
                            showToast(`${updateAction === 'escalate' ? 'Escalated' : updateAction === 'close' ? 'Closed' : 'Updated'}: ${updateForm.complaintId.trim()}`, 'ok');
                            setActiveAction(null);
                            setUpdateForm({ complaintId: '', remarks: '', newStatus: '', newEdc: '', escalationLevel: '', reasonForDelay: '' }); setUpdateAction(null);
                          } else {
                            showToast(res.message || 'Complaint not found', 'err');
                          }
                        } catch { showToast('Could not log activity', 'err'); }
                        finally { setLoggingActivity(false); }
                      }}
                    >
                      {loggingActivity ? 'Saving…'
                        : updateAction === 'escalate' ? '↑ Escalate Complaint'
                        : updateAction === 'close'    ? '✓ Close Complaint'
                        : '✏ Save Update'}
                    </button>
                  )}
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
                              options={uniqueProducts}
                              value={parsedEdits.productName}
                              placeholder="Search product…"
                              getLabel={p => p.name}
                              getSub={p => {
                                const cnt = products.filter(r => r.name.toLowerCase() === p.name.toLowerCase()).length;
                                return `${p.category || ''}${cnt > 1 ? ` · ${cnt} vendors` : ''}`;
                              }}
                              onChange={p => { setParsedEdits(prev => ({ ...prev, productName: p.name, vendorName: '' })); setContractType(''); setAmcLookup('idle'); setVendorEmail(''); }}
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
                              onChange={e => setParsedEdits(prev => ({ ...prev, employeeCode: e.target.value.toUpperCase() }))}
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
                      // Product Location — editable
                      if (key === 'productLocation') {
                        const val = parsedEdits.productLocation;
                        return (
                          <div key={key} className={`ec-field ${val ? 'filled' : 'missing'}`}>
                            <span className="ec-field-label">Product Location</span>
                            <input
                              className="ec-field-input"
                              placeholder="Enter product location…"
                              value={val}
                              onChange={e => setParsedEdits(prev => ({ ...prev, productLocation: e.target.value }))}
                            />
                          </div>
                        );
                      }
                      // Description — editable textarea
                      if (key === 'description') {
                        const val = parsedEdits.description;
                        const isReq = REQUIRED_FIELDS.includes(key);
                        return (
                          <div key={key} className={`ec-field ec-field-full ${val ? 'filled' : (isReq ? 'missing-req' : 'missing')}`}>
                            <span className="ec-field-label">Description{isReq && <span className="req"> *</span>}</span>
                            <textarea
                              className="ec-field-input"
                              rows={3}
                              placeholder="Enter complaint description…"
                              value={val}
                              onChange={e => setParsedEdits(prev => ({ ...prev, description: e.target.value }))}
                              style={{ resize: 'vertical' }}
                            />
                          </div>
                        );
                      }
                      // Fallback (shouldn't hit with current FIELD_LABELS)
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
                    {/* Service Contract — AMC/Warranty/Not Applicable; AMC triggers live vendor lookup */}
                    <div className={`ec-field ${contractType ? 'filled' : 'missing'}`}>
                      <span className="ec-field-label">Service Contract<span className="req"> *</span></span>
                      <select
                        className="ec-field-input"
                        value={contractType}
                        onChange={e => {
                          const val = e.target.value;
                          setContractType(val);
                          setAmcLookup('idle');
                          if (val !== 'AMC') setVendorEmail('');
                          if (val !== 'AMC') setParsedEdits(prev => ({ ...prev, vendorName: '' }));
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <option value="">— Select contract type —</option>
                        <option value="AMC">Under AMC</option>
                        {productVendorType === 'amc_warranty' && (
                          <option value="Warranty">Under Warranty</option>
                        )}
                        <option value="NotApplicable">Not Applicable</option>
                      </select>
                      {productVendorType === 'fm_ho' && contractType && (
                        <span style={{ fontSize: 10, color: '#7c3aed', marginTop: 3, display: 'block' }}>
                          ⚡ This product escalates to FM &amp; HO Team
                        </span>
                      )}
                      {contractType === 'AMC' && amcLookup === 'loading' && (
                        <span style={{ fontSize: 10, color: '#7c3aed', marginTop: 2 }}>Looking up AMC vendor…</span>
                      )}
                      {contractType === 'AMC' && amcLookup === 'not-found' && (
                        <span style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>⚠ No AMC vendor on record — enter manually below</span>
                      )}
                    </div>
                    {/* Vendor — only shown for products with vendor escalation */}
                    {!showVendorSection && contractType && (
                      <div style={{ border: '1px solid #e0e7ff', borderRadius: 10, padding: '12px 14px', background: '#f0fdf4', marginTop: 4, marginBottom: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', letterSpacing: .4, textTransform: 'uppercase', marginBottom: 8 }}>
                          ⚡ Escalation — FM &amp; HO Team
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <div style={{ fontSize: 12, color: '#15803d', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ background: '#dcfce7', color: '#166534', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>TO</span>
                            Facility Manager email (auto from store lookup)
                          </div>
                          {hoEmailForProduct && (
                            <div style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>CC</span>
                              {hoEmailForProduct} (HO)
                            </div>
                          )}
                          <div style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ background: '#dbeafe', color: '#1d4ed8', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>CC</span>
                            Store Manager (auto)
                          </div>
                        </div>
                      </div>
                    )}
                    {showVendorSection && <div className={`ec-field ${parsedEdits.vendorName ? 'filled' : 'missing'}`}>
                      <span className="ec-field-label">Vendor</span>
                      <SearchableSelect
                        options={filteredVendors}
                        value={parsedEdits.vendorName}
                        placeholder={filteredVendors.length ? 'Search vendor…' : 'Enter vendor name…'}
                        getLabel={v => v.name}
                        getSub={v => v.email ? `📧 ${v.email}` : (v.products?.length ? v.products.slice(0,2).join(', ') : '')}
                        onChange={v => {
                          setParsedEdits(prev => ({ ...prev, vendorName: v.name }));
                          if (v.email) setVendorEmail(v.email); // auto-fill To for all contract types
                        }}
                        onFreeText={text => setParsedEdits(prev => ({ ...prev, vendorName: text }))}
                      />
                    </div>}
                    {/* Escalation email — shown once a vendor is selected, for all contract types */}
                    {showVendorSection && parsedEdits.vendorName && (
                      <div style={{ border: '1px solid #e0e7ff', borderRadius: 10, padding: '12px 14px', background: '#f5f3ff', marginTop: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', letterSpacing: .4, textTransform: 'uppercase', marginBottom: 10 }}>
                          ✉ Escalation Email
                        </div>

                        {/* To — vendor email, editable */}
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                            To <span style={{ color: '#9ca3af', fontWeight: 400 }}>(Vendor)</span>
                          </div>
                          <input
                            className="ec-field-input"
                            type="email"
                            placeholder="vendor@email.com"
                            value={vendorEmail}
                            onChange={e => setVendorEmail(e.target.value.trim())}
                            style={{ background: '#fff' }}
                          />
                          {!vendorEmail && (
                            <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 3 }}>⚠ Enter vendor email to send escalation</div>
                          )}
                        </div>

                        {/* CC — auto-filled, read-only preview */}
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                            CC <span style={{ color: '#9ca3af', fontWeight: 400 }}>(auto)</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ background: '#dbeafe', color: '#1d4ed8', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>SM</span>
                              Store Manager email (from store lookup)
                            </div>
                            {hoEmailForProduct && hoEmailForProduct !== HO_EMAIL && (
                              <div style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>HO</span>
                                {hoEmailForProduct}
                              </div>
                            )}
                            {(!hoEmailForProduct || hoEmailForProduct === HO_EMAIL) && (
                              <div style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>HO</span>
                                HO email (from product data)
                              </div>
                            )}
                            <div style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ background: '#dcfce7', color: '#166534', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>FM</span>
                              Facility Manager email (from store lookup)
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
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
                    {/* Complaint Type — auto from nature, but overridable */}
                    {(() => {
                      const types = [...new Set(natures.map(n => n.type).filter(Boolean))];
                      return (
                        <div className={`ec-field ${parsedEdits.complaintType ? 'filled' : 'missing-req'}`}>
                          <span className="ec-field-label">Complaint Type<span className="req"> *</span></span>
                          <select
                            className="ec-field-input"
                            value={parsedEdits.complaintType}
                            onChange={e => setParsedEdits(prev => ({ ...prev, complaintType: e.target.value }))}
                            style={{ cursor: 'pointer' }}
                          >
                            <option value="">— Select type —</option>
                            {types.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      );
                    })()}
                    {/* Number of Units — disabled for AC (1 complaint logs for entire store) */}
                    <div className="ec-field filled">
                      <span className="ec-field-label">Number of Units</span>
                      <input
                        type="number"
                        className="ec-field-qty-input"
                        min={1} max={20}
                        value={isAC ? 1 : quantity}
                        disabled={isAC}
                        onChange={e => !isAC && setQuantity(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                        style={isAC ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                      />
                      {isAC && <span style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>1 complaint per store for all AC units</span>}
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
                        {logging ? 'Logging…' : effectiveQty > 1 ? `✓ Log ${effectiveQty} Complaints` : '✓ Log Complaint'}
                      </button>
                    )}
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

                      {vendorEmail && (
                        <div style={{ marginBottom: 8, fontSize: 11, color: '#16a34a', background: '#dcfce7', borderRadius: 6, padding: '5px 10px', fontWeight: 600 }}>
                          ✓ To: {vendorEmail}
                          <button onClick={() => setVendorEmail('')} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>×</button>
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
                                      {c.email && (
                                        <button
                                          onClick={() => { setVendorEmail(c.email); setEmTab('form'); }}
                                          style={{ padding: '3px 10px', fontSize: 11, background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                                        >Use →</button>
                                      )}
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
