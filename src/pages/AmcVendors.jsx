import { useMemo, useState, useEffect } from 'react';
import { vmm } from '../api/vmm';
import { useAmcVendors, refreshAmcVendors } from '../hooks/useAmcVendors';
import { AMC_SERVICE_TYPES } from '../data/amcVendors';
import './AmcVendors.css';

const STORAGE_KEY = 'vmm_amc_vendors_local_edits';

const TYPE_CLASS = {
  'AC AMC':           'ac',
  'Lift AMC':         'lift',
  'Pest Control AMC': 'pest',
};

const EDITABLE_FIELDS = ['storeName', 'vendorName', 'vendorEmail', 'vendorPhone'];

function localEdits() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function applyLocalEdits(rows) {
  const edits = localEdits();
  return rows.map(r => edits[r.id] ? { ...r, ...edits[r.id], edited: true } : { ...r });
}

export default function AmcVendors() {
  const { rows: fetchedRows, source, loading } = useAmcVendors();
  const [rowsData, setRowsData] = useState(() => applyLocalEdits(fetchedRows));
  const [activeType, setActiveType] = useState('All');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ storeName: '', vendorName: '', vendorEmail: '', vendorPhone: '' });
  const [saveErr, setSaveErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRowsData(applyLocalEdits(fetchedRows));
  }, [fetchedRows]);

  // Keep browser-local edits only as a fallback if the SQL API is unavailable.
  useEffect(() => {
    try {
      const edits = {};
      rowsData.filter(r => r.edited).forEach(r => {
        edits[r.id] = Object.fromEntries(EDITABLE_FIELDS.map(k => [k, r[k] || '']));
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
    } catch { /* storage unavailable — edits still live for this session */ }
  }, [rowsData]);

  const counts = useMemo(() => ({
    All: rowsData.length,
    ...Object.fromEntries(AMC_SERVICE_TYPES.map(t => [
      t, rowsData.filter(r => r.serviceType === t).length,
    ])),
  }), [rowsData]);

  const editedCount = rowsData.filter(r => r.edited).length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rowsData
      .filter(r => activeType === 'All' || r.serviceType === activeType)
      .filter(r => !q ||
        r.storeCode.toLowerCase().includes(q) ||
        (r.storeName || '').toLowerCase().includes(q) ||
        r.vendorName.toLowerCase().includes(q) ||
        (r.vendorEmail || '').toLowerCase().includes(q))
      .sort((a, b) =>
        AMC_SERVICE_TYPES.indexOf(a.serviceType) - AMC_SERVICE_TYPES.indexOf(b.serviceType) ||
        a.storeCode.localeCompare(b.storeCode));
  }, [rowsData, activeType, query]);

  const editingRow = rowsData.find(r => r.id === editingId);

  const openEdit = (r) => {
    setEditingId(r.id);
    setForm(Object.fromEntries(EDITABLE_FIELDS.map(k => [k, r[k] || ''])));
    setSaveErr('');
  };

  const saveEdit = async () => {
    if (!form.vendorName.trim()) {
      setSaveErr('Vendor name is required.');
      return;
    }
    const payload = {
      storeCode: editingRow.storeCode,
      serviceType: editingRow.serviceType,
      ...form,
      vendorName: form.vendorName.trim(),
    };
    setSaving(true);
    setSaveErr('');
    try {
      const saved = await vmm.saveAmcVendor(payload);
      setRowsData(prev => prev.map(r => r.id === editingRow.id ? { ...saved, edited: false } : r));
      await refreshAmcVendors();
      setEditingId(null);
    } catch (err) {
      setRowsData(prev => prev.map(r => r.id === editingRow.id
        ? { ...r, ...form, vendorName: form.vendorName.trim(), edited: true }
        : r));
      setSaveErr(`SQL save failed (${err.message}). Kept locally instead.`);
    } finally {
      setSaving(false);
    }
  };

  const resetEdits = async () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    const fresh = await refreshAmcVendors();
    setRowsData(fresh.rows.map(r => ({ ...r })));
  };

  return (
    <div className="avm-page">
      <div className="avm-header">
        <div>
          <h2>AMC Vendors</h2>
          <p>Store-wise vendors — AC AMC, Lift AMC and Pest Control AMC only</p>
        </div>
        <div className="avm-header-right">
          {editedCount > 0 && (
            <>
              <span className="avm-edited-count">{editedCount} local edit{editedCount > 1 ? 's' : ''}</span>
              <button type="button" className="avm-reset" onClick={resetEdits}>Reset edits</button>
            </>
          )}
          <span className={`avm-source ${source === 'sql' ? 'live' : 'fallback'}`}>
            {source === 'sql' ? '● Live SQL' : '● Local fallback'}
          </span>
          <span className="avm-total">{counts.All} records</span>
        </div>
      </div>

      <div className="avm-toolbar">
        <div className="avm-tabs" role="tablist" aria-label="AMC service type">
          {['All', ...AMC_SERVICE_TYPES].map(t => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={activeType === t}
              className={`avm-tab ${activeType === t ? 'active' : ''}`}
              onClick={() => setActiveType(t)}
            >
              {t}
              <span className="avm-tab-count">{counts[t] || 0}</span>
            </button>
          ))}
        </div>
        <input
          className="avm-search"
          type="search"
          placeholder="Search store code, vendor or email…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      <div className="avm-note">
        Source table <code>vmm_amc_vendors</code> — restricted to three approved service types.
        Showing {rows.length} of {counts.All} records.
        {loading ? ' Loading live data…' : source === 'sql'
          ? ' Edits save directly to SQL.'
          : ' SQL unavailable — showing the local fallback copy.'}
      </div>

      <div className="avm-card">
        {rows.length === 0 ? (
          <div className="avm-empty">
            <div className="avm-empty-icon">🏭</div>
            <strong>No AMC vendors found</strong>
            <span>
              {query || activeType !== 'All'
                ? 'Try a different filter or search term.'
                : 'No store-wise vendor records are configured for this service type yet.'}
            </span>
          </div>
        ) : (
          <div className="avm-table-wrap">
            <table className="avm-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Store Code</th>
                  <th>Store Name</th>
                  <th>Service Type</th>
                  <th>Vendor Name</th>
                  <th>Vendor Email</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className={i % 2 ? 'avm-row-alt' : ''}>
                    <td className="avm-num">{i + 1}</td>
                    <td className="avm-code">{r.storeCode}</td>
                    <td>{r.storeName || <span className="avm-muted">—</span>}</td>
                    <td>
                      <span className={`avm-badge avm-badge-${TYPE_CLASS[r.serviceType] || 'ac'}`}>
                        {r.serviceType}
                      </span>
                    </td>
                    <td className="avm-vendor">
                      {r.vendorName || <span className="avm-muted">—</span>}
                      {r.edited && <span className="avm-edited-tag" title="Saved locally only">local edit</span>}
                    </td>
                    <td className="avm-email">{r.vendorEmail || <span className="avm-muted">—</span>}</td>
                    <td>
                      <button type="button" className="avm-edit" onClick={() => openEdit(r)}>
                        ✎ Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingRow && (
        <div
          className="avm-modal-overlay"
          onMouseDown={e => { if (e.target === e.currentTarget) setEditingId(null); }}
        >
          <div className="avm-modal" role="dialog" aria-modal="true" aria-label="Edit AMC vendor">
            <div className="avm-modal-head">
              <div>
                <h3>Edit AMC Vendor</h3>
                <p>{editingRow.storeCode} · {editingRow.serviceType}</p>
              </div>
              <button type="button" className="avm-modal-close" onClick={() => setEditingId(null)} aria-label="Close">×</button>
            </div>
            <div className="avm-modal-body">
              <div className="avm-field">
                <label>Store code</label>
                <input value={editingRow.storeCode} disabled />
              </div>
              <div className="avm-field">
                <label>Service type</label>
                <input value={editingRow.serviceType} disabled />
              </div>
              <div className="avm-field">
                <label>Store name</label>
                <input value={form.storeName} placeholder="e.g. Uttarkashi"
                  onChange={e => setForm(f => ({ ...f, storeName: e.target.value }))} />
              </div>
              <div className="avm-field">
                <label>Vendor name <span className="avm-req">*</span></label>
                <input value={form.vendorName} placeholder="Vendor / contractor name"
                  onChange={e => setForm(f => ({ ...f, vendorName: e.target.value }))} />
              </div>
              <div className="avm-field">
                <label>Vendor email</label>
                <input type="email" value={form.vendorEmail} placeholder="name@company.com"
                  onChange={e => setForm(f => ({ ...f, vendorEmail: e.target.value }))} />
              </div>
              <div className="avm-field">
                <label>Vendor phone</label>
                <input value={form.vendorPhone} placeholder="10-digit number"
                  onChange={e => setForm(f => ({ ...f, vendorPhone: e.target.value }))} />
              </div>
              {saveErr && <p className="avm-err">{saveErr}</p>}
            </div>
            <div className="avm-modal-actions">
              <button type="button" className="avm-btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
              <button type="button" className="avm-btn-primary" onClick={saveEdit} disabled={saving}>
                {saving ? 'Saving to SQL…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
