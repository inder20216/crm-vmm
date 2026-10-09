import { useState, useEffect, useRef, useCallback } from 'react';
import { vmm } from '../api/vmm';
import { useAuth } from '../context/AuthContext';
import { HO_POC } from '../auth/escalationMatrix';
import './FollowUp.css';

// Fallback used until the API responds — keeps dropdowns populated instantly
// Labels must match Google Sheet (VMM Master Data → Delay Reason) exactly
const FALLBACK_DELAY_REASONS = {
  'Delay From Vendor Side': [
    { label: 'Quotation / Field Service Report not received from vendor', tat: 1 },
    { label: 'Material or Parts Not Available',                           tat: 3 },
    { label: 'Under Transit',                                             tat: 3 },
    { label: 'Work in progress',                                          tat: 1 },
    { label: 'Vendor Is Not Responding',                                  tat: 1 },
    { label: 'Vendor Visit Pending',                                      tat: 2 },
  ],
  'Delay From HO Team': [
    { label: 'Quotation Approval Pending',  tat: 1    },
    { label: 'Delay In Release Of PO',      tat: 2    },
    { label: 'Delay Due To Landlord',       tat: 15   },
    { label: 'Delay Due To Lapse Of AMC',   tat: 3    },
    { label: 'Vendor details not provided', tat: 2    },
    { label: 'Payment under process',       tat: null },
    { label: 'Vendor Has Payment Issues',   tat: 2    },
    { label: 'Under Transit',               tat: 3    },
    { label: 'Material To Be Dispatched',   tat: 2    },
  ],
  'Work Is Delayed Due To FM': [
    { label: 'Local vendor or Quotation is being arranged', tat: 2 },
    { label: 'Site inspection pending',                     tat: 2 },
    { label: 'Facility Manager is not responding',          tat: 1 },
  ],
  'Delay From Store': [
    { label: 'Store has rescheduled the work', tat: 3 },
    { label: 'Product under observation',      tat: 1 },
    { label: 'Store is not responding',        tat: 1 },
  ],
};

// Returns the next date from the payment cycle [7, 14, 21, 28].
// If today is the 25th → 28th this month. If today is ≥28 → 7th next month.
function nextPaymentCycleDate() {
  const today = new Date();
  const d = today.getDate();
  const next = [7, 14, 21, 28].find(day => day > d);
  return next
    ? new Date(today.getFullYear(), today.getMonth(), next)
    : new Date(today.getFullYear(), today.getMonth() + 1, 7);
}

function bufStr(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) {
    try { return new TextDecoder().decode(new Uint8Array(v.data)); } catch { return ''; }
  }
  return String(v);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

const STATUS_COLORS = {
  Open: 'blue', Logged: 'blue', Escalated: 'red',
  Closed: 'green', Resolved: 'green',
  'Partially Closed': 'amber', 'Not Connected': 'orange',
};

