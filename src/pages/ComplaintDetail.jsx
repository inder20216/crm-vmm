import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { vmm } from '../api/vmm';
import './ComplaintDetail.css';
import '../components/DialerPanel.css';
import { useAuth } from '../context/AuthContext';

const STATUS_COLORS = {
  Logged: 'blue', Open: 'blue', Escalated: 'red',
  Closed: 'green', Resolved: 'green',
  'Partially Closed': 'amber', 'Not Connected': 'orange',
};
const TYPE_COLORS = { Breakdown: 'red', Repair: 'orange', Maintenance: 'blue', Requirement: 'purple' };

const DELAY_REASONS = {
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
    { label: 'Product under observation',       tat: 1 },
    { label: 'Store is not responding',         tat: 1 },
  ],
};

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

function bufStr(v) {
  if (v == null) return null;
  if (typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) {
    try { return new TextDecoder().decode(new Uint8Array(v.data)); } catch { return ''; }
  }
  return v;
}

function cleanObj(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = bufStr(v);
  return out;
}

function extractSource(remarks) {
  if (!remarks) return null;
  const m = remarks.match(/\|\s*Source:\s*([^|]+?)(\s*\|.*)?$/);
  return m ? m[1].trim() : null;
}

function extractDelay(remarks) {
  if (!remarks) return null;
  const m = remarks.match(/\|\s*Delay:\s*([^|]+?)(\s*\|.*)?$/);
  return m ? m[1].trim() : null;
}

function matchDelaySub(stored, mainCat) {
  if (!stored) return '';
  const opts = DELAY_REASONS[mainCat] || [];
  if (opts.find(o => o.label === stored)) return stored;
  const lower = stored.toLowerCase();
  const ci = opts.find(o => o.label.toLowerCase() === lower);
  return ci ? ci.label : '';
}

function cleanRemarks(remarks) {
  if (!remarks) return '—';
  return remarks
    .replace(/\s*\|\s*Source:[^|]+?(\s*\|.*)?$/, (_, rest) => rest ? rest : '')
    .replace(/\s*\|\s*Delay:[^|]+?(\s*\|.*)?$/, (_, rest) => rest ? rest : '')
    .trim() || '—';
}

const SOURCE_STYLES = {
  'Call':          { icon: '📞', bg: '#dbeafe', color: '#1d4ed8' },
  'Email Reply':   { icon: '📧', bg: '#ede9fe', color: '#6d28d9' },
  'Vendor Update': { icon: '🏭', bg: '#dcfce7', color: '#15803d' },
};

function Field({ label, value, mono, span2 }) {
  const v = bufStr(value);
  return (
    <div className={`cd-field${span2 ? ' cd-field-span2' : ''}`}>
      <div className="cd-field-label">{label}</div>
      <div className={`cd-field-value${mono ? ' mono' : ''}`}>{v || '—'}</div>
    </div>
  );
}

function PhoneField({ label, value, span2 }) {
  const v = bufStr(value);
  const handleCall = () => {
    if (!v || !window.__vmmDial) return;
    window.__vmmDial(v.replace(/\D/g, ''));
  };
  return (
    <div className={`cd-field${span2 ? ' cd-field-span2' : ''}`}>
      <div className="cd-field-label">{label}</div>
      <div className="cd-field-value">
        {v || '—'}
        {v && (
          <button className="ctc-btn" onClick={handleCall} title={`Call ${v}`}>
            📞
          </button>
        )}
      </div>
    </div>
  );
}

