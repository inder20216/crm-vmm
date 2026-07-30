import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { vmm } from '../api/vmm';
import { useAuth } from '../context/AuthContext';
import './DialerPanel.css';

const WIDGET_URL = import.meta.env.VITE_SPARKTG_WIDGET_URL || '';

function normalizePhone(raw) {
  if (!raw) return '';
  const s = (raw || '').replace(/[\s\-()]/g, '');
  if (/^\+91(\d{10})$/.test(s)) return s.slice(3);
  if (/^91(\d{10})$/.test(s))   return s.slice(2);
  if (/^0(\d{10})$/.test(s))    return s.slice(1);
  return s;
}

export default function DialerPanel() {
  if (!WIDGET_URL) return null;

  const { currentUser } = useAuth();
  const navigate        = useNavigate();
  const iframeRef       = useRef(null);
  const hasAutoSso      = useRef(false);
  const pendingOutbound = useRef(false);

  const [open,       setOpen]       = useState(false);
  const [ready,      setReady]      = useState(false);
  const [ssoStatus,  setSsoStatus]  = useState('pending');
  const [callState,  setCallState]  = useState(null);
  const [callerInfo, setCallerInfo] = useState(null);
  const [lookingUp,  setLookingUp]  = useState(false);

  const sendToWidget = useCallback((event, data = {}) => {
    iframeRef.current?.contentWindow?.postMessage({ event, data }, '*');
  }, []);

  useEffect(() => {
    const onMessage = (ev) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object' || !msg.event) return;
      const { event, data } = msg;

      switch (event) {
        case 'ready_for_events':
          setReady(true);
          if (!hasAutoSso.current && currentUser?.email) {
            hasAutoSso.current = true;
            sendToWidget('login_sso_email', { email: currentUser.email, force: true });
          }
          break;

        case 'login_sso_complete':
          setSsoStatus(data?.status === 'success' ? 'success' : 'failed');
          break;

        case 'show_dialer': {
          const isOutbound = pendingOutbound.current;
          pendingOutbound.current = false;
          const phone = normalizePhone(data?.caller?.phone || '');
          setCallState({ phone, callId: data?.callId || null, direction: isOutbound ? 'outbound' : 'inbound', ended: false });
          setOpen(true);
          if (!isOutbound && phone) {
            setCallerInfo(null);
            setLookingUp(true);
            vmm.lookupCaller(phone)
              .then(res => setCallerInfo(res))
              .catch(() => setCallerInfo({ found: false, mobile: phone, error: true }))
              .finally(() => setLookingUp(false));
          }
          break;
        }

        case 'hide_dialer':
          setCallState(prev => prev ? { ...prev, ended: true } : null);
          break;

        default: break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sendToWidget, currentUser?.email]);

  const handleDial = useCallback((numberToDial) => {
    const raw = (numberToDial || '').replace(/\D/g, '');
    if (!raw || raw.length < 6) return;
    const phone = raw.length === 10 ? `+91${raw}` : raw;
    pendingOutbound.current = true;
    sendToWidget('click_to_call', { phone });
    setCallState({ phone: raw, callId: null, direction: 'outbound', ended: false });
    setOpen(true);
  }, [sendToWidget]);

  useEffect(() => {
    window.__vmmDial = handleDial;
    return () => { delete window.__vmmDial; };
  }, [handleDial]);

  const dismissCall = () => { setCallState(null); setCallerInfo(null); };
  const openComplaint = (id) => { navigate(`/complaints/${id}`); dismissCall(); };

  const statusClass = ready && ssoStatus === 'success' ? 'dp-dot--green'
    : ready ? 'dp-dot--yellow'
    : 'dp-dot--grey';

  return (
    <>
      {/* ── Incoming call popup ── */}
      {callState && callState.direction === 'inbound' && !callState.ended && (
        <div className="dp-incoming-overlay">
          <div className="dp-incoming-card">
            <div className="dp-incoming-header">
              <div className="dp-ring-icon">📞</div>
              <div>
                <div className="dp-incoming-label">Incoming Call</div>
                <div className="dp-incoming-number">{callState.phone || 'Unknown'}</div>
              </div>
              <button className="dp-incoming-dismiss" onClick={dismissCall}>✕</button>
            </div>

            {lookingUp && <div className="dp-lookup-hint">Looking up caller…</div>}

            {callerInfo && !lookingUp && (
              callerInfo.found ? (
                <div className="dp-caller-info">
                  <div className="dp-caller-store">
                    <strong>{callerInfo.store?.storeName}</strong>
                    <span className="dp-caller-code">{callerInfo.store?.storeCode}</span>
                  </div>
                  {callerInfo.store?.smName      && <div className="dp-caller-contact">SM: {callerInfo.store.smName}</div>}
                  {callerInfo.store?.managerName && <div className="dp-caller-contact">Manager: {callerInfo.store.managerName}</div>}
                  {callerInfo.complaints?.length > 0 ? (
                    <div className="dp-open-complaints">
                      <div className="dp-complaints-label">Open complaints ({callerInfo.openCount})</div>
                      <div className="dp-complaints-list">
                        {callerInfo.complaints.map(cmp => (
                          <button key={cmp.id} className="dp-complaint-row" onClick={() => openComplaint(cmp.id)}>
                            <span className="dp-cno">{cmp.complaintno}</span>
                            <span className="dp-cprod">{cmp.productname}</span>
                            <span className="dp-cstatus">{cmp.currentStatus || 'Open'}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="dp-no-complaints">No open complaints for this store</div>
                  )}
                </div>
              ) : (
                <div className="dp-caller-unknown">
                  {callerInfo.error ? 'Could not look up caller' : 'No store found for this number'}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* ── SparkTG iframe — always in DOM so it receives events even when hidden ── */}
      <iframe
        ref={iframeRef}
        src={WIDGET_URL}
        allow="microphone; camera; autoplay; speaker-selection"
        title="SparkTG Dialer"
        className={`dp-stg-iframe${open ? ' dp-stg-iframe--visible' : ''}`}
      />

      {/* ── Toggle FAB ── */}
      <button
        className="dp-fab"
        onClick={() => setOpen(o => !o)}
        title={open ? 'Hide Dialer' : 'Open Dialer'}
      >
        <span>📞</span>
        <span className={`dp-dot ${statusClass}`} />
      </button>
    </>
  );
}
