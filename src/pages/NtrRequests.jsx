import { useState, useEffect, useRef } from 'react';
import { vmm } from '../api/vmm';
import './NtrRequests.css';

const STATUS = {
  pending:   { label: 'Pending Review', cls: 'ntr-st-pending' },
  escalated: { label: 'Escalated to HO', cls: 'ntr-st-escalated' },
  fulfilled: { label: 'Fulfilled', cls: 'ntr-st-fulfilled' },
};

const CSV_HEADERS = [
  'Item Article No.',
  'Item Name',
  'Last Received Date to store',
  'Last Received Qty in store',
  'Current stock',
  'Stock is for how many days',
  'Store Requirement',
  'HO-Admin Recommendation',
];

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function parseCSVText(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const rows = lines.slice(1).map(line => {
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQ = !inQ; continue; }
      if (line[i] === ',' && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
      cur += line[i];
    }
    cols.push(cur.trim());
    return cols;
  }).filter(r => r.some(c => c));
  return { headers, rows };
}

function downloadCsvList(req, items) {
  const rows = items.map(i => [
    i.item_article_no, i.item_name, i.last_received_date,
    i.last_received_qty, i.current_stock, i.stock_days,
    i.store_requirement, i.ho_recommendation,
  ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','));
  const csv = [CSV_HEADERS.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `NTR_${req.store_code}_${req.request_date || 'export'}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

function downloadTemplate() {
  const csv = CSV_HEADERS.join(',') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'NTR_Upload_Template.csv';
  a.click(); URL.revokeObjectURL(url);
}

export default function NtrRequests() {
  // ── List mode state ──────────────────────────────────────
  const [requests,     setRequests]     = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [selected,     setSelected]     = useState(null);
  const [items,        setItems]        = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // ── Mode ─────────────────────────────────────────────────
  const [mode, setMode] = useState('list'); // 'list' | 'upload'

  // ── Upload state ─────────────────────────────────────────
  const [uploadStep,      setUploadStep]      = useState('form'); // 'form' | 'preview' | 'done'
  const [storeCode,       setStoreCode]       = useState('');
  const [storeInfo,       setStoreInfo]       = useState(null);
  const [storeStatus,     setStoreStatus]     = useState('idle'); // idle | loading | found | error
  const [requestDate,     setRequestDate]     = useState(todayISO());
  const [csvRows,         setCsvRows]         = useState([]);
  const [validating,      setValidating]      = useState(false);
  const [validItems,      setValidItems]      = useState([]);
  const [invalidItems,    setInvalidItems]    = useState([]);
  const [submitting,      setSubmitting]      = useState(false);
  const [savedReqNo,      setSavedReqNo]      = useState('');
  const fileRef = useRef(null);

  // ── Toast ─────────────────────────────────────────────────
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── List mode functions ──────────────────────────────────
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

  // ── Upload mode functions ────────────────────────────────
  const lookupStore = async (code) => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setStoreStatus('loading');
    try {
      const res = await vmm.lookupStore(c);
      if (res?.found && res.store) {
        setStoreInfo(res.store);
        setStoreStatus('found');
      } else {
        setStoreInfo(null);
        setStoreStatus('error');
      }
    } catch {
      setStoreInfo(null);
      setStoreStatus('error');
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const { headers, rows } = parseCSVText(text);

    if (headers.length < 1 || rows.length === 0) {
      showToast('CSV is empty or invalid', 'err');
      return;
    }

    // Map rows to item objects
    const items = rows.map(r => ({
      articleNo:        String(r[0] || '').trim(),
      itemName:         String(r[1] || '').trim(),
      lastReceivedDate: String(r[2] || '').trim(),
      lastReceivedQty:  String(r[3] || '').trim(),
      currentStock:     String(r[4] || '').trim(),
      stockDays:        String(r[5] || '').trim(),
      storeRequirement: String(r[6] || '').trim(),
      hoRecommendation: String(r[7] || '').trim(),
    })).filter(i => i.articleNo);

    if (items.length === 0) {
      showToast('No article numbers found in CSV', 'err');
      return;
    }

    setCsvRows(items);
    setValidating(true);

    try {
      const res = await vmm.validateNtrArticles(items);
      setValidItems(res.valid  || []);
      setInvalidItems(res.invalid || []);
      setUploadStep('preview');
    } catch {
      showToast('Could not validate articles — check n8n', 'err');
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!storeInfo || validItems.length === 0) return;
    setSubmitting(true);
    try {
      // 1. Save NTR to MySQL
      const saveRes = await vmm.saveNtr({
        storeCode:    storeInfo.code || storeCode.toUpperCase(),
        storeName:    storeInfo.name,
        requestDate,
        receivedDate: todayISO(),
        totalItems:   validItems.length,
        items:        validItems,
      });

      const reqNo = saveRes.requestNo || '';
      setSavedReqNo(reqNo);

      // 2. Fetch master XLSX from Google Drive via n8n
      let attachmentBase64 = '';
      try {
        const xlsxRes = await vmm.fetchNtrMasterXlsx();
        attachmentBase64 = xlsxRes.base64 || '';
      } catch {
        // Non-fatal — email sends without attachment if fetch fails
      }

      // 3. Send confirmation email via Graph API (same path as escalation emails)
      await vmm.sendNtrEmail({
        storeEmail:      storeInfo.email || storeInfo.storeEmail || '',
        storeName:       storeInfo.name,
        storeCode:       storeInfo.code || storeCode.toUpperCase(),
        requestNo:       reqNo,
        invalidItems,
        attachmentBase64,
      });

      setUploadStep('done');
      load(); // refresh list
    } catch (err) {
      showToast('Error saving NTR — ' + (err?.message || 'check n8n'), 'err');
    } finally {
      setSubmitting(false);
    }
  };

  const resetUpload = () => {
    setUploadStep('form');
    setStoreCode('');
    setStoreInfo(null);
    setStoreStatus('idle');
    setRequestDate(todayISO());
    setCsvRows([]);
    setValidItems([]);
    setInvalidItems([]);
    setSavedReqNo('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const st = selected ? (STATUS[selected.status] || STATUS.pending) : null;

  // ────────────────────────────────────────────────────────
  return (
    <div className="ntr-page">
      {toast && <div className={`ntr-toast ntr-toast--${toast.type}`}>{toast.msg}</div>}

      {/* ── Header ── */}
      <div className="ntr-header">
        <div>
          <h1 className="ntr-title">Non-Trading Requests</h1>
          <p className="ntr-subtitle">Store consumable supply requests</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {mode === 'list' ? (
            <>
              <button className="ntr-btn-ghost" onClick={load} disabled={loading}>
                {loading ? '⟳ Loading…' : '⟳ Refresh'}
              </button>
              <button className="ntr-btn-primary" onClick={() => { resetUpload(); setMode('upload'); }}>
                + Upload NTR
              </button>
            </>
          ) : (
            <button className="ntr-btn-ghost" onClick={() => { setMode('list'); resetUpload(); }}>
              ← Back to List
            </button>
          )}
        </div>
      </div>

      {/* ══════════════ LIST MODE ══════════════ */}
      {mode === 'list' && (
        <div className="ntr-layout">

          {/* Left: request cards */}
          <div className="ntr-left">
            {loading && <div className="ntr-empty">Loading…</div>}
            {!loading && requests.length === 0 && (
              <div className="ntr-empty">
                No NTR requests yet.<br />
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Upload an NTR to get started.</span>
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
                    <span>Req No: <strong>{r.request_no || '—'}</strong></span>
                    <span className="ntr-item-count">{r.total_items || 0} items</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: detail */}
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
                      <span>Request No: <strong>{selected.request_no || '—'}</strong></span>
                      <span>Request date: <strong>{selected.request_date || '—'}</strong></span>
                      <span>Received: <strong>{selected.received_date || '—'}</strong></span>
                    </div>
                  </div>
                  <div className="ntr-detail-actions">
                    {st && <span className={`ntr-status-pill ${st.cls}`}>{st.label}</span>}
                    <button
                      className="ntr-btn-ghost"
                      onClick={() => downloadCsvList(selected, items)}
                      disabled={loadingItems || items.length === 0}
                    >↓ Download CSV</button>
                  </div>
                </div>
                <div className="ntr-table-wrap">
                  {loadingItems ? (
                    <div className="ntr-empty">Loading items…</div>
                  ) : items.length === 0 ? (
                    <div className="ntr-empty">No items found.</div>
                  ) : (
                    <table className="ntr-table">
                      <thead>
                        <tr>
                          <th>#</th><th>Article No.</th><th>Item Name</th>
                          <th>Last Received</th><th>Last Qty</th><th>Stock</th>
                          <th>Days</th><th>Store Req.</th><th>HO Recommendation</th>
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
      )}

      {/* ══════════════ UPLOAD MODE ══════════════ */}
      {mode === 'upload' && (
        <div className="ntr-upload-panel">

          {/* ── STEP: form ── */}
          {uploadStep === 'form' && (
            <div className="ntr-upload-card">
              <div className="ntr-upload-card-title">Upload Non-Trading Request</div>

              {/* Store lookup */}
              <div className="ntr-form-group">
                <label className="ntr-form-label">Store Code</label>
                <div className="ntr-store-row">
                  <input
                    className="ntr-form-input"
                    placeholder="e.g. HY04"
                    value={storeCode}
                    onChange={e => { setStoreCode(e.target.value.toUpperCase()); setStoreInfo(null); setStoreStatus('idle'); }}
                    onBlur={() => lookupStore(storeCode)}
                    style={{ width: 140 }}
                  />
                  {storeStatus === 'loading' && <span className="ntr-store-hint">Searching…</span>}
                  {storeStatus === 'found'   && storeInfo && (
                    <span className="ntr-store-found">
                      ✓ {storeInfo.name}
                      {storeInfo.email || storeInfo.storeEmail
                        ? <span className="ntr-store-email"> — {storeInfo.email || storeInfo.storeEmail}</span>
                        : null}
                    </span>
                  )}
                  {storeStatus === 'error'   && <span className="ntr-store-error">Store not found</span>}
                </div>
              </div>

              {/* Request date */}
              <div className="ntr-form-group">
                <label className="ntr-form-label">Date of Request</label>
                <input
                  type="date"
                  className="ntr-form-input"
                  value={requestDate}
                  onChange={e => setRequestDate(e.target.value)}
                  style={{ width: 180 }}
                />
              </div>

              {/* Template download + file upload */}
              <div className="ntr-form-group">
                <label className="ntr-form-label">Upload CSV</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button className="ntr-btn-ghost" style={{ width: 'fit-content' }} onClick={downloadTemplate}>
                    ↓ Download CSV Template
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv"
                    className="ntr-file-input"
                    disabled={!storeInfo || validating}
                    onChange={handleFileChange}
                  />
                  {!storeInfo && <span className="ntr-hint-text">Enter store code first</span>}
                  {validating && <span className="ntr-hint-text">Validating articles against master file…</span>}
                </div>
              </div>

              <div className="ntr-form-note">
                CSV columns: Article No., Item Name, Last Received Date, Last Received Qty, Current Stock, Stock Days, Store Requirement, HO-Admin Recommendation
              </div>
            </div>
          )}

          {/* ── STEP: preview ── */}
          {uploadStep === 'preview' && (
            <div className="ntr-upload-card ntr-preview-card">
              <div className="ntr-upload-card-title">Preview &amp; Confirm</div>

              {storeInfo && (
                <div className="ntr-preview-meta">
                  <span><strong>Store:</strong> {storeInfo.name} ({storeInfo.code || storeCode})</span>
                  <span><strong>Date:</strong> {requestDate}</span>
                  <span><strong>Email TO:</strong> {storeInfo.email || storeInfo.storeEmail || '—'}</span>
                  <span><strong>CC:</strong> Pooja@vishalretail.co.in</span>
                </div>
              )}

              {/* Summary chips */}
              <div className="ntr-preview-summary">
                <div className="ntr-summary-chip ntr-summary-valid">
                  <span className="ntr-summary-count">{validItems.length}</span>
                  <span className="ntr-summary-label">Valid articles — will be logged</span>
                </div>
                <div className="ntr-summary-chip ntr-summary-invalid">
                  <span className="ntr-summary-count">{invalidItems.length}</span>
                  <span className="ntr-summary-label">Not in master — will appear in email only</span>
                </div>
              </div>

              {/* Valid items table */}
              {validItems.length > 0 && (
                <div className="ntr-preview-section">
                  <div className="ntr-preview-section-title">Articles to be logged ({validItems.length})</div>
                  <div className="ntr-table-wrap">
                    <table className="ntr-table">
                      <thead>
                        <tr>
                          <th>#</th><th>Article No.</th><th>Item Name</th>
                          <th>Category</th><th>Last Received</th><th>Stock</th>
                          <th>Store Req.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validItems.map((item, idx) => (
                          <tr key={idx} className={idx % 2 ? 'ntr-row-alt' : ''}>
                            <td className="ntr-td-num">{idx + 1}</td>
                            <td className="ntr-td-article">{item.articleNo}</td>
                            <td className="ntr-td-name">{item.itemName}</td>
                            <td style={{ fontSize: 11, color: '#64748b' }}>{item.category || '—'}</td>
                            <td className="ntr-td-date">{item.lastReceivedDate || '—'}</td>
                            <td className="ntr-td-num">{item.currentStock || '—'}</td>
                            <td className="ntr-td-req">{item.storeRequirement || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Invalid items */}
              {invalidItems.length > 0 && (
                <div className="ntr-preview-section">
                  <div className="ntr-preview-section-title ntr-invalid-title">
                    Not found in master — will appear in email ({invalidItems.length})
                  </div>
                  <div className="ntr-invalid-list">
                    {invalidItems.map((item, idx) => (
                      <div key={idx} className="ntr-invalid-item">
                        <span className="ntr-invalid-artno">{item.articleNo}</span>
                        <span className="ntr-invalid-name">{item.itemName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="ntr-preview-actions">
                <button
                  className="ntr-btn-ghost"
                  onClick={() => { setUploadStep('form'); if (fileRef.current) fileRef.current.value = ''; }}
                  disabled={submitting}
                >
                  ← Back
                </button>
                <button
                  className="ntr-btn-primary"
                  onClick={handleSubmit}
                  disabled={submitting || validItems.length === 0}
                >
                  {submitting ? 'Saving…' : `Confirm & Submit (${validItems.length} items)`}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: done ── */}
          {uploadStep === 'done' && (
            <div className="ntr-upload-card ntr-success-card">
              <div className="ntr-success-icon">✓</div>
              <div className="ntr-success-title">NTR Logged Successfully</div>
              <div className="ntr-success-reqno">{savedReqNo}</div>
              <p className="ntr-success-sub">
                Request saved to database and confirmation email sent to store (TO: {storeInfo?.email || storeInfo?.storeEmail || '—'}, CC: Pooja@vishalretail.co.in).
              </p>
              <div className="ntr-success-actions">
                <button className="ntr-btn-ghost" onClick={resetUpload}>
                  Log Another Request
                </button>
                <button className="ntr-btn-primary" onClick={() => { setMode('list'); resetUpload(); }}>
                  View All Requests
                </button>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
