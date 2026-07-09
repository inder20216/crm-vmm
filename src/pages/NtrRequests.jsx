import { useState, useEffect } from 'react';
import { vmm } from '../api/vmm';
import './NtrRequests.css';

const STATUS = {
  pending:   { label: 'Pending Review', cls: 'ntr-st-pending' },
  escalated: { label: 'Escalated to HO', cls: 'ntr-st-escalated' },
  fulfilled: { label: 'Fulfilled', cls: 'ntr-st-fulfilled' },
};

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

function downloadCsv(req, items) {
  const headers = [
    'Item Article No.', 'Item Name', 'Last Received Date to store',
    'Last Received Qty in store', 'Current stock', 'Stock is for how many days',
    'Store Requirement', 'HO-Admin Recommendation',
  ];
  const rows = items.map(i => [
    i.item_article_no, i.item_name, i.last_received_date,
    i.last_received_qty, i.current_stock, i.stock_days,
    i.store_requirement, i.ho_recommendation,
  ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','));

  const csv = [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `NTR_${req.store_code}_${req.request_date || req.received_date || 'export'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function NtrRequests() {
  const [requests,     setRequests]     = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [selected,     setSelected]     = useState(null);
  const [items,        setItems]        = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [toast,        setToast]        = useState(null);

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = () => {
    setLoading(true);
    vmm.listNtr()
      .then(res => setRequests(res.requests || []))
      .catch(() => showToast('Could not load NTR requests', 'err'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selected) { setItems([]); return; }
    setLoadingItems(true);
    vmm.getNtrItems(selected.id)
      .then(res => setItems(res.items || []))
      .catch(() => showToast('Could not load items', 'err'))
      .finally(() => setLoadingItems(false));
  }, [selected?.id]);

  const st = selected ? (STATUS[selected.status] || STATUS.pending) : null;

  return (
    <div className="ntr-page">
      {toast && <div className={`ntr-toast ntr-toast--${toast.type}`}>{toast.msg}</div>}

      <div className="ntr-header">
        <div>
          <h1 className="ntr-title">Non-Trading Requests</h1>
          <p className="ntr-subtitle">Store supply requests — auto-processed from email</p>
        </div>
        <button className="ntr-btn-ghost" onClick={load} disabled={loading}>
          {loading ? '⟳ Loading…' : '⟳ Refresh'}
        </button>
      </div>

      <div className="ntr-layout">

        {/* ── LEFT: request list ── */}
        <div className="ntr-left">
          {loading && <div className="ntr-empty">Loading…</div>}
          {!loading && requests.length === 0 && (
            <div className="ntr-empty">
              No NTR requests yet.<br />
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                The system checks the inbox every 5 min and processes emails automatically.
              </span>
            </div>
          )}
          {requests.map(r => {
            const s = STATUS[r.status] || STATUS.pending;
            return (
              <div
                key={r.id}
                className={`ntr-card${selected?.id === r.id ? ' active' : ''}`}
                onClick={() => setSelected(r)}
              >
                <div className="ntr-card-top">
                  <span className="ntr-store-badge">{r.store_code}</span>
                  <span className={`ntr-status-pill ${s.cls}`}>{s.label}</span>
                  <span className="ntr-card-date">{fmtDate(r.created_at)}</span>
                </div>
                <div className="ntr-card-store">{r.store_name || '—'}</div>
                <div className="ntr-card-meta">
                  <span>Request: <strong>{r.request_date || '—'}</strong></span>
                  <span>Received: <strong>{r.received_date || '—'}</strong></span>
                  <span className="ntr-item-count">{r.total_items || 0} items</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── RIGHT: detail ── */}
        <div className="ntr-right">
          {!selected ? (
            <div className="ntr-no-select">
              <div className="ntr-no-select-icon">📦</div>
              <p>Select a request to view its items</p>
            </div>
          ) : (
            <>
              <div className="ntr-detail-header">
                <div className="ntr-detail-info">
                  <div className="ntr-detail-store">
                    {selected.store_name || selected.store_code}
                    <span className="ntr-store-code-chip">{selected.store_code}</span>
                  </div>
                  <div className="ntr-detail-meta-row">
                    <span>Request date: <strong>{selected.request_date || '—'}</strong></span>
                    <span>Received: <strong>{selected.received_date || '—'}</strong></span>
                    <span>From: <strong>{selected.email_from || '—'}</strong></span>
                  </div>
                  <div className="ntr-detail-subject">{selected.email_subject}</div>
                </div>
                <div className="ntr-detail-actions">
                  {st && <span className={`ntr-status-pill ${st.cls}`}>{st.label}</span>}
                  <button
                    className="ntr-btn-ghost"
                    onClick={() => downloadCsv(selected, items)}
                    disabled={loadingItems || items.length === 0}
                  >
                    ↓ Download CSV
                  </button>
                </div>
              </div>

              <div className="ntr-table-wrap">
                {loadingItems ? (
                  <div className="ntr-empty">Loading items…</div>
                ) : items.length === 0 ? (
                  <div className="ntr-empty">No items found for this request.</div>
                ) : (
                  <table className="ntr-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Article No.</th>
                        <th>Item Name</th>
                        <th>Last Received</th>
                        <th>Last Qty</th>
                        <th>Stock</th>
                        <th>Days</th>
                        <th>Store Req.</th>
                        <th>HO Recommendation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => (
                        <tr key={item.id || idx} className={idx % 2 ? 'ntr-row-alt' : ''}>
                          <td className="ntr-td-num">{idx + 1}</td>
                          <td className="ntr-td-article">{item.item_article_no || '—'}</td>
                          <td className="ntr-td-name">{item.item_name || '—'}</td>
                          <td className="ntr-td-date">{item.last_received_date || '—'}</td>
                          <td className="ntr-td-num">{item.last_received_qty || '—'}</td>
                          <td className="ntr-td-num">{item.current_stock || '—'}</td>
                          <td className="ntr-td-num">{item.stock_days || '—'}</td>
                          <td className="ntr-td-req">{item.store_requirement || '—'}</td>
                          <td className="ntr-td-ho">{item.ho_recommendation || <span className="ntr-td-empty">Pending</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
