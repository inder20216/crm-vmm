import { useState, useEffect } from 'react';
import { vmm } from '../api/vmm';
import './FollowUp.css';

const DELAY_REASONS = {
  'Delay From Vendor Side': [
    { label: 'Quotation not received',       tat: 1  },
    { label: 'Material/Parts Not Available', tat: 5  },
    { label: 'Delay in logistics',           tat: 3  },
    { label: 'Vendor not responding',        tat: 1  },
  ],
  'Delay From HO Team': [
    { label: 'Quotation Approval Pending',  tat: 2  },
    { label: 'Delay in Release of PO',      tat: 2  },
    { label: 'Delay Due To Landlord',       tat: 15 },
    { label: 'Delay Due To Lapse of AMC',   tat: 4  },
    { label: 'Vendor details not provided', tat: 2  },
    { label: 'Payment under process',       tat: null },
    { label: 'Vendor Has Payment Issues',   tat: 15 },
    { label: 'Delay in logistics',          tat: 3  },
  ],
  'Work Is Delayed Due To FM': [
    { label: 'Local vendor/Quotation being arranged', tat: 2 },
    { label: 'Site inspection pending',               tat: 3 },
  ],
  'Delay From Store': [
    { label: 'Store has rescheduled',     tat: 3 },
    { label: 'Product under observation', tat: 1 },
    { label: 'Store not responding',      tat: 1 },
  ],
};

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
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState(null);
  const [filter, setFilter]         = useState('all');
  const [search, setSearch]         = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast]           = useState(null);
  const [logs, setLogs]             = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

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

  useEffect(() => {
    vmm.getFollowUpComplaints()
      .then(res => {
        if (res.success) setComplaints(res.complaints.map(c => ({
          ...c,
          complaintno:      bufStr(c.complaintno),
          current_status:   bufStr(c.current_status),
          store_code:       bufStr(c.store_code),
          store_name:       bufStr(c.store_name),
          city:             bufStr(c.city),
          productname:      bufStr(c.productname),
          producttype:      bufStr(c.producttype),
          productlocation:  bufStr(c.productlocation),
          natureofproblem:  bufStr(c.natureofproblem),
          vendorname:       bufStr(c.vendorname),
          fm_name:          bufStr(c.fm_name),
          fm_mobile:        bufStr(c.fm_mobile),
          fm_email:         bufStr(c.fm_email),
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
    setMobileCalled(c?.fm_mobile || c?.managermobileno || '');
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

  const selectComplaint = (c) => {
    setSelected(c);
    resetForm(c);
    setLogs([]);
    setLogsLoading(true);
    vmm.getComplaintDetail(c.id)
      .then(res => { if (res.success) setLogs((res.logs || []).map(l => ({ ...l, status: bufStr(l.status), remarks: bufStr(l.remarks) }))); })
      .catch(() => {})
      .finally(() => setLogsLoading(false));
  };

  const overdue = complaints.filter(c => c.days_overdue > 0);
  const today   = complaints.filter(c => {
    if (!c.closuredate) return false;
    const t = new Date().toISOString().split('T')[0];
    return String(c.closuredate).startsWith(t);
  });

  const displayed = complaints
    .filter(c => {
      if (filter === 'overdue') return c.days_overdue > 0;
      if (filter === 'today')   return today.some(t => t.id === c.id);
      if (filter === 'nc')      return c.nc_count > 0;
      return true;
    })
    .filter(c => {
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return (c.complaintno || '').toLowerCase().includes(s)
          || (c.store_code  || '').toLowerCase().includes(s)
          || (c.store_name  || '').toLowerCase().includes(s)
          || (c.productname || '').toLowerCase().includes(s)
          || (c.vendorname  || '').toLowerCase().includes(s);
    });

  const handleSubmit = async () => {
    if (!selected) return;
    if ((action === 'Partially Closed' || action === 'Escalated' || action === 'Closed') && !newEdc) {
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

      if (action === 'Not Connected') {
        res = await vmm.notConnected({
          complaintId: selected.id,
          complaintno: selected.complaintno,
          remarks: remarks || 'Called - Not Connected',
          uid,
          txnId,
          mobileCalled,
          newClosureDate: newEdc || '',
          escalationLevel: nextLevel,
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
          followupMethod: method,
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
        if (action === 'Closed' || action === 'Resolved') {
          setComplaints(prev => prev.filter(c => c.id !== selected.id));
          setSelected(null);
        } else {
          const ncAdd = action === 'Not Connected' ? 1 : 0;
          setComplaints(prev => prev.map(c => c.id === selected.id
            ? { ...c, current_status: action, nc_count: (c.nc_count || 0) + ncAdd }
            : c));
          resetForm(selected);
          setLogsLoading(true);
          vmm.getComplaintDetail(selected.id)
            .then(r => { if (r.success) setLogs((r.logs || []).map(l => ({ ...l, status: bufStr(l.status), remarks: bufStr(l.remarks) }))); })
            .catch(() => {})
            .finally(() => setLogsLoading(false));
        }
      } else {
        showToast(res?.message || res?.error || 'Update failed', 'err');
      }
    } catch {
      showToast('Connection error — check n8n', 'err');
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
          <div className="fu-hstat fu-hstat-red"><span>{overdue.length}</span>Overdue</div>
          <div className="fu-hstat fu-hstat-amber"><span>{today.length}</span>Due Today</div>
          <div className="fu-hstat fu-hstat-blue"><span>{complaints.length}</span>Total Open</div>
        </div>
      </div>

      <div className="fu-body">

        {/* ── Left: Complaint List ── */}
        <div className="fu-list-panel">
          <div className="fu-list-toolbar">
            <div className="fu-filter-tabs">
              {[['all','All'], ['overdue','Overdue'], ['today','Due Today'], ['nc','NC']].map(([k,l]) => (
                <button key={k} className={`fu-ftab${filter===k?' active':''}`} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
            <input
              className="fu-search"
              placeholder="Search complaint / store / product…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="fu-list-empty">Loading…</div>
          ) : displayed.length === 0 ? (
            <div className="fu-list-empty">No complaints found.</div>
          ) : (
            <div className="fu-list">
              {displayed.map(c => (
                <div
                  key={c.id}
                  className={`fu-row${selected?.id === c.id ? ' active' : ''}${c.days_overdue > 0 ? ' overdue' : ''}`}
                  onClick={() => selectComplaint(c)}
                >
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

        {/* ── Right: Action Panel ── */}
        <div className="fu-action-panel">
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
                  <div className="fu-cc-field"><span>Manager</span><strong>{selected.managername || '—'} {selected.managermobileno ? `· ${selected.managermobileno}` : ''}</strong></div>
                  <div className="fu-cc-field"><span>EDC</span><strong style={{ color: selected.days_overdue > 0 ? '#dc2626' : 'inherit' }}>{fmtDate(selected.closuredate)}</strong></div>
                </div>
                {selected.last_remark && (
                  <div className="fu-cc-last-remark">Last: {bufStr(selected.last_remark)}</div>
                )}
              </div>

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
                      ['Escalated',        'Escalated'],
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

                {/* Delay reason — for Partially Closed, Escalated, Closed */}
                {(action === 'Partially Closed' || action === 'Escalated' || action === 'Closed') && (
                  <div className="fu-two-col">
                    <div className="fu-form-field">
                      <label className="fu-label">Delay Reason — Main</label>
                      <select className="fu-select" value={delayMain} onChange={e => { setDelayMain(e.target.value); setDelaySub(''); if (action !== 'Closed') setNewEdc(''); }}>
                        <option value="">— Select —</option>
                        {Object.keys(DELAY_REASONS).map(k => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                    <div className="fu-form-field">
                      <label className="fu-label">Delay Reason — Sub</label>
                      <select className="fu-select" value={delaySub} disabled={!delayMain} onChange={e => {
                        const sub = e.target.value;
                        setDelaySub(sub);
                        if (action !== 'Closed') {
                          const item = (DELAY_REASONS[delayMain] || []).find(r => r.label === sub);
                          if (item?.tat) {
                            const d = new Date(); d.setDate(d.getDate() + item.tat);
                            setNewEdc(d.toISOString().split('T')[0]);
                          }
                        }
                      }}>
                        <option value="">— Select —</option>
                        {(DELAY_REASONS[delayMain] || []).map(r => (
                          <option key={r.label} value={r.label}>
                            {r.tat ? `${r.label} (${r.tat}d)` : r.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Date field */}
                {(action === 'Partially Closed' || action === 'Escalated' || action === 'Not Connected' || action === 'Closed') && (
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