export default function FollowUp() {
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState(null);
  const [filter, setFilter]         = useState('all');
  const [search, setSearch]         = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [sortOrder, setSortOrder]   = useState('newest');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast]           = useState(null);
  const [logs, setLogs]             = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [storeComplaints, setStoreComplaints] = useState([]);
  const [storeLoading,    setStoreLoading]    = useState(false);
  const [storeUpdatedIds, setStoreUpdatedIds] = useState(new Set());

  // Assignment state
  const [users,             setUsers]             = useState([]);
  const [assignMode,        setAssignMode]        = useState(false);
  const [selectedIds,       setSelectedIds]       = useState(new Set());
  const [assignUserId,      setAssignUserId]      = useState('');
  const [assignedComplaints, setAssignedComplaints] = useState([]);
  const [assignedLoading,   setAssignedLoading]   = useState(false);
  const [qsMode,  setQsMode]  = useState('after');
  const [qsDate1, setQsDate1] = useState('');
  const [qsDate2, setQsDate2] = useState('');

  // Auto-dial state (refs keep callbacks stale-closure-free)
  const [autoMode,        setAutoMode]        = useState(false);
  const [autoQueue,       setAutoQueue]       = useState([]);
  const [autoIndex,       setAutoIndex]       = useState(0);
  const [autoCallState,   setAutoCallState]   = useState('idle'); // idle|dialing|form|auto-nc|disconnected
  const [isRedial,        setIsRedial]        = useState(false);
  const [showRedialModal, setShowRedialModal] = useState(false);
  const autoModeRef      = useRef(false);
  const autoQueueRef     = useRef([]);
  const autoIndexRef     = useRef(0);
  const isRedialRef      = useRef(false);
  const autoCallStateRef = useRef('idle');

  const syncAutoMode      = (v) => { autoModeRef.current      = v; setAutoMode(v); };
  const syncAutoQueue     = (v) => { autoQueueRef.current     = v; setAutoQueue(v); };
  const syncAutoIndex     = (v) => { autoIndexRef.current     = v; setAutoIndex(v); };
  const syncIsRedial      = (v) => { isRedialRef.current      = v; setIsRedial(v); };
  const syncAutoCallState = (v) => { autoCallStateRef.current = v; setAutoCallState(v); };

  // Form state
  const [method,       setMethod]       = useState('Call');
  const [txnId,        setTxnId]        = useState('');
  const [mobileCalled, setMobileCalled] = useState('');
  const [vendorTicket, setVendorTicket] = useState('');
  const [action,       setAction]       = useState('Partially Closed');
  const [delayMain,    setDelayMain]    = useState('');
  const [delaySub,     setDelaySub]     = useState('');
  const [newEdc,       setNewEdc]       = useState('');
  const [closedBy,     setClosedBy]     = useState('');
  const [remarks,      setRemarks]      = useState('');
  const [delayReasons, setDelayReasons] = useState(FALLBACK_DELAY_REASONS);

  // Load delay reasons from Google Sheet via n8n — updates TATs without a code deploy
  useEffect(() => {
    vmm.getDelayReasons()
      .then(res => {
        if (res.success && res.grouped && Object.keys(res.grouped).length > 0) {
          setDelayReasons(res.grouped);
        }
      })
      .catch(() => {}); // keep fallback on error
  }, []);

  // Load user list for assignment dropdown (admin only)
  useEffect(() => {
    if (!isAdmin) return;
    vmm.getFollowupUsers().then(res => { if (res.success) setUsers(res.users || []); }).catch(() => {});
  }, [isAdmin]);

  // Load assigned complaints when "Assigned to Me" tab is selected
  useEffect(() => {
    if (filter !== 'mine' || !currentUser?.id) return;
    setAssignedLoading(true);
    vmm.getMyFollowups(currentUser.id)
      .then(res => {
        if (res.success) setAssignedComplaints(res.complaints.map(c => ({
          ...c,
          complaintno:     bufStr(c.complaintno),
          current_status:  bufStr(c.status || c.current_status),
          store_code:      bufStr(c.storecode  || c.store_code),
          store_name:      bufStr(c.storename  || c.store_name),
          storeemail:      bufStr(c.storeemail),
          productname:     bufStr(c.productname),
          vendorname:      bufStr(c.vendorname),
          fm_name:         bufStr(c.fmname     || c.fm_name),
          fm_mobile:       bufStr(c.fm_mobile),
          fm_email:        bufStr(c.fmemail    || c.fm_email),
          empname:         bufStr(c.empname),
          empmobileno:     bufStr(c.empmobileno),
          closuredate:     bufStr(c.edc        || c.closuredate),
          days_overdue:    parseInt(c.days_overdue) || 0,
          nc_count:        parseInt(c.nc_count)     || 0,
          managername:     bufStr(c.managername),
          managermobileno: bufStr(c.managermobileno),
          last_remark:     bufStr(c.last_remark),
        })));
      })
      .catch(() => {})
      .finally(() => setAssignedLoading(false));
  }, [filter, currentUser?.id]);

  useEffect(() => {
    vmm.getFollowUpComplaints()
      .then(res => {
        if (res.success) setComplaints(res.complaints.map(c => ({
          ...c,
          complaintno:      bufStr(c.complaintno),
          current_status:   bufStr(c.current_status),
          store_code:       bufStr(c.storecode  || c.store_code),
          store_name:       bufStr(c.storename  || c.store_name),
          storeemail:       bufStr(c.storeemail),
          city:             bufStr(c.city),
          productname:      bufStr(c.productname),
          producttype:      bufStr(c.producttype),
          productlocation:  bufStr(c.productlocation),
          natureofproblem:  bufStr(c.natureofproblem),
          vendorname:       bufStr(c.vendorname),
          fm_name:          bufStr(c.fmname     || c.fm_name),
          fm_mobile:        bufStr(c.fm_mobile),
          fm_email:         bufStr(c.fmemail    || c.fm_email),
          empname:          bufStr(c.empname),
          empmobileno:      bufStr(c.empmobileno),
          closuredate:      bufStr(c.edc       || c.closuredate),
          days_overdue:     parseInt(c.days_overdue) || 0,
          nc_count:         parseInt(c.nc_count)     || 0,
          managername:      bufStr(c.managername),
          managermobileno:  bufStr(c.managermobileno),
          last_remark:      bufStr(c.last_remark),
        })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const resetForm = (c) => {
    setMethod('Call');
    setTxnId('');
    setMobileCalled(c?.empmobileno || c?.fm_mobile || c?.managermobileno || '');
    setVendorTicket('');
    setAction('Partially Closed');
    setDelayMain(''); setDelaySub(''); setNewEdc('');
    setClosedBy(''); setRemarks('');
  };

  const changeAction = (val) => {
    setAction(val);
    setDelayMain(''); setDelaySub(''); setClosedBy('');
    if (val === 'Not Connected') {
      const d = new Date(); d.setDate(d.getDate() + 3);
      setNewEdc(d.toISOString().split('T')[0]);
      setMethod('Call');
    } else if (val === 'Closed') {
      setNewEdc(new Date().toISOString().split('T')[0]);
    } else {
      setNewEdc('');
    }
  };

  const selectComplaint = (c, keepStorePanel = false) => {
    setSubmitting(false);
    setSelected(c);
    resetForm(c);
    setLogs([]);
    setLogsLoading(true);
    vmm.getComplaintDetail(c.id)
      .then(res => { if (res.success) setLogs((res.logs || []).map(l => ({ ...l, status: bufStr(l.status), remarks: bufStr(l.remarks) }))); })
      .catch(() => {})
      .finally(() => setLogsLoading(false));
    if (!keepStorePanel) {
      setStoreComplaints([]);
      setStoreUpdatedIds(new Set());
    }
    if (c.store_code) {
      setStoreLoading(true);
      vmm.getStoreFollowups(c.store_code)
        .then(res => { if (res.success) setStoreComplaints(res.complaints || []); })
        .catch(() => {})
        .finally(() => setStoreLoading(false));
    }
  };

  const handleCallStore = () => {
    const num = (selected?.empmobileno || '').replace(/\D/g, '');
    if (!num) return;
    setMobileCalled(num);
    changeAction('Not Connected');
    window.__vmmDial?.(num);
  };

  const handleBulkNC = async () => {
    if (!storeComplaints.length || submitting) return;
    setSubmitting(true);
    try {
      const ids = storeComplaints.map(c => c.id);
      const res = await vmm.bulkNotConnected({ complaintIds: ids, remarks: remarks || 'Called - Not Connected', uid: 1 });
      if (res?.success) {
        showToast(`NC logged for ${res.logged} complaint(s)${res.emailSent ? ' · email sent to store' : ''}`, 'ok');
        const idSet = new Set(ids);
        setComplaints(prev => prev.map(c => idSet.has(c.id) ? { ...c, current_status: 'Not Connected', nc_count: (c.nc_count || 0) + 1 } : c));
        setStoreComplaints([]);
        setLogsLoading(true);
        vmm.getComplaintDetail(selected.id)
          .then(r => { if (r.success) setLogs((r.logs || []).map(l => ({ ...l, status: bufStr(l.status), remarks: bufStr(l.remarks) }))); })
          .catch(() => {})
          .finally(() => setLogsLoading(false));
      } else {
        showToast(res?.message || 'Bulk NC failed', 'err');
      }
    } catch { showToast('Connection error. Please try again.', 'err'); }
    finally { setSubmitting(false); }
  };

  const todayStr  = () => new Date().toISOString().split('T')[0];
  const daysAgo   = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; };

  const selectByEdc = (test) => {
    const matches = displayed.filter(c => {
      if (!c.closuredate) return false;
      return test(String(c.closuredate).substring(0, 10));
    });
    setSelectedIds(prev => { const n = new Set(prev); matches.forEach(c => n.add(c.id)); return n; });
  };

  const selectByMonth = (month) => {
    if (!month) return;
    selectByEdc(edc => edc.startsWith(month));
  };

  const handleQsApply = () => {
    if (!qsDate1) return;
    if (qsMode === 'after')                     selectByEdc(edc => edc > qsDate1);
    else if (qsMode === 'before')               selectByEdc(edc => edc < qsDate1);
    else if (qsMode === 'custom')               selectByEdc(edc => edc === qsDate1);
    else if (qsMode === 'between' && qsDate2)   selectByEdc(edc => edc >= qsDate1 && edc <= qsDate2);
  };

  // ── Auto-dial ────────────────────────────────────────────────────────────────
  const dialAutoNext = useCallback((nextIdx) => {
    const queue = autoQueueRef.current;
    if (nextIdx >= queue.length) {
      syncAutoMode(false);
      syncAutoCallState('idle');
      return;
    }
    syncAutoIndex(nextIdx);
    syncIsRedial(false);
    const c = queue[nextIdx];
    selectComplaint(c);
    changeAction('Not Connected');
    const phone = (c.empmobileno || c.managermobileno || '').replace(/\D/g, '');
    if (phone) {
      setTimeout(() => { syncAutoCallState('dialing'); window.__vmmDial?.(phone); }, 1200);
    } else {
      dialAutoNext(nextIdx + 1); // no phone — skip
    }
  }, []);

  const doAutoNC = useCallback(async () => {
    const c = autoQueueRef.current[autoIndexRef.current];
    if (!c) return;
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const newEdc = tomorrow.toISOString().split('T')[0];
    try {
      await vmm.notConnected({
        complaintId: c.id, complaintno: c.complaintno,
        remarks: isRedialRef.current ? 'Auto-dial: Not Connected (redial — no email)' : 'Auto-dial: Not Connected',
        uid: 1, newClosureDate: newEdc, suppressEmail: true,
      });
      const upd = { current_status: 'Not Connected', nc_count: (c.nc_count || 0) + 1, closuredate: newEdc };
      setComplaints(prev       => prev.map(x => x.id === c.id ? { ...x, ...upd } : x));
      setAssignedComplaints(prev => prev.map(x => x.id === c.id ? { ...x, ...upd } : x));
    } catch { /* silent — still advance */ }
    dialAutoNext(autoIndexRef.current + 1);
  }, []);

  const startAutoDial = () => {
    const queue = assignedComplaints
      .filter(c => !['Closed','Resolved'].includes(c.current_status))
      .sort((a, b) => new Date(a.closuredate || '9999') - new Date(b.closuredate || '9999'));
    if (!queue.length) { showToast('No assigned complaints to dial', 'err'); return; }
    syncAutoQueue(queue);
    syncAutoMode(true);
    dialAutoNext(0);
  };

  const stopAutoDial = () => { syncAutoMode(false); syncAutoCallState('idle'); setShowRedialModal(false); };

  const handleAutoConnected = () => syncAutoCallState('form');

  const handleRedial = () => {
    setShowRedialModal(false);
    syncIsRedial(true);
    const c = autoQueueRef.current[autoIndexRef.current];
    const phone = (c?.empmobileno || c?.managermobileno || '').replace(/\D/g, '');
    if (phone) { syncAutoCallState('dialing'); window.__vmmDial?.(phone); }
  };

  const handleContinueNext = () => { setShowRedialModal(false); dialAutoNext(autoIndexRef.current + 1); };

  // Register call-ended callback once (uses refs — no stale closures)
  useEffect(() => {
    window.__vmmOnCallEnded = () => {
      if (!autoModeRef.current) return;
      const cs = autoCallStateRef.current;
      if (cs === 'dialing')    syncAutoCallState('auto-nc');
      else if (cs === 'form')  syncAutoCallState('disconnected');
    };
    return () => { delete window.__vmmOnCallEnded; };
  }, []);

  // React to auto-dial state transitions
  useEffect(() => {
    if (autoCallState === 'auto-nc')     doAutoNC();
    if (autoCallState === 'disconnected') setShowRedialModal(true);
  }, [autoCallState, doAutoNC]);

  const handleAssign = async () => {
    if (!assignUserId || !selectedIds.size || submitting) return;
    setSubmitting(true);
    try {
      const assignments = [...selectedIds].map(id => ({ complaint_id: id, user_id: parseInt(assignUserId) }));
      const res = await vmm.assignFollowups({ assignments, assigned_by: currentUser?.id || 0 });
      if (res?.success !== false) {
        const name = users.find(u => String(u.id) === String(assignUserId))?.name || 'user';
        showToast(`${res.assigned} complaint(s) assigned to ${name}`, 'ok');
        setSelectedIds(new Set());
        setAssignMode(false);
        setAssignUserId('');
        // Refresh mine list if open
        if (filter === 'mine') setAssignedComplaints([]);
      } else {
        showToast('Assignment failed', 'err');
      }
    } catch { showToast('Connection error', 'err'); }
    finally { setSubmitting(false); }
  };

  // Auto-populate txnId when SparkTG fires the call-started event (outbound)
  useEffect(() => {
    window.__vmmOnCallStarted = (callId, phone) => {
      if (callId) setTxnId(String(callId));
      if (phone)  setMobileCalled(phone.replace(/\D/g, ''));
    };
    return () => { delete window.__vmmOnCallStarted; };
  }, []);

  const overdue = complaints.filter(c => c.days_overdue > 0);
  const today   = complaints.filter(c => {
    if (!c.closuredate) return false;
    const t = new Date().toISOString().split('T')[0];
    return String(c.closuredate).startsWith(t);
  });

  const sourceList = filter === 'mine' ? assignedComplaints : complaints;

  const displayed = sourceList
    .filter(c => {
      if (filter === 'overdue') return c.days_overdue > 0;
      if (filter === 'today')   return today.some(t => t.id === c.id);
      if (filter === 'nc')      return c.nc_count > 0;
      return true; // 'all' and 'mine'
    })
    .filter(c => {
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return (c.complaintno || '').toLowerCase().includes(s)
          || (c.store_code  || '').toLowerCase().includes(s)
          || (c.store_name  || '').toLowerCase().includes(s)
          || (c.productname || '').toLowerCase().includes(s)
          || (c.vendorname  || '').toLowerCase().includes(s);
    })
    .filter(c => {
      if (!dateFilter) return true;
      return String(c.closuredate || '').startsWith(dateFilter);
    })
    .sort((a, b) => {
      const da = new Date(a.closuredate || '9999-12-31');
      const db = new Date(b.closuredate || '9999-12-31');
      return sortOrder === 'oldest' ? da - db : db - da;
    }
    );

  // EDC date picker constraints
  const minDate = new Date().toISOString().split('T')[0];
  const isPaymentCycle = delaySub === 'Payment under process';
  const currentSubTat = delaySub
    ? ((delayReasons[delayMain] || []).find(r => r.label === delaySub)?.tat ?? null)
    : null;
  const maxDate = (() => {
    if (isPaymentCycle) return nextPaymentCycleDate().toISOString().split('T')[0];
    // Use delay reason TAT if available, else fall back to complaint's original TAT
    const tatDays = currentSubTat ?? (selected ? Number(selected.tat || 0) : 0);
    if (!tatDays) return undefined;
    const d = new Date(); d.setDate(d.getDate() + tatDays);
    return d.toISOString().split('T')[0];
  })();

  const handleSubmit = async () => {
    if (!selected) return;
    if ((action === 'Partially Closed' || action === 'Escalated' || action === 'Closed' || action === 'Update EDC') && !newEdc) {
      showToast('Date of closure is required', 'err'); return;
    }
    if (!remarks.trim() && action !== 'Closed' && action !== 'Not Connected') {
      showToast('Please add remarks', 'err'); return;
    }

    setSubmitting(true);
    try {
      const uid = 1;
      const nextLevel = (selected.escalationlevel || 0) + 1;
      let res;

      if (action === 'Update EDC') {
        res = await vmm.updateEdc({
          complaintId:     selected.id,
          newClosureDate:  newEdc,
          escalationLevel: nextLevel,
          delayMain,
          delaySub,
          remarks,
          uid,
        });
      } else if (action === 'Not Connected') {
        const hoEmail = (HO_POC[selected.productname] || HO_POC['DEFAULT'])?.email || '';
        res = await vmm.notConnected({
          complaintId: selected.id,
          complaintno: selected.complaintno,
          remarks: remarks || 'Called - Not Connected',
          uid,
          txnId,
          mobileCalled,
          newClosureDate: newEdc || '',
          escalationLevel: nextLevel,
          hoEmail,
        });
      } else if (action === 'Note') {
        res = await vmm.logEmailActivity({
          complaintNo: selected.complaintno,
          remarks,
          newStatus: selected.current_status || 'Open',
          uid,
        });
      } else {
        res = await vmm.closeComplaint({
          complaintId: selected.id,
          closureStatus: action,
          followupMethod: action === 'Updated' ? 'EDC Followup' : method,
          txnId: method === 'Call' ? txnId : '',
          mobileCalled: method === 'Call' ? mobileCalled : '',
          emailSubject: method === 'Email Reply' ? txnId : '',
          vendorTicketNo: method === 'Vendor Update' ? vendorTicket : '',
          delayMain, delaySub,
          remarks,
          uid,
          escalationLevel: nextLevel,
          newClosureDate: (action === 'Partially Closed' || action === 'Escalated') ? newEdc : '',
          closureDate: action === 'Closed' ? newEdc : '',
          closedBy:    action === 'Closed' ? closedBy : '',
        });
      }

      if (res?.success !== false && !res?.error) {
        showToast(`${selected.complaintno} updated — ${action}`, 'ok');
        if (autoModeRef.current && autoCallStateRef.current === 'form') {
          syncAutoCallState('idle');
          setTimeout(() => dialAutoNext(autoIndexRef.current + 1), 1200);
        }

        // Email is sent server-side inside vmm-not-connected PHP endpoint

        // Track this complaint as updated + find next in store panel
        const doneId = selected.id;
        const updatedIds = new Set([...storeUpdatedIds, doneId]);
        setStoreUpdatedIds(updatedIds);

        const nextInStore = storeComplaints.find(
          c => c.id !== doneId && !updatedIds.has(c.id) && !['Closed','Resolved'].includes(c.current_status)
        );

        if (action === 'Closed' || action === 'Resolved') {
          vmm.sendClosureEmail({
            storeCode:     selected.store_code   || '',
            storeName:     bufStr(selected.store_name) || '',
            storeEmail:    selected.storeemail   || '',
            fmEmail:       selected.fm_email     || '',
            fmName:        selected.fm_name      || '',
            productName:   bufStr(selected.productname) || '',
            complaintno:   selected.complaintno  || '',
            closureStatus: action,
            closureDate:   newEdc || new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }),
            closedBy,
            remarks,
          }).catch(() => {});
          setComplaints(prev => prev.filter(c => c.id !== doneId));
          if (nextInStore) {
            selectComplaint({ ...nextInStore, store_code: selected.store_code, storeemail: selected.storeemail, fm_email: selected.fm_email, fm_name: selected.fm_name }, true);
          } else {
            setSelected(null);
          }
        } else {
          const ncAdd = action === 'Not Connected' ? 1 : 0;
          setComplaints(prev => prev.map(c => {
            if (c.id !== doneId) return c;
            const edcUpdate = (action === 'Escalated' || action === 'Partially Closed' || action === 'Update EDC') && newEdc
              ? {
                  closuredate: newEdc,
                  days_overdue: Math.round((new Date().setHours(0,0,0,0) - new Date(newEdc).setHours(0,0,0,0)) / 86400000),
                }
              : {};
            return { ...c, current_status: action, nc_count: (c.nc_count || 0) + ncAdd, ...edcUpdate };
          }));
          if (nextInStore) {
            selectComplaint({ ...nextInStore, store_code: selected.store_code, storeemail: selected.storeemail, fm_email: selected.fm_email, fm_name: selected.fm_name }, true);
          } else {
            resetForm(selected);
            setLogsLoading(true);
            vmm.getComplaintDetail(doneId)
              .then(r => { if (r.success) setLogs((r.logs || []).map(l => ({ ...l, status: bufStr(l.status), remarks: bufStr(l.remarks) }))); })
              .catch(() => {})
              .finally(() => setLogsLoading(false));
          }
        }
      } else {
        showToast(res?.message || res?.error || 'Update failed', 'err');
      }
    } catch {
      showToast('Connection error. Please try again.', 'err');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fu-page">
      {toast && <div className={`fu-toast fu-toast-${toast.type}`}>{toast.msg}</div>}

      {/* ── Header ── */}
      <div className="fu-header">
        <div>
          <h1 className="fu-title">Follow-up Complaints</h1>
          <p className="fu-subtitle">Open cases requiring action</p>
        </div>
        <div className="fu-header-stats">
          <div className="fu-hstat fu-hstat-red">
            <span>{overdue.length}</span>
            Overdue
            {(() => {
              const oldest = overdue.reduce((o, c) => !o || new Date(c.closuredate) < new Date(o.closuredate) ? c : o, null);
              return oldest ? <div className="fu-hstat-sub">since {fmtDate(oldest.closuredate)}</div> : null;
            })()}
          </div>
          <div className="fu-hstat fu-hstat-amber"><span>{today.length}</span>Due Today</div>
          <div className="fu-hstat fu-hstat-blue"><span>{complaints.length}</span>Total Open</div>
        </div>
      </div>

      <div className="fu-body">

        {/* ── Left: Complaint List ── */}
        <div className="fu-list-panel">
          <div className="fu-list-toolbar">
            <div className="fu-filter-tabs">
              {[['all','All'], ['overdue','Overdue'], ['today','Due Today'], ['nc','NC'], ['mine','Assigned to Me']].map(([k,l]) => (
                <button key={k} className={`fu-ftab${filter===k?' active':''}`} onClick={() => { setFilter(k); setAssignMode(false); setSelectedIds(new Set()); }}>{l}</button>
              ))}
            </div>
            {isAdmin && filter !== 'mine' && (
              <button
                className={`fu-assign-toggle${assignMode ? ' active' : ''}`}
                onClick={() => { setAssignMode(a => !a); setSelectedIds(new Set()); setAssignUserId(''); }}
              >
                {assignMode ? '✕ Cancel' : '⊕ Assign'}
              </button>
            )}
            {assignMode && (
              <div className="fu-quickselect">
                <div className="fu-qs-header">
                  <span className="fu-qs-label">Quick Select</span>
                  {selectedIds.size > 0
                    ? <button className="fu-qs-clear" onClick={() => setSelectedIds(new Set())}>✕ Clear ({selectedIds.size})</button>
                    : <span className="fu-qs-hint">Select complaints below or use filters</span>
                  }
                </div>

                <div className="fu-qs-presets">
                  <button className="fu-qs-btn" onClick={() => selectByEdc(edc => edc === daysAgo(1))}>Yesterday</button>
                  <button className="fu-qs-btn" onClick={() => selectByEdc(edc => edc >= daysAgo(6) && edc <= todayStr())}>Last 6 days</button>
                  <button className="fu-qs-btn" onClick={() => selectByEdc(edc => edc >= daysAgo(30) && edc <= todayStr())}>Last 30 days</button>
                  <span className="fu-qs-divider" />
                  <select className="fu-qs-mode" value={qsMode} onChange={e => { setQsMode(e.target.value); setQsDate1(''); setQsDate2(''); }}>
                    <option value="after">After date</option>
                    <option value="before">Before date</option>
                    <option value="between">Between dates</option>
                    <option value="custom">Specific date</option>
                  </select>
                  <input type="date" className="fu-qs-date" value={qsDate1} onChange={e => setQsDate1(e.target.value)} />
                  {qsMode === 'between' && <>
                    <span className="fu-qs-to">–</span>
                    <input type="date" className="fu-qs-date" value={qsDate2} onChange={e => setQsDate2(e.target.value)} />
                  </>}
                  <button className="fu-qs-apply" onClick={handleQsApply} disabled={!qsDate1 || (qsMode === 'between' && !qsDate2)}>+ Add</button>
                  <span className="fu-qs-divider" />
                  <span className="fu-qs-group-label">Month</span>
                  <input type="month" className="fu-qs-date" onChange={e => { selectByMonth(e.target.value); e.target.value = ''; }} />
                </div>
              </div>
            )}
            {assignMode && selectedIds.size > 0 && (
              <div className="fu-assign-bar">
                <span className="fu-assign-count">{selectedIds.size} selected</span>
                <select className="fu-assign-user" value={assignUserId} onChange={e => setAssignUserId(e.target.value)}>
                  <option value="">— Assign to —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <button className="fu-assign-btn" onClick={handleAssign} disabled={!assignUserId || submitting}>
                  {submitting ? 'Assigning…' : 'Assign →'}
                </button>
              </div>
            )}
            <input
              className="fu-search"
              placeholder="Search complaint / store / product…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="fu-list-controls">
              <input
                type="date"
                className="fu-date-filter"
                title="Filter by EDC date"
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
              />
              {dateFilter && (
                <button className="fu-clear-date" onClick={() => setDateFilter('')} title="Clear date filter">✕</button>
              )}
              <button
                className={`fu-sort-btn${sortOrder === 'oldest' ? ' active' : ''}`}
                onClick={() => setSortOrder(o => o === 'oldest' ? 'newest' : 'oldest')}
                title={sortOrder === 'oldest' ? 'Showing oldest first — click for newest' : 'Showing newest first — click for oldest'}
              >
                {sortOrder === 'oldest' ? '↑ Oldest' : '↓ Newest'}
              </button>
            </div>
          </div>

          {filter === 'mine' && !autoMode && (
            <button
              className="fu-autodial-start"
              onClick={startAutoDial}
              disabled={assignedComplaints.filter(c => !['Closed','Resolved'].includes(c.current_status)).length === 0}
            >
              ⚡ Start Auto-Dial
              {assignedComplaints.length > 0
                ? ` (${assignedComplaints.filter(c => !['Closed','Resolved'].includes(c.current_status)).length} cases)`
                : ' — no cases assigned yet'}
            </button>
          )}

          {(loading && filter !== 'mine') || (assignedLoading && filter === 'mine') ? (
            <div className="fu-list-empty">Loading…</div>
          ) : displayed.length === 0 ? (
            <div className="fu-list-empty">{filter === 'mine' ? 'No complaints assigned to you.' : 'No complaints found.'}</div>
          ) : (
            <div className="fu-list">
              {displayed.map(c => (
                <div
                  key={c.id}
                  className={`fu-row${selected?.id === c.id ? ' active' : ''}${c.days_overdue > 0 ? ' overdue' : ''}${assignMode && selectedIds.has(c.id) ? ' fu-row-selected' : ''}`}
                  onClick={() => {
                    if (assignMode) {
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                        return next;
                      });
                    } else {
                      selectComplaint(c);
                    }
                  }}
                >
                  {assignMode && (
                    <input type="checkbox" className="fu-row-check" readOnly checked={selectedIds.has(c.id)} onClick={e => e.stopPropagation()} />
                  )}
                  <div className="fu-row-top">
                    <span className="fu-row-no">{c.complaintno}</span>
                    <div className="fu-row-badges">
                      {c.days_overdue > 0 && <span className="fu-badge fu-badge-red">{c.days_overdue}d late</span>}
                      {c.nc_count > 0 && <span className="fu-badge fu-badge-orange">NC×{c.nc_count}</span>}
                      <span className={`fu-badge fu-badge-status-${(c.current_status||'Open').toLowerCase().replace(/\s+/g,'-')}`}>
                        {c.current_status || 'Open'}
                      </span>
                    </div>
                  </div>
                  <div className="fu-row-store">{c.store_code} · {bufStr(c.store_name)}</div>
                  <div className="fu-row-product">{bufStr(c.productname)} {c.vendorname ? `· ${c.vendorname}` : ''}</div>
                  <div className="fu-row-edc">EDC: {fmtDate(c.closuredate)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Redial Modal ── */}
        {showRedialModal && (
          <div className="fu-redial-overlay">
            <div className="fu-redial-modal">
              <div className="fu-rm-icon">📞</div>
              <h3 className="fu-rm-title">Call Disconnected</h3>
              <p className="fu-rm-body">The call ended before you submitted the follow-up. What would you like to do?</p>
              <div className="fu-rm-btns">
                <button className="fu-rm-redial" onClick={handleRedial}>📞 Redial same number</button>
                <button className="fu-rm-next"   onClick={handleContinueNext}>→ Continue with next</button>
              </div>
              <button className="fu-rm-stop" onClick={stopAutoDial}>⏹ Stop Auto-Dial</button>
            </div>
          </div>
        )}

        {/* ── Right: Action Panel ── */}
        <div className="fu-action-panel">
          {/* Auto-dial banner */}
          {autoMode && (
            <div className={`fu-ad-banner fu-ad-${autoCallState}`}>
              <div className="fu-ad-top">
                <div className="fu-ad-progress">
                  <span className="fu-ad-label">⚡ Auto-Dial</span>
                  <span className="fu-ad-count">{autoIndex + 1} / {autoQueue.length}</span>
                  <span className="fu-ad-cno">{autoQueue[autoIndex]?.complaintno}</span>
                </div>
                <button className="fu-ad-stop" onClick={stopAutoDial}>⏹ Stop</button>
              </div>
              {autoCallState === 'dialing' && (
                <div className="fu-ad-actions">
                  <div className="fu-ad-ringing">📡 Dialing…</div>
                  <button className="fu-ad-connected" onClick={handleAutoConnected}>✅ Connected</button>
                  <button className="fu-ad-nc-btn" onClick={() => syncAutoCallState('auto-nc')}>📵 Not Connected</button>
                </div>
              )}
              {autoCallState === 'form' && (
                <div className="fu-ad-form-hint">📞 Connected — fill in the details below and submit</div>
              )}
              {(autoCallState === 'auto-nc' || autoCallState === 'idle') && autoMode && (
                <div className="fu-ad-form-hint fu-ad-processing">⏳ Processing…</div>
              )}
            </div>
          )}

          {!selected ? (
            <div className="fu-no-selection">
              <div className="fu-no-sel-icon">↖</div>
              <p>Select a complaint from the list to start follow-up</p>
            </div>
          ) : (
            <>
              {/* Complaint summary card */}
              <div className="fu-complaint-card">
                <div className="fu-cc-top">
                  <span className="fu-cc-no">{selected.complaintno}</span>
                  <span className={`fu-badge fu-badge-status-${(selected.current_status||'Open').toLowerCase().replace(/\s+/g,'-')}`}>
                    {selected.current_status || 'Open'}
                  </span>
                  {selected.days_overdue > 0 && (
                    <span className="fu-badge fu-badge-red">{selected.days_overdue}d overdue</span>
                  )}
                </div>
                <div className="fu-cc-grid">
                  <div className="fu-cc-field"><span>Store</span><strong>{selected.store_code} — {bufStr(selected.store_name)}, {selected.city}</strong></div>
                  <div className="fu-cc-field"><span>Product</span><strong>{bufStr(selected.productname)} ({selected.producttype})</strong></div>
                  <div className="fu-cc-field"><span>Vendor</span><strong>{selected.vendorname || '—'}</strong></div>
                  <div className="fu-cc-field"><span>Location</span><strong>{selected.productlocation || '—'}</strong></div>
                  <div className="fu-cc-field"><span>FM</span><strong>{selected.fm_name || '—'} {selected.fm_mobile ? `· ${selected.fm_mobile}` : ''}</strong></div>
                  <div className="fu-cc-field"><span>FM Email</span><strong>{selected.fm_email || '—'}</strong></div>
                  <div className="fu-cc-field"><span>Contact</span><strong style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span>{selected.empname || '—'}{selected.empmobileno ? ` · ${selected.empmobileno}` : ''}</span>
                    {selected.empmobileno && (
                      <button className="fu-call-btn" onClick={handleCallStore} title={`Call ${selected.empmobileno}`}>📞 Call</button>
                    )}
                  </strong></div>
                  <div className="fu-cc-field"><span>Manager</span><strong>{selected.managername || '—'} {selected.managermobileno ? `· ${selected.managermobileno}` : ''}</strong></div>
                  <div className="fu-cc-field"><span>EDC</span><strong style={{ color: selected.days_overdue > 0 ? '#dc2626' : 'inherit' }}>{fmtDate(selected.closuredate)}</strong></div>
                  {(() => {
                    const reminderCount = logs.filter(l => l.status === 'Escalated').length;
                    if (reminderCount === 0) return null;
                    const over = reminderCount >= 3;
                    return (
                      <div className="fu-cc-field">
                        <span>Reminders Sent</span>
                        <strong style={{ color: over ? '#dc2626' : '#92400e', display:'flex', alignItems:'center', gap:6 }}>
                          {reminderCount}
                          {over && <span style={{ fontSize:11, background:'#fef2f2', color:'#dc2626', border:'1px solid #fecaca', borderRadius:4, padding:'1px 6px' }}>3+ — close from our side</span>}
                        </strong>
                      </div>
                    );
                  })()}
                </div>
                {selected.last_remark && (
                  <div className="fu-cc-last-remark">Last: {bufStr(selected.last_remark)}</div>
                )}
              </div>

              {/* ── Store Complaints Panel ── */}
              {(storeLoading || storeComplaints.length > 0) && (
                <div className="fu-store-panel">
                  <div className="fu-store-panel-title">
                    <span>All open complaints at this store{storeComplaints.length > 0 ? ` (${storeComplaints.length})` : ''}
                      {storeUpdatedIds.size > 0 && (
                        <span style={{ marginLeft:8, fontSize:11, background: storeUpdatedIds.size >= storeComplaints.length ? '#dcfce7' : '#fef9c3', color: storeUpdatedIds.size >= storeComplaints.length ? '#15803d' : '#92400e', border: `1px solid ${storeUpdatedIds.size >= storeComplaints.length ? '#86efac' : '#fcd34d'}`, borderRadius:4, padding:'1px 7px', fontWeight:600 }}>
                          {storeUpdatedIds.size} of {storeComplaints.length} updated{storeUpdatedIds.size >= storeComplaints.length ? ' ✓' : ''}
                        </span>
                      )}
                    </span>
                    {storeLoading && <span className="fu-store-loading"> Loading…</span>}
                    {!storeLoading && storeComplaints.length > 0 && (
                      <button
                        className="fu-bulk-nc-btn"
                        onClick={handleBulkNC}
                        disabled={submitting}
                        title="Log Not Connected for all open complaints at this store and send one consolidated email"
                      >
                        📵 Mark All NC ({storeComplaints.length})
                      </button>
                    )}
                  </div>
                  {storeComplaints.length > 0 && (
                    <table className="fu-store-table">
                      <tbody>
                        {storeComplaints.map(c => (
                          <tr key={c.id} className={`${c.id === selected?.id ? 'fu-store-row-active' : ''} ${storeUpdatedIds.has(c.id) ? 'fu-store-row-done' : ''}`} onClick={() => selectComplaint({ ...selected, ...c, store_code: selected.store_code }, true)}>
                            <td className="fu-st-no">{bufStr(c.complaintno)}</td>
                            <td className="fu-st-prod">{bufStr(c.productname)}</td>
                            <td className="fu-st-edc">{fmtDate(c.edc)}</td>
                            <td className="fu-st-late">
                              {parseInt(c.days_overdue) > 0
                                ? <span className="fu-badge fu-badge-red">{c.days_overdue}d late</span>
                                : <span className="fu-badge fu-badge-status-open">Due</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* ── Case History ── */}
              <div className="fu-history">
                <div className="fu-history-title">
                  Case History
                  {logsLoading && <span className="fu-history-loading"> Loading…</span>}
                  {!logsLoading && <span className="fu-history-count">{logs.length} entries</span>}
                </div>
                {!logsLoading && logs.length === 0 ? (
                  <div className="fu-history-empty">No activity recorded yet.</div>
                ) : (
                  <table className="fu-log-table">
                    <thead>
                      <tr>
                        <th>Date / Time</th>
                        <th>Remarks</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((l, i) => {
                        const sc = STATUS_COLORS[l.status] || 'blue';
                        return (
                          <tr key={l.id || i}>
                            <td className="fu-log-date">{fmtDateTime(l.created)}</td>
                            <td className="fu-log-remarks">{bufStr(l.remarks) || '—'}</td>
                            <td><span className={`fu-log-status fu-log-status-${sc}`}>{l.status || 'Open'}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* ── Action Form ── */}
              <div className="fu-form">
                <div className="fu-form-section-title">Follow-up Action</div>

                {/* Method — hidden for Not Connected (always Call) */}
                {action !== 'Not Connected' && (
                  <div className="fu-form-row">
                    <label className="fu-label">Follow-up Method</label>
                    <div className="fu-method-btns">
                      {[['Call','📞'], ['Email Reply','📧'], ['Vendor Update','🏭']].map(([m, icon]) => (
                        <button key={m} className={`fu-method-btn${method===m?' active':''}`} onClick={() => setMethod(m)}>
                          {icon} {m}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {method === 'Call' && (
                  <div className="fu-two-col">
                    <div className="fu-form-field">
                      <label className="fu-label">TXN / Call ID</label>
                      <input className="fu-input" placeholder="SparkTG TXN ID" value={txnId} onChange={e => setTxnId(e.target.value)} />
                    </div>
                    <div className="fu-form-field">
                      <label className="fu-label">Mobile Called</label>
                      <input className="fu-input" placeholder="Number dialled" value={mobileCalled} onChange={e => setMobileCalled(e.target.value)} />
                    </div>
                  </div>
                )}
                {method === 'Email Reply' && (
                  <div className="fu-form-field">
                    <label className="fu-label">Email Subject / Reference</label>
                    <input className="fu-input" placeholder="Subject of email sent" value={txnId} onChange={e => setTxnId(e.target.value)} />
                  </div>
                )}
                {method === 'Vendor Update' && (
                  <div className="fu-form-field">
                    <label className="fu-label">Vendor Ticket No</label>
                    <input className="fu-input" placeholder="Vendor's ticket / reference number" value={vendorTicket} onChange={e => setVendorTicket(e.target.value)} />
                  </div>
                )}

                {/* Status */}
                <div className="fu-form-row">
                  <label className="fu-label">Status After Follow-up</label>
                  <div className="fu-action-btns">
                    {[
                      ['Closed',           'Closed / Resolved'],
                      ['Partially Closed', 'Partially Closed'],
                      ['Escalated',        `Escalated${logs.filter(l => l.status === 'Escalated').length > 0 ? ` (${logs.filter(l => l.status === 'Escalated').length} sent)` : ''}`],
                      ['Update EDC',       'Update EDC'],
                      ['Not Connected',    'Not Connected'],
                      ['Note',             'Add Note Only'],
                    ].map(([val, lbl]) => (
                      <button
                        key={val}
                        className={`fu-action-btn fu-action-${val.toLowerCase().replace(/\s+/g,'-')}${action===val?' active':''}`}
                        onClick={() => changeAction(val)}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Not Connected info */}
                {action === 'Not Connected' && (
                  <div style={{ padding: '10px 14px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 12, color: '#92400e', margin: '4px 0' }}>
                    ⚡ EDC auto-set to <strong>today + 3 days ({newEdc})</strong>. A reminder email will be sent to the store automatically.
                  </div>
                )}

                {/* Delay reason — for Partially Closed, Escalated, Update EDC, Closed */}
                {(action === 'Partially Closed' || action === 'Escalated' || action === 'Update EDC' || action === 'Closed') && (
                  <div className="fu-two-col">
                    <div className="fu-form-field">
                      <label className="fu-label">Delay Reason — Main</label>
                      <select className="fu-select" value={delayMain} onChange={e => { setDelayMain(e.target.value); setDelaySub(''); if (action !== 'Closed') setNewEdc(''); }}>
                        <option value="">— Select —</option>
                        {Object.keys(delayReasons).map(k => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                    <div className="fu-form-field">
                      <label className="fu-label">Delay Reason — Sub</label>
                      <select className="fu-select" value={delaySub} disabled={!delayMain} onChange={e => {
                        const sub = e.target.value;
                        setDelaySub(sub);
                        if (action !== 'Closed') {
                          if (sub === 'Payment under process') {
                            setNewEdc(nextPaymentCycleDate().toISOString().split('T')[0]);
                          } else {
                            const item = (delayReasons[delayMain] || []).find(r => r.label === sub);
                            if (item?.tat) {
                              const d = new Date(); d.setDate(d.getDate() + item.tat);
                              setNewEdc(d.toISOString().split('T')[0]);
                            }
                          }
                        }
                      }}>
                        <option value="">— Select —</option>
                        {(delayReasons[delayMain] || []).map(r => (
                          <option key={r.label} value={r.label}>
                            {r.tat ? `${r.label} (${r.tat}d)` : r.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Date field */}
                {(action === 'Partially Closed' || action === 'Escalated' || action === 'Update EDC' || action === 'Not Connected' || action === 'Closed') && (
                  <div className="fu-form-field">
                    <label className="fu-label">
                      {action === 'Closed'        ? 'Date of Closure (as per info received)'
                        : action === 'Not Connected' ? 'Revised EDC (Today + 3 Days)'
                        : 'New Closure Date'}
                      {action !== 'Not Connected' && <span className="fu-req"> *</span>}
                    </label>
                    <input
                      className="fu-input"
                      type="date"
                      value={newEdc}
                      min={action !== 'Closed' ? minDate : undefined}
                      max={action === 'Closed' ? minDate : maxDate}
                      onChange={e => setNewEdc(e.target.value)}
                    />
                  </div>
                )}

                {/* Case Closed By — only for Closed */}
                {action === 'Closed' && (
                  <div className="fu-form-field">
                    <label className="fu-label">Case Closed By</label>
                    <input className="fu-input" placeholder="Name of person who confirmed closure" value={closedBy} onChange={e => setClosedBy(e.target.value)} />
                  </div>
                )}

                {/* Remarks */}
                <div className="fu-form-field">
                  <label className="fu-label">
                    Remarks {(action !== 'Closed' && action !== 'Not Connected') && <span className="fu-req">*</span>}
                  </label>
                  <textarea
                    className="fu-textarea"
                    placeholder="Add follow-up notes, vendor response, next steps…"
                    rows={3}
                    value={remarks}
                    onChange={e => setRemarks(e.target.value)}
                  />
                </div>

                <button
                  className={`fu-submit-btn fu-submit-${action.toLowerCase().replace(/\s+/g,'-')}`}
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? 'Saving…' : `Submit — ${action}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
