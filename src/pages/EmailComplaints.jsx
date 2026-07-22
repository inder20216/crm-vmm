import { useState, useEffect, useRef } from 'react';
import { vmm } from '../api/vmm';
import { HO_POC } from '../auth/escalationMatrix';
import './EmailComplaints.css';

function fmtTime(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
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
  contactNumber: 'Contact Number',
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
  const [parsing,         setParsing]         = useState(false);
  const [parsed,          setParsed]          = useState(null);
  const [replyBody,       setReplyBody]       = useState('');
  const [sending,         setSending]         = useState(false);
  const [quickReplyBody,  setQuickReplyBody]  = useState('');
  const [sendingQuickReply, setSendingQuickReply] = useState(false);
  const [logging,       setLogging]       = useState(false);
  const [loggingActivity, setLoggingActivity] = useState(false);
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
  const [searchingComplaint, setSearchingComplaint] = useState(false);
  const [foundComplaint,     setFoundComplaint]     = useState(null); // complaint data from system
  const [attachmentData,  setAttachmentData]  = useState(null);
  const [loadingAttach,   setLoadingAttach]   = useState(false);
  const [wipList,   setWipList]   = useState([]);
  const [templates,    setTemplates]    = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [products,     setProducts]     = useState([]);  // raw rows: each row = { name, vendor, category, hoName, hoEmail, vendorEmail }
  const [natures,      setNatures]      = useState([]);
  const [parsedEdits,  setParsedEdits]  = useState({ storeCode: '', employeeCode: '', contactNumber: '', productLocation: '', description: '' });
  const [replyTo,         setReplyTo]         = useState([]);
  const [replyCc,         setReplyCc]         = useState([]);
  const [toInput,         setToInput]         = useState('');
  const [ccInput,         setCcInput]         = useState('');
  const [empLookupStatus, setEmpLookupStatus] = useState('idle'); // idle|loading|found|not-found
  const [resolvedEmpName, setResolvedEmpName] = useState('');
  const [showReplyEditor, setShowReplyEditor] = useState(false);
  const itemIdRef = useRef(1);
  const [complaintItems, setComplaintItems] = useState([{
    id: 1, productName: '', vendorName: '', contractType: '', vendorEmail: '',
    natureOfProblem: '', complaintType: '', description: '', extraEscTo: '', extraEscCc: '', removedAutoCC: [],
    amcLookup: 'idle', selectedAttachIndices: null,
  }]);
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
          if (empRes.employee.code)
            setParsedEdits(prev => ({ ...prev, employeeCode: String(empRes.employee.code) }));
        } else { setResolvedEmpName(''); setEmpLookupStatus('not-found'); }
      } catch { setResolvedEmpName(''); setEmpLookupStatus('not-found'); }
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
    // Restore cached attachments so the Load button doesn't reappear after refresh
    const cached = email.id ? localStorage.getItem(`vmm_attach_${email.id}`) : null;
    setAttachmentData(cached ? JSON.parse(cached) : null);
    // Default reply-to = sender; CC pre-filled from original email
    setReplyTo(email.fromAddr ? [email.fromAddr] : []);
    setReplyCc(Array.isArray(email.cc) ? email.cc.filter(Boolean) : []);
    setToInput('');
    setCcInput('');
    setShowReplyEditor(false);
    setComplaintItems([{ id: (++itemIdRef.current), productName: '', vendorName: '', contractType: '', vendorEmail: '', natureOfProblem: '', complaintType: '', description: '', extraEscTo: '', extraEscCc: '', amcLookup: 'idle', selectedAttachIndices: null, removedAutoCC: [] }]);
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
        employeeCode:    p.employeeCode    || '',
        contactNumber:   p.contactNumber   || '',
        productLocation: p.productLocation || '',
        description:     p.description     || '',
      });
      setComplaintItems([{
        id: (++itemIdRef.current),
        productName:     matchedProduct?.name || p.productName     || '',
        vendorName:      p.vendorName      || '',
        natureOfProblem: matchedNature?.nature  || p.natureOfProblem || '',
        complaintType:   matchedNature?.type    || p.complaintType   || '',
        contractType: '', vendorEmail: '', description: '', extraEscTo: '', extraEscCc: '', amcLookup: 'idle', selectedAttachIndices: null, removedAutoCC: [],
      }]);
      if (p.employeeCode) {
        setEmpLookupStatus(p.employeeName ? 'found' : 'idle');
        setResolvedEmpName(p.employeeName || '');
      } else {
        setEmpLookupStatus('idle');
        setResolvedEmpName('');
      }
      if (p.suggestedReply) setReplyBody(p.suggestedReply);
    } else {
      setEmpLookupStatus('idle');
      setResolvedEmpName('');
      setParsedEdits({ storeCode: email.storeCode || '', employeeCode: '', contactNumber: '', productLocation: '', description: '' });
    }
  };

  const claimEmail = (emailId, op = 'claim') => {
    vmm.emailClaim({ operation: op, emailId, agentId, agentLabel: `Agent ${agentId.slice(-4)}` })
      .then(r => setActiveClaims(r.claims || {}))
      .catch(() => {});
  };

  const lookupResendComplaint = async () => {
    if (!resendNo.trim()) return;
    setResendLoading(true); setResendData(null); setResendVendorEmail(''); setResendDescription('');
    try {
      const r = await vmm.getComplaint(resendNo.trim());
      if (!r.success) { showToast('Complaint not found', 'warn'); return; }
      setResendData(r.complaint);
    } catch { showToast('Lookup failed — check n8n is running', 'warn'); }
    finally { setResendLoading(false); }
  };

  const sendResendEscalation = async () => {
    if (!resendData || !resendVendorEmail.trim()) return;
    setResendSending(true);
    try {
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
        employeeCode:    res.employeeCode    || prev?.employeeCode    || '',
        contactNumber:   res.contactNumber   || prev?.contactNumber   || '',
        productLocation: res.productLocation || prev?.productLocation || '',
        description:     res.description     || prev?.description     || '',
      }));
      setComplaintItems(prev => {
        const first = prev[0] || {};
        return [
          { ...first,
            productName:     matchedProduct?.name || res.productName || first.productName || '',
            vendorName:      res.vendorName      || first.vendorName      || '',
            natureOfProblem: matchedNature?.nature  || res.natureOfProblem || first.natureOfProblem || '',
            complaintType:   matchedNature?.type    || res.complaintType   || first.complaintType   || '',
          },
          ...prev.slice(1),
        ];
      });
      setParsed(res);
      setSelectedTemplateId(res.selectedTemplateId || null);
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

  // ── Complaint item helpers ────────────────────────────────────────
  const updateItem = (id, patch) => setComplaintItems(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
  const removeItem = (id) => setComplaintItems(prev => prev.filter(x => x.id !== id));
  const addItem = () => setComplaintItems(prev => [
    ...prev,
    { id: (++itemIdRef.current), productName: '', vendorName: '', contractType: '', vendorEmail: '', natureOfProblem: '', complaintType: '', description: '', extraEscTo: '', extraEscCc: '', amcLookup: 'idle', selectedAttachIndices: null, removedAutoCC: [] },
  ]);
  const toggleVendorEmail = (id, email) => setComplaintItems(prev => prev.map(x => {
    if (x.id !== id) return x;
    const emails = (x.vendorEmail || '').split(',').map(e => e.trim()).filter(Boolean);
    const next = emails.includes(email) ? emails.filter(e => e !== email) : [...emails, email];
    return { ...x, vendorEmail: next.join(', ') };
  }));
  const lookupAmcForItem = async (id, productName) => {
    const storeCode = parsedEdits.storeCode || parsed?.storeCode || selected?.storeCode || '';
    if (!storeCode || !productName) return;
    updateItem(id, { amcLookup: 'loading' });
    try {
      const res = await vmm.getAmcVendor(storeCode, productName);
      if (res.found) updateItem(id, { vendorName: res.vendor, amcLookup: 'found' });
      else updateItem(id, { amcLookup: 'not-found' });
    } catch { updateItem(id, { amcLookup: 'not-found' }); }
  };
  const isAttachSelected = (item, idx) => item.selectedAttachIndices === null || item.selectedAttachIndices.includes(idx);
  const toggleAttach = (id, idx) => {
    setComplaintItems(prev => prev.map(x => {
      if (x.id !== id) return x;
      const all = (attachmentData || []).filter(a => a.viewLink).map((_, i) => i);
      if (x.selectedAttachIndices === null) return { ...x, selectedAttachIndices: all.filter(i => i !== idx) };
      const next = x.selectedAttachIndices.includes(idx)
        ? x.selectedAttachIndices.filter(i => i !== idx)
        : [...x.selectedAttachIndices, idx];
      return { ...x, selectedAttachIndices: next.length === all.length ? null : next };
    }));
  };
  const getItemVendors = (productName) => {
    const selProd = (productName || '').toLowerCase().trim();
    if (!selProd || !products.length) return [];
    const exact = products.filter(p => p.name.toLowerCase() === selProd);
    if (exact.length > 0) return exact.map(p => ({ name: p.vendor, email: p.vendorEmail || '' }));
    const fuzzy = products.filter(p => p.name.toLowerCase().includes(selProd) || selProd.includes(p.name.toLowerCase()));
    return [...new Map(fuzzy.map(p => [p.vendor.toLowerCase(), { name: p.vendor, email: p.vendorEmail || '' }])).values()];
  };
  const getItemHoEmail = (productName) => {
    const row = products.find(p => p.name.toLowerCase() === (productName || '').toLowerCase());
    return row?.hoEmail || HO_EMAIL;
  };
  const getItemVendorType = (productName) => {
    const k = (productName || '').toLowerCase().trim();
    return AMC_WARRANTY_PRODUCTS.has(k) ? 'amc_warranty' : AMC_ONLY_PRODUCTS.has(k) ? 'amc_only' : 'fm_ho';
  };
  const getItemShowVendorSection = (item) => {
    const vt = getItemVendorType(item.productName);
    return vt === 'amc_warranty' || (vt === 'amc_only' && item.contractType === 'AMC');
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
        employeeName:        resolvedEmpName || parsed.employeeName || employee.name || '',
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
        uid: 1,
      };

      const allResults = [];
      for (const item of complaintItems) {
        const product = products.find(p => p.name.toLowerCase() === (item.productName || '').toLowerCase())
          || findBestByText(products, item.productName || '', ['name'])
          || { name: item.productName || '', vendor: item.vendorName || '', category: '' };
        const nature = natures.find(n => n.nature.toLowerCase() === (item.natureOfProblem || '').toLowerCase())
          || { nature: item.natureOfProblem || '', type: item.complaintType || 'Repair', tatDays: 7 };
        const itemAttachments = item.selectedAttachIndices === null
          ? driveAttachments
          : item.selectedAttachIndices.map(i => driveAttachments[i]).filter(Boolean);
        const attachmentText = itemAttachments.length
          ? '\n\nAttachments:\n' + itemAttachments.map(a => `- ${a.name}: ${a.viewLink}`).join('\n')
          : '';
        const payload = {
          ...sharedPayload,
          productName:       product.name    || item.productName    || '',
          vendorName:        item.vendorName  || product.vendor      || '',
          productType:       product.category || '',
          natureOfComplaint: nature.nature    || item.natureOfProblem || '',
          complaintType:     item.complaintType || nature.type       || 'Repair',
          contractType:      item.contractType  || '',
          tatDays:           nature.tatDays     || 7,
          remarks:           `${item.description || parsedEdits.description || parsed.description || ''}${providedText}${attachmentText}`.trim(),
          attachmentLinks:   itemAttachments,
        };
        const res = await vmm.logComplaint(payload);
        if (res.success) allResults.push({ res, item, payload, itemAttachments });
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
        const threadCCs = [...new Set((origMsg?.cc || '').split(',').map(c => c.trim()).filter(Boolean).filter(cc => cc.toLowerCase() !== OWN))].join(';');
        // Collect HO POC emails for each product logged in this complaint
        const hoCCs = [...new Set(
          allResults.map(({ item }) => (HO_POC[item.productName] || HO_POC['DEFAULT'])?.email).filter(Boolean)
        )];
        const allCCs = [...new Set([...threadCCs.split(';').filter(Boolean), ...hoCCs])].join(';');
        // Always reply to the selected (incoming) email, not the latest thread message which may be outbound
        const replyMsgId = selected.id;
        await vmm.sendEmailReply({ messageId: replyMsgId, htmlBody: confirmHtml, body: confirmBody, toRecipients: selected.fromAddr || sharedPayload.storeEmail, ccRecipients: allCCs })
          .catch(err => { console.warn('Confirmation reply failed:', err); showToast('Complaint logged but confirmation email could not be sent', 'warn'); });
        vmm.categorizeEmail(replyMsgId, ['Case Logged', 'New CRM']).catch(() => {});
        const wipMatch = wipList.find(w =>
          w.id === selected.id ||
          (w.conversationId && selected.conversationId && w.conversationId === selected.conversationId)
        );
        if (wipMatch && wipMatch.id !== replyMsgId) {
          vmm.categorizeEmail(wipMatch.id, ['Case Logged', 'New CRM']).catch(() => {});
        }
        // One escalation email per complaint item (different product/vendor each)
        for (const { res, item, payload: iPayload, itemAttachments } of allResults) {
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
            complaints: [{ complaintno: res.complaintno, productLocation: iPayload.productLocation, natureOfProblem: item.natureOfProblem || '', edcDate: res.edcDate, description: (item.description || parsedEdits.description || parsed.description || '').replace(/\n+/g, ' ').trim() }],
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
          vmm.resolveWip(wipMatch.id).catch(() => {});
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

  const missingRequired = parsed ? (parsed.missingFromTemplate || []) : [];
  // Unique product names for dropdown (deduplicate by name)
  const uniqueProducts = [...new Map(products.map(p => [p.name.toLowerCase(), p])).values()];
  // Can log if: store present + employee verified + every complaint item has product/nature/type/contract
  const storeOk    = !!(parsedEdits.storeCode || parsed?.storeCode || selected?.storeCode);
  const employeeOk = !parsed?.employeeCode || empLookupStatus === 'found';
  const canLog     = parsed && storeOk && employeeOk && complaintItems.length > 0
    && complaintItems.every(item => item.productName && item.natureOfProblem && item.complaintType && item.contractType);

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
                const { toAddresses, ccAddresses } = vmm.resolveEscalationRecipients({
                  storeCode: resendData.storecode, storeEmail: resendData.storeemail, storeName: resendData.storename,
                  fmEmail: resendData.fmemail, fmName: resendData.fmname,
                  vendorName: resendData.vendorname, productName: resendData.productname,
                  storeState: resendData.statename, storeCity: resendData.storecity,
                  manualVendorEmail: resendVendorEmail.trim(),
                });
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
                        <span style={{ color: '#6b7280', fontWeight: 400, marginLeft: 6 }}>(not stored — enter manually)</span>
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
                        {ccAddresses.length ? ccAddresses.map(r => r.emailAddress.address).join(', ') : '—'}
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
            <div className="ec-confirm-title">Confirm before logging</div>
            <div className="ec-confirm-subtitle">Please verify all details are correct:</div>
            <div className="ec-confirm-grid">
              {[
                { label: 'Store Code',     val: parsedEdits.storeCode || parsed?.storeCode || selected?.storeCode, req: true },
                { label: 'Employee Code',  val: parsedEdits.employeeCode || parsed?.employeeCode,  req: false },
                { label: 'Employee Name',  val: resolvedEmpName || parsed?.employeeName,            req: false },
                { label: 'Contact Number', val: parsedEdits.contactNumber || parsed?.contactNumber, req: false },
              ].map(({ label, val, req }) => (
                <div key={label} className={`ec-confirm-row${!val && req ? ' warn' : ''}`}>
                  <span className="ec-confirm-label">{label}</span>
                  <span className={`ec-confirm-val${!val ? ' empty' : ''}`}>{val || (req ? '⚠ Missing' : '—')}</span>
                </div>
              ))}
            </div>
            {complaintItems.map((item, idx) => (
              <div key={item.id} style={{ margin: '8px 0', padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}>
                <div style={{ fontWeight: 700, color: '#4f46e5', marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  {complaintItems.length > 1 ? `Complaint #${idx + 1}` : 'Complaint'}
                </div>
                {[
                  { label: 'Product',          val: item.productName,    req: true },
                  { label: 'Contract',         val: item.contractType === 'AMC' ? 'Under AMC' : item.contractType === 'Warranty' ? 'Under Warranty' : item.contractType === 'NotApplicable' ? 'Not Applicable' : '', req: true },
                  { label: 'Vendor',           val: item.vendorName,     req: false },
                  ...(item.vendorEmail ? [{ label: 'Escalation To', val: item.vendorEmail, req: false }] : []),
                  { label: 'Nature',           val: item.natureOfProblem, req: true },
                  { label: 'Type',             val: item.complaintType,   req: true },
                  { label: 'Images',           val: item.selectedAttachIndices === null ? 'All' : `${item.selectedAttachIndices.length} selected`, req: false },
                ].map(({ label, val, req }) => (
                  <div key={label} className={`ec-confirm-row${!val && req ? ' warn' : ''}`}>
                    <span className="ec-confirm-label">{label}</span>
                    <span className={`ec-confirm-val${!val ? ' empty' : ''}`}>{val || (req ? '⚠ Missing' : '—')}</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="ec-confirm-actions">
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
                            const tagType  = updateAction === 'escalate' ? 'escalated' : updateAction === 'close' ? 'closed' : 'updated';
                            const tagLabel = `${updateAction === 'escalate' ? 'Escalated' : updateAction === 'close' ? 'Closed' : 'Updated'} • ${updateForm.complaintId.trim()}`;
                            const graphCat = updateAction === 'escalate' ? 'Escalated' : updateAction === 'close' ? 'Case Closed' : 'Case Updated';
                            tagEmail(selected.id, tagType, tagLabel);
                            patchEmailCategories(selected.id, [graphCat, 'New CRM']);
                            vmm.categorizeEmail(selected.id, [graphCat, 'New CRM']).catch(() => {});
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
                  </div>
                  {/* ── Complaint item cards ── */}
                  {complaintItems.map((item, idx) => {
                    const itemProdInList  = products.some(p => p.name.toLowerCase() === (item.productName || '').toLowerCase().trim());
                    const itemVendors     = getItemVendors(item.productName);
                    const itemHoEmail    = getItemHoEmail(item.productName);
                    const itemVendorType = getItemVendorType(item.productName);
                    const itemShowVendor = getItemShowVendorSection(item);
                    const itemNatureOk   = natures.some(n => n.nature === item.natureOfProblem);
                    const complaintTypes = [...new Set(natures.map(n => n.type).filter(Boolean))];
                    const driveFiles     = (attachmentData || []).filter(a => a.viewLink);
                    return (
                      <div key={item.id} style={{ border: '1.5px solid #c7d2fe', borderRadius: 10, padding: '12px 14px', margin: '10px 0', background: '#fafafa' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                            {complaintItems.length > 1 ? `Complaint #${idx + 1}` : 'Complaint Details'}
                            {item.productName && <span style={{ marginLeft: 6, fontWeight: 400, color: '#374151', textTransform: 'none', letterSpacing: 0 }}>— {item.productName}</span>}
                          </span>
                          {complaintItems.length > 1 && (
                            <button onClick={() => removeItem(item.id)} style={{ padding: '2px 10px', fontSize: 11, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Remove</button>
                          )}
                        </div>
                        <div className="ec-fields-grid">
                          {/* Product */}
                          <div className={`ec-field ${itemProdInList ? 'filled' : 'missing-req'}`}>
                            <span className="ec-field-label">Product<span className="req"> *</span></span>
                            <SearchableSelect
                              options={uniqueProducts}
                              value={item.productName}
                              placeholder="Search product…"
                              getLabel={p => p.name}
                              getSub={p => {
                                const cnt = products.filter(r => r.name.toLowerCase() === p.name.toLowerCase()).length;
                                return `${p.category || ''}${cnt > 1 ? ` · ${cnt} vendors` : ''}`;
                              }}
                              onChange={p => updateItem(item.id, { productName: p.name, vendorName: '', contractType: '', vendorEmail: '' })}
                            />
                            {item.productName && !itemProdInList && <span style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>⚠ Not in product list</span>}
                          </div>
                          {/* Service Contract */}
                          <div className={`ec-field ${item.contractType ? 'filled' : 'missing'}`}>
                            <span className="ec-field-label">Service Contract<span className="req"> *</span></span>
                            <select className="ec-field-input" value={item.contractType}
                              onChange={e => {
                                const val = e.target.value;
                                const patch = { contractType: val, amcLookup: 'idle' };
                                if (val !== 'AMC') { patch.vendorEmail = ''; patch.vendorName = ''; }
                                updateItem(item.id, patch);
                                if (val === 'AMC') lookupAmcForItem(item.id, item.productName);
                              }}
                              style={{ cursor: 'pointer' }}>
                              <option value="">— Select contract type —</option>
                              <option value="AMC">Under AMC</option>
                              {itemVendorType === 'amc_warranty' && <option value="Warranty">Under Warranty</option>}
                              <option value="NotApplicable">Not Applicable</option>
                            </select>
                            {itemVendorType === 'fm_ho' && item.contractType && <span style={{ fontSize: 10, color: '#7c3aed', marginTop: 3, display: 'block' }}>⚡ Escalates to FM &amp; HO</span>}
                            {item.contractType === 'AMC' && item.amcLookup === 'loading' && <span style={{ fontSize: 10, color: '#7c3aed', marginTop: 2 }}>Looking up AMC vendor…</span>}
                            {item.contractType === 'AMC' && item.amcLookup === 'not-found' && <span style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>⚠ No AMC vendor — enter manually</span>}
                          </div>
                          {/* Nature of Problem */}
                          <div className={`ec-field ${itemNatureOk ? 'filled' : 'missing-req'}`}>
                            <span className="ec-field-label">Nature of Problem<span className="req"> *</span></span>
                            <SearchableSelect options={natures} value={item.natureOfProblem} placeholder="Search nature…"
                              getLabel={n => n.nature} getSub={n => `${n.type} · ${n.tatDays}d TAT`}
                              onChange={n => updateItem(item.id, { natureOfProblem: n.nature, complaintType: n.type })} />
                          </div>
                          {/* Complaint Type */}
                          <div className={`ec-field ${item.complaintType ? 'filled' : 'missing-req'}`}>
                            <span className="ec-field-label">Complaint Type<span className="req"> *</span></span>
                            <select className="ec-field-input" value={item.complaintType}
                              onChange={e => updateItem(item.id, { complaintType: e.target.value })} style={{ cursor: 'pointer' }}>
                              <option value="">— Select type —</option>
                              {complaintTypes.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          {/* Vendor */}
                          {itemShowVendor && (
                            <div className={`ec-field ${item.vendorName ? 'filled' : 'missing'}`}>
                              <span className="ec-field-label">Vendor</span>
                              <SearchableSelect options={itemVendors} value={item.vendorName}
                                placeholder={itemVendors.length ? 'Search vendor…' : 'Enter vendor name…'}
                                getLabel={v => v.name} getSub={v => v.email ? `📧 ${v.email}` : ''}
                                onChange={v => updateItem(item.id, { vendorName: v.name, vendorEmail: v.email || item.vendorEmail })}
                                onFreeText={text => updateItem(item.id, { vendorName: text })} />
                            </div>
                          )}
                        </div>
                        {/* Per-complaint description */}
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                            Description
                            <span style={{ color: '#9ca3af', fontWeight: 400 }}> (specific to this product / vendor)</span>
                          </div>
                          <textarea
                            className="ec-field-input"
                            rows={2}
                            placeholder="Describe the issue for this product…"
                            value={item.description}
                            onChange={e => updateItem(item.id, { description: e.target.value })}
                            style={{ resize: 'vertical', background: '#fff', borderRadius: 6 }}
                          />
                        </div>
                        {/* Escalation Email */}
                        {item.contractType && (
                          <div style={{ border: '1px solid #e0e7ff', borderRadius: 10, padding: '12px 14px', background: '#f5f3ff', margin: '8px 0' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', letterSpacing: .4, textTransform: 'uppercase', marginBottom: 10 }}>✉ Escalation Email</div>
                            {/* TO — vendor email(s), multi-select via matrix or manual entry */}
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                                To <span style={{ color: '#9ca3af', fontWeight: 400 }}>(Vendor — select from 📋 Escalation tab or type below)</span>
                              </div>
                              {/* Chips for selected emails */}
                              {item.vendorEmail && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                                  {item.vendorEmail.split(',').map(e => e.trim()).filter(Boolean).map(email => (
                                    <span key={email} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: '#dbeafe', color: '#1d4ed8', borderRadius: 12, fontSize: 11, fontWeight: 500, border: '1px solid #93c5fd' }}>
                                      {email}
                                      <button onClick={() => toggleVendorEmail(item.id, email)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1d4ed8', padding: '0 0 0 2px', fontSize: 13, lineHeight: 1, fontWeight: 700 }}>×</button>
                                    </span>
                                  ))}
                                </div>
                              )}
                              {/* Controlled input — every keystroke saves; supports comma-separated for direct paste */}
                              <input className="ec-field-input" type="text"
                                placeholder="vendor@email.com  (comma-separate for multiple, or use Escalation tab above)"
                                value={item.vendorEmail}
                                onChange={e => updateItem(item.id, { vendorEmail: e.target.value })}
                                style={{ background: '#fff' }} />
                              {!item.vendorEmail && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 3 }}>⚠ No escalation email will be sent without a vendor email</div>}
                            </div>
                            {/* CC — auto SM + FM + HO */}
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 6 }}>CC <span style={{ color: '#9ca3af', fontWeight: 400 }}>(auto)</span></div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {[
                                  ['SM', '#dbeafe', '#1d4ed8', 'Store Manager (auto)'],
                                  ['FM', '#dcfce7', '#166534', 'Facility Manager (auto)'],
                                  ['HO', '#fef3c7', '#92400e', itemHoEmail],
                                ].map(([tag, bg, fg, txt]) => (
                                  !(item.removedAutoCC || []).includes(tag) && txt && (
                                    <div key={tag} style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ background: bg, color: fg, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>{tag}</span>
                                      {txt}
                                      <button onClick={() => updateItem(item.id, { removedAutoCC: [...(item.removedAutoCC || []), tag] })} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 13, lineHeight: 1 }} title={`Remove ${tag}`}>✕</button>
                                    </div>
                                  )
                                ))}
                              </div>
                            </div>
                            {/* Extra CC */}
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Extra CC <span style={{ color: '#9ca3af', fontWeight: 400 }}>(comma separated)</span></div>
                              <input className="ec-field-input" type="text" placeholder="email1@example.com, email2@example.com" value={item.extraEscCc} onChange={e => updateItem(item.id, { extraEscCc: e.target.value })} style={{ background: '#fff' }} />
                            </div>
                          </div>
                        )}
                        {/* Image selection for this complaint */}
                        {driveFiles.length > 0 && (
                          <div style={{ marginTop: 10, padding: '10px 12px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>📎 Images for this complaint</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {driveFiles.map((a, i) => (
                                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#0f172a' }}>
                                  <input type="checkbox" checked={isAttachSelected(item, i)} onChange={() => toggleAttach(item.id, i)} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                                  <span style={{ flex: 1 }}>{a.name}</span>
                                  {a.viewLink && <a href={a.viewLink} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#0284c7', textDecoration: 'none' }}>View</a>}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button onClick={addItem} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, color: '#4f46e5', background: '#eef2ff', border: '1.5px dashed #a5b4fc', borderRadius: 8, cursor: 'pointer', width: '100%', margin: '4px 0 12px' }}>
                    + Add Another Complaint (different product / vendor)
                  </button>

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
                        {logging ? 'Logging…' : complaintItems.length > 1 ? `✓ Log ${complaintItems.length} Complaints` : '✓ Log Complaint'}
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