export default function ComplaintDetail() {
  const { currentUser } = useAuth();
  const { id }    = useParams();
  const navigate  = useNavigate();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // Add Update form
  const [showUpdate, setShowUpdate]   = useState(false);
  const [updAction,  setUpdAction]    = useState(null); // 'update' | 'escalate' | 'close'
  const [updSrc,     setUpdSrc]       = useState('Call');
  const [updTxnId,   setUpdTxnId]     = useState('');
  const [updMobile,  setUpdMobile]    = useState('');
  const [updEmailRef, setUpdEmailRef] = useState('');
  const [updVendorTicket, setUpdVendorTicket] = useState('');
  const [updStatus,  setUpdStatus]    = useState('Open');
  const [updDelayMain, setUpdDelayMain] = useState('');
  const [updDelaySub,  setUpdDelaySub]  = useState('');
  const [updEdc,      setUpdEdc]      = useState('');
  const [updClosedBy, setUpdClosedBy] = useState('');
  const [updRemarks,  setUpdRemarks]  = useState('');
  const [confirmPending, setConfirmPending] = useState(false);
  const [updating,   setUpdating]     = useState(false);
  const [updateMsg,  setUpdateMsg]    = useState(null);
  const [logsRefreshing, setLogsRefreshing] = useState(false);

  const showUpdMsg = (text, type = 'ok') => {
    setUpdateMsg({ text, type });
    setTimeout(() => setUpdateMsg(null), 4000);
  };

  const isEmailSourced = (cmp) => {
    const s = (cmp?.sourceofcomplaints || '').toLowerCase();
    return s.includes('email') || s.includes('e-mail');
  };
  const emailRefDefault = (cmp) => cmp?.sourceofcsubject ? `Re: ${cmp.sourceofcsubject}` : '';

  useEffect(() => {
    vmm.getComplaintDetail(id)
      .then(res => {
        if (res.success) {
          const complaint = cleanObj(res.complaint);
          setData({
            ...res,
            complaint,
            logs: (res.logs || []).map(l => ({ ...l, remarks: bufStr(l.remarks), status: bufStr(l.status) })),
            escalations: (res.escalations || []).map(e => ({ ...e, ticketno: bufStr(e.ticketno) })),
          });
          if (isEmailSourced(complaint)) {
            setUpdSrc('Email Reply');
            setUpdEmailRef(emailRefDefault(complaint));
          }
        } else setError(res.message || 'Complaint not found.');
      })
      .catch(() => setError('Could not load complaint details. Please try again.'))
      .finally(() => setLoading(false));
  }, [id]);

  const refreshData = () => {
    setLogsRefreshing(true);
    vmm.getComplaintDetail(id)
      .then(res => {
        if (res.success) setData(prev => ({
          ...prev,
          complaint: cleanObj(res.complaint),
          logs: (res.logs || []).map(l => ({ ...l, status: bufStr(l.status), remarks: bufStr(l.remarks) })),
          escalations: (res.escalations || []).map(e => ({ ...e, ticketno: bufStr(e.ticketno) })),
        }));
      })
      .catch(() => {})
      .finally(() => setLogsRefreshing(false));
  };

  const handleUpdate = async () => {
    if (!updRemarks.trim()) { showUpdMsg('Remarks are required', 'err'); return; }
    // Preserve existing status on plain update — avoids resetting Escalated → Open
    const effectiveStatus = updAction === 'escalate'      ? 'Escalated'
      : updAction === 'not-connected' ? 'Not Connected'
      : updAction === 'close'         ? updStatus
      : (data.complaint?.current_status || 'Open');
    if (!updEdc) { showUpdMsg('Date of closure (EDC) is required', 'err'); return; }

    setUpdating(true);
    try {
      const c = data.complaint;
      const nextLevel = parseInt(c.escalationlevel || 0) + 1;
      let res;

      if (updAction === 'not-connected') {
        res = await vmm.notConnected({
          complaintId: c.id,
          complaintno: c.complaintno,
          remarks: updRemarks,
          uid: currentUser?.id ?? 1,
          txnId: updTxnId,
          mobileCalled: updMobile,
          newClosureDate: updEdc,
          escalationLevel: nextLevel,
          delayMain: updDelayMain,
          delaySub: updDelaySub,
        });
      } else {
        const followupMethod = updSrc === 'Email Reply' ? 'Email Reply'
                              : updSrc === 'Vendor Update' ? 'Vendor Update'
                              : 'Call';
        const basePayload = {
          complaintId:   c.id,
          followupMethod,
          txnId:         updSrc === 'Call'          ? updTxnId        : '',
          mobileCalled:  updSrc === 'Call'          ? updMobile       : '',
          emailSubject:  updSrc === 'Email Reply'   ? updEmailRef     : '',
          vendorTicketNo:updSrc === 'Vendor Update' ? updVendorTicket : '',
          remarks:       updRemarks,
          uid:           currentUser?.id ?? 1,
        };

        if (updAction === 'update') {
          res = await vmm.updateComplaint({
            ...basePayload,
            delayMain:      updDelayMain,
            delaySub:       updDelaySub,
            newClosureDate: updEdc || '',
            closureStatus:  effectiveStatus,
          });
        } else if (updAction === 'escalate') {
          res = await vmm.escalateComplaint({
            ...basePayload,
            closureStatus:  effectiveStatus,
            delayMain:      updDelayMain,
            delaySub:       updDelaySub,
            newClosureDate: updEdc || '',
            escalationLevel: nextLevel,
          });
        } else {
          // close action (Closed / Partially Closed)
          res = await vmm.closeComplaint({
            ...basePayload,
            closureStatus: effectiveStatus,
            closureDate:   updEdc || '',
            closedBy:      updClosedBy || '',
          });
        }
      } // end else (not-connected branch)

      if (res?.success !== false && !res?.error) {
        showUpdMsg('Update saved successfully', 'ok');
        setUpdAction(null);
        setUpdTxnId(''); setUpdMobile('');
        setUpdEmailRef(isEmailSourced(c) ? emailRefDefault(c) : '');
        setUpdVendorTicket(''); setUpdDelayMain(''); setUpdDelaySub('');
        setUpdEdc(''); setUpdClosedBy(''); setUpdRemarks('');
        refreshData();
      } else {
        showUpdMsg(res?.message || res?.error || 'Update failed', 'err');
      }
    } catch {
      showUpdMsg('Connection error. Please try again.', 'err');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return <div className="cd-page"><div className="cd-loading">Loading complaint…</div></div>;
  if (error)   return <div className="cd-page"><div className="cd-error">{error}</div></div>;

  const c    = data.complaint;
  const logs = data.logs || [];
  const escs = data.escalations || [];
  const stats = data.stats || {};

  const status = c.current_status || 'Open';
  const sColor = STATUS_COLORS[status] || 'blue';
  const tColor = TYPE_COLORS[c.typeofcomplaint] || 'blue';
  const days   = c.days_overdue;

  // TAT in days between logged and EDC
  const loggedDate = c.created ? new Date(c.created) : null;
  const edcDate    = c.edc     ? new Date(c.edc)     : null;
  const tatActual  = loggedDate && edcDate
    ? Math.ceil((edcDate - loggedDate) / 86400000)
    : c.tat || '—';

  return (
    <div className="cd-page">

      {/* ── Confirm-before-save modal ── */}
      {confirmPending && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: 440, maxWidth: '95vw', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
            <div style={{ fontWeight: 800, fontSize: 17, color: '#1e293b', marginBottom: 4 }}>
              Confirm {updAction === 'escalate' ? 'Escalation' : updAction === 'close' ? 'Closure' : updAction === 'not-connected' ? 'Not Connected' : 'Update'}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 18 }}>
              Verify all details before saving to the case log.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9', padding: '16px 0', marginBottom: 20 }}>
              {[
                ['Status', updAction === 'escalate' ? 'Escalated' : updAction === 'not-connected' ? 'Not Connected' : updAction === 'close' ? updStatus : (c.current_status || 'Open')],
                ['EDC', updEdc || '—'],
                updDelayMain ? ['Delay Reason', `${updDelayMain}${updDelaySub ? ` — ${updDelaySub}` : ''}`] : null,
                ['Remarks', updRemarks],
              ].filter(Boolean).map(([label, value]) => (
                <div key={label} style={{ display: 'flex', gap: 14 }}>
                  <div style={{ width: 110, flexShrink: 0, fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</div>
                  <div style={{ fontSize: 13, color: '#1e293b', fontWeight: 500, flex: 1 }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmPending(false)}
                style={{ padding: '9px 22px', borderRadius: 7, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => { setConfirmPending(false); handleUpdate(); }} disabled={updating}
                style={{ padding: '9px 22px', borderRadius: 7, border: 'none', background: updAction === 'escalate' ? '#d97706' : updAction === 'close' ? '#16a34a' : '#7c3aed', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Confirm &amp; Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top bar ── */}
      <div className="cd-topbar">
        <button className="cd-back" onClick={() => navigate(-1)}>← Back</button>
        <div className="cd-topbar-info">
          <span className="cd-complaint-no">{c.complaintno || `#${c.id}`}</span>
          <span className={`status-tag status-${sColor}`}>{status}</span>
          {c.typeofcomplaint && <span className={`type-tag type-${tColor}`}>{c.typeofcomplaint}</span>}
          {days > 0 && <span className="cd-overdue-badge">{days > 7 ? `Critical — ${days}d overdue` : `${days}d overdue`}</span>}
        </div>
        <div className="cd-topbar-dates">
          <span>Logged: <strong>{fmtDate(c.created)}</strong></span>
          <span>EDC: <strong style={{ color: days > 0 ? '#dc2626' : '#1e293b' }}>{fmtDate(c.edc)}</strong></span>
        </div>
      </div>

      <div className="cd-body">

        {/* ── Section: Complainant ── */}
        <div className="cd-section">
          <div className="cd-section-title">Complainant</div>
          <div className="cd-grid">
            <Field label="Employee Code"    value={c.empcode}        mono />
            <Field label="Employee Name"    value={c.empname} />
            <PhoneField label="Mobile No."  value={c.empmobileno} />
            <Field label="Source"           value={c.sourceofcomplaints} />
            <Field label="Designation"      value={c.empdesignation} />
            {c.sourceofcsubject && <Field label="Email Subject" value={c.sourceofcsubject} span2 />}
          </div>
        </div>

        {/* ── Section: Product ── */}
        <div className="cd-section">
          <div className="cd-section-title">Product & Complaint</div>
          <div className="cd-grid">
            <Field label="Product Name"     value={c.productname} />
            <Field label="Product Type"     value={c.producttype} />
            <Field label="Vendor"           value={c.vendorname} />
            <Field label="Location in Store" value={c.productlocation} />
            <Field label="Nature of Problem" value={c.natureofproblem} />
            <Field label="Complaint Type"   value={c.typeofcomplaint} />
            <Field label="TAT"              value={c.tat ? `${c.tat} day${c.tat > 1 ? 's' : ''}` : '—'} />
            <Field label="Closure Date / SLA" value={fmtDate(c.edc)} />
            {c.vendor_ticketno && <Field label="Vendor Ticket No" value={c.vendor_ticketno} mono />}
            {c.escalationlevel && <Field label="Escalation Level" value={`Level ${c.escalationlevel}`} />}
          </div>
        </div>

        {/* ── Section: Store ── */}
        <div className="cd-section">
          <div className="cd-section-title">Store Details</div>
          <div className="cd-grid">
            <Field label="Store Code"  value={c.storecode} mono />
            <Field label="Store Name"  value={c.storename} />
            <Field label="City"        value={c.city} />
            <Field label="Region"      value={c.region} />
            <Field label="State"       value={c.state} />
            <div className="cd-field">
              <div className="cd-field-label">Manager</div>
              <div className="cd-field-value">
                {c.managername || '—'}
                {c.managermobileno && (
                  <>&nbsp;·&nbsp;{c.managermobileno}
                    <button className="ctc-btn" title={`Call ${c.managermobileno}`}
                      onClick={() => window.__vmmDial && window.__vmmDial(bufStr(c.managermobileno).replace(/\D/g,''))}>📞</button>
                  </>
                )}
              </div>
            </div>
            <div className="cd-field">
              <div className="cd-field-label">ASM</div>
              <div className="cd-field-value">
                {c.asmname || '—'}
                {c.asmmobileno && (
                  <>&nbsp;·&nbsp;{c.asmmobileno}
                    <button className="ctc-btn" title={`Call ${c.asmmobileno}`}
                      onClick={() => window.__vmmDial && window.__vmmDial(bufStr(c.asmmobileno).replace(/\D/g,''))}>📞</button>
                  </>
                )}
              </div>
            </div>
            <Field label="FM Name"     value={c.fmname} />
            <PhoneField label="FM Mobile" value={c.fmmobileno} />
            <Field label="FM Email"    value={c.fmemail} />
          </div>
        </div>

        {/* ── Unified Case Timeline ── */}
        <div className="cd-section">
          <div className="cd-section-title">
            Case History
            {logsRefreshing && <span style={{ fontWeight: 400, marginLeft: 8, color: '#94a3b8' }}>Refreshing…</span>}
          </div>
          {logs.length === 0 && escs.length === 0 ? (
            <div className="cd-no-logs">No activity recorded yet.</div>
          ) : (() => {
            const timeline = [
              ...logs.map(l => ({ _type: 'log', ...l })),
              ...escs.map(e => ({ _type: 'esc', ...e })),
            ].sort((a, b) => new Date(a.created) - new Date(b.created));
            return (
              <table className="cd-log-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 130 }}>Date &amp; Time</th>
                    <th style={{ minWidth: 100 }}>Event</th>
                    <th>Details</th>
                    <th style={{ minWidth: 120 }}>Status / EDC</th>
                    <th style={{ minWidth: 60  }}>By</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((row, i) => {
                    if (row._type === 'log') {
                      const sc = STATUS_COLORS[row.status] || 'blue';
                      // Prefer dedicated column, fall back to parsing remarks
                      const src = bufStr(row.fupdonevia) || extractSource(row.remarks);
                      const ss  = SOURCE_STYLES[src] || null;
                      const delayMain = bufStr(row.reasonfordelay);
                      const delaySub  = bufStr(row.subreasonfordelay);
                      const logEdc    = bufStr(row.closureinformdate);
                      const closedBy  = bufStr(row.caseclosedby);
                      // Fall back to remarks-extracted delay only if no dedicated column
                      const delayFallback = !delayMain ? extractDelay(row.remarks) : null;
                      const byName = bufStr(row.agentname) || bufStr(row.updatedby) || (row.uid ? `UID ${row.uid}` : 'CRM');
                      return (
                        <tr key={`log-${row.id || i}`}>
                          <td className="cd-log-date">{fmtDateTime(row.created)}</td>
                          <td>
                            {ss
                              ? <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700, background:ss.bg, color:ss.color, whiteSpace:'nowrap' }}>
                                  {ss.icon} {src}
                                </span>
                              : <span style={{ fontSize:11, color:'#94a3b8' }}>Update</span>
                            }
                          </td>
                          <td className="cd-log-remarks">
                            <div>{cleanRemarks(row.remarks)}</div>
                            {delayMain && (
                              <div style={{ marginTop:5 }}>
                                <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:10, fontWeight:700, background:'#fef3c7', color:'#92400e' }}>
                                  ⏳ {delayMain}{delaySub ? ` — ${delaySub}` : ''}
                                </span>
                              </div>
                            )}
                            {!delayMain && delayFallback && (
                              <div style={{ marginTop:5 }}>
                                <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:10, fontWeight:700, background:'#fef3c7', color:'#92400e' }}>
                                  ⏳ {delayFallback}
                                </span>
                              </div>
                            )}
                            {logEdc && (
                              <div style={{ marginTop:4, fontSize:11, color:'#6d28d9' }}>
                                📅 EDC — <strong>{fmtDate(logEdc)}</strong>
                              </div>
                            )}
                            {closedBy && (
                              <div style={{ marginTop:4, fontSize:11, color:'#16a34a' }}>
                                ✓ Closed by: <strong>{closedBy}</strong>
                              </div>
                            )}
                          </td>
                          <td><span className={`status-tag status-${sc}`}>{row.status || 'Open'}</span></td>
                          <td className="cd-log-by">{byName}</td>
                        </tr>
                      );
                    } else {
                      const level   = row.escalationlevel || (i + 1);
                      const hasEdc  = !!row.edc || !!row.closuredate;
                      const hasTkt  = !!row.ticketno;
                      const edcVal  = row.edc || row.closuredate;
                      return (
                        <tr key={`esc-${i}`} style={{ background: '#faf5ff' }}>
                          <td className="cd-log-date">{fmtDateTime(row.created)}</td>
                          <td>
                            <span className="cd-esc-level">↑ L{level} Escalation</span>
                          </td>
                          <td className="cd-log-remarks" style={{ color: '#6d28d9' }}>
                            {hasEdc  && <div>📅 EDC set to <strong>{fmtDate(edcVal)}</strong></div>}
                            {hasTkt  && <div>🎫 Vendor Ticket: <strong>{row.ticketno}</strong></div>}
                            {!hasEdc && !hasTkt && <span style={{ color:'#94a3b8' }}>Escalation recorded</span>}
                          </td>
                          <td className="cd-log-date">{hasEdc ? fmtDate(edcVal) : '—'}</td>
                          <td className="cd-log-by">{bufStr(row.agentname) || (row.uid ? `UID ${row.uid}` : 'CRM')}</td>
                        </tr>
                      );
                    }
                  })}
                </tbody>
              </table>
            );
          })()}
        </div>

        {/* ── Add Update ── */}
        <div className="cd-section">
          <button className="cd-update-toggle" onClick={() => setShowUpdate(v => !v)}>
            {showUpdate ? '▲ Hide Update Form' : '▼ Add Case Update'}
          </button>
          {showUpdate && (
            <div className="cd-uf">

              {/* ── 4 Action Buttons ── */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                {[
                  { key: 'update',        label: '✏ Update',        color: '#475569' },
                  { key: 'escalate',      label: '↑ Escalate',      color: '#d97706' },
                  { key: 'not-connected', label: '📵 Not Connected', color: '#7c3aed' },
                  { key: 'close',         label: '✓ Close',         color: '#16a34a' },
                ].map(({ key, label, color }) => (
                  <button key={key}
                    onClick={() => {
                      const next = updAction === key ? null : key;
                      setUpdAction(next);
                      setUpdDelayMain(''); setUpdDelaySub(''); setUpdClosedBy('');
                      if (next === 'not-connected') {
                        const d = new Date(); d.setDate(d.getDate() + 3);
                        setUpdEdc(d.toISOString().split('T')[0]);
                        setUpdSrc('Call');
                      } else if (next === 'update' || next === 'escalate') {
                        const sortedLogs   = [...(data.logs || [])].sort((a, b) => new Date(b.created) - new Date(a.created));
                        const latestLog    = sortedLogs[0];
                        const latestEdcLog = sortedLogs.find(l => l.closureinformdate);
                        const existingEdc  = c.edc || latestEdcLog?.closureinformdate || '';
                        setUpdEdc(existingEdc ? String(existingEdc).split('T')[0] : '');
                        const storedMain = bufStr(latestLog?.reasonfordelay) || '';
                        const storedSub  = bufStr(latestLog?.subreasonfordelay) || '';
                        setUpdDelayMain(storedMain);
                        setUpdDelaySub(matchDelaySub(storedSub, storedMain));
                      } else {
                        setUpdEdc('');
                      }
                      setUpdStatus(key === 'close' ? 'Closed' : key === 'not-connected' ? 'Not Connected' : 'Open');
                    }}
                    style={{ background: color, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: updAction && updAction !== key ? 0.4 : 1 }}>
                    {label}
                  </button>
                ))}
              </div>

              {updAction && (<>

                {/* Update Source */}
                <div className="cd-uf-row">
                  <span className="cd-uf-label">Update Source</span>
                  <div className="cd-uf-src-btns">
                    {['Call', 'Email Reply', 'Vendor Update'].map(s => (
                      <button key={s} className={`cd-uf-src-btn${updSrc === s ? ' active' : ''}`} onClick={() => setUpdSrc(s)}>
                        {s === 'Call' ? '📞' : s === 'Email Reply' ? '📧' : '🏭'} {s}
                      </button>
                    ))}
                  </div>
                </div>

                {updSrc === 'Call' && (
                  <div className="cd-uf-two-col">
                    <div className="cd-uf-field">
                      <label className="cd-uf-label">TXN / Call ID</label>
                      <input className="cd-uf-input" placeholder="SparkTG TXN ID" value={updTxnId} onChange={e => setUpdTxnId(e.target.value)} />
                    </div>
                    <div className="cd-uf-field">
                      <label className="cd-uf-label">Mobile Called</label>
                      <input className="cd-uf-input" placeholder="Number dialled" value={updMobile} onChange={e => setUpdMobile(e.target.value)} />
                    </div>
                  </div>
                )}
                {updSrc === 'Email Reply' && (
                  <div className="cd-uf-field">
                    <label className="cd-uf-label">Email Subject / Reference</label>
                    <input className="cd-uf-input" placeholder="Subject line of the email received" value={updEmailRef} onChange={e => setUpdEmailRef(e.target.value)} />
                  </div>
                )}
                {updSrc === 'Vendor Update' && (
                  <div className="cd-uf-field">
                    <label className="cd-uf-label">Vendor Ticket No</label>
                    <input className="cd-uf-input" placeholder="Vendor's ticket / reference number" value={updVendorTicket} onChange={e => setUpdVendorTicket(e.target.value)} />
                  </div>
                )}

                {/* Escalate / Not Connected — delay reason fields */}
                {(updAction === 'escalate' || updAction === 'not-connected' || updAction === 'update') && (
                  <div className="cd-uf-two-col">
                    <div className="cd-uf-field">
                      <label className="cd-uf-label">Delay Reason — Main</label>
                      <select className="cd-uf-select" value={updDelayMain} onChange={e => {
                        setUpdDelayMain(e.target.value); setUpdDelaySub('');
                        if (updAction === 'not-connected') { const d = new Date(); d.setDate(d.getDate() + 3); setUpdEdc(d.toISOString().split('T')[0]); }
                      }}>
                        <option value="">— Select —</option>
                        {Object.keys(DELAY_REASONS).map(k => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                    <div className="cd-uf-field">
                      <label className="cd-uf-label">Delay Reason — Sub</label>
                      <select className="cd-uf-select" value={updDelaySub} disabled={!updDelayMain} onChange={e => {
                        const sub = e.target.value;
                        setUpdDelaySub(sub);
                        const item = (DELAY_REASONS[updDelayMain] || []).find(r => r.label === sub);
                        if (item?.tat) { const d = new Date(); d.setDate(d.getDate() + item.tat); setUpdEdc(d.toISOString().split('T')[0]); }
                      }}>
                        <option value="">— Select —</option>
                        {(DELAY_REASONS[updDelayMain] || []).map(r => (
                          <option key={r.label} value={r.label}>{r.tat ? `${r.label} (${r.tat}d)` : r.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Close sub-type */}
                {updAction === 'close' && (
                  <div className="cd-uf-field">
                    <label className="cd-uf-label">Close Type</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {['Closed', 'Partially Closed'].map(s => (
                        <button key={s} onClick={() => setUpdStatus(s)}
                          style={{ padding: '6px 14px', borderRadius: 6, border: '2px solid', borderColor: updStatus === s ? '#16a34a' : '#e2e8f0', background: updStatus === s ? '#f0fdf4' : 'transparent', fontWeight: 600, fontSize: 12, cursor: 'pointer', color: updStatus === s ? '#15803d' : '#64748b' }}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* EDC — required for Escalate, Not Connected, and Close */}
                {(updAction === 'escalate' || updAction === 'not-connected' || updAction === 'close' || updAction === 'update') && (
                  <div className="cd-uf-field">
                    <label className="cd-uf-label">
                      {updAction === 'close' && updStatus === 'Closed' ? 'Date of Closure' : updAction === 'not-connected' ? 'New EDC (auto +3d)' : 'New EDC'}
                      <span style={{ color: '#dc2626' }}> *</span>
                    </label>
                    <input className="cd-uf-input" type="date" value={updEdc} onChange={e => setUpdEdc(e.target.value)} />
                  </div>
                )}

                {/* Closed By — only for full close */}
                {updAction === 'close' && updStatus === 'Closed' && (
                  <div className="cd-uf-field">
                    <label className="cd-uf-label">Case Closed By</label>
                    <input className="cd-uf-input" placeholder="Name of person who confirmed closure" value={updClosedBy} onChange={e => setUpdClosedBy(e.target.value)} />
                  </div>
                )}

                {/* Remarks — always */}
                <div className="cd-uf-field">
                  <label className="cd-uf-label">Remarks <span style={{ color: '#dc2626' }}>*</span></label>
                  <textarea className="cd-uf-textarea" rows={3}
                    placeholder={updAction === 'escalate' ? 'Reason for escalation, pending actions…' : updAction === 'close' ? 'Closure details, what was done…' : 'Update details, vendor response, next steps…'}
                    value={updRemarks} onChange={e => setUpdRemarks(e.target.value)} />
                </div>

                {updateMsg && <div className={`cd-uf-msg cd-uf-msg-${updateMsg.type}`}>{updateMsg.text}</div>}

                <button
                  className={`cd-uf-submit cd-uf-submit-${updAction === 'escalate' ? 'escalated' : updAction === 'close' ? 'closed' : updAction === 'not-connected' ? 'escalated' : 'open'}`}
                  onClick={() => {
                    if (!updRemarks.trim()) { showUpdMsg('Remarks are required', 'err'); return; }
                    if (!updEdc) { showUpdMsg('Date of closure (EDC) is required', 'err'); return; }
                    setConfirmPending(true);
                  }}
                  disabled={updating}>
                  {updating ? 'Saving…' : updAction === 'escalate' ? '↑ Escalate Complaint' : updAction === 'close' ? '✓ Close Complaint' : updAction === 'not-connected' ? '📵 Log Not Connected' : '✏ Save Update'}
                </button>

              </>)}
            </div>
          )}
        </div>


        {/* ── Footer stats ── */}
        <div className="cd-footer">
          <div className="cd-footer-stats">
            Total — {stats.total ?? logs.length} &nbsp;|&nbsp;
            Call — {stats.calls ?? 0} &nbsp;|&nbsp;
            Email — {stats.emails ?? 0}
          </div>
          <div className="cd-footer-tat">
            Actual TAT = {tatActual} Day{tatActual !== 1 ? 's' : ''}
          </div>
        </div>

      </div>
    </div>
  );
}
