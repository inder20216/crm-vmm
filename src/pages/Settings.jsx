import { useEffect, useState } from 'react';
import { vmm } from '../api/vmm';
import { FALLBACK_DELAY_REASONS } from '../data/delayReasons';
import { mergeNatures } from '../data/natures';
import './Settings.css';

const NATURE_TYPES = ['Repair', 'Warranty', 'AMC', 'Preventive Maintenance', 'On-demand'];

function bufStr(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) {
    try { return new TextDecoder().decode(new Uint8Array(v.data)); } catch { return ''; }
  }
  return String(v);
}

export default function Settings() {
  const [tab, setTab] = useState('nature');
  const [natures, setNatures] = useState([]);
  const [delay, setDelay] = useState(FALLBACK_DELAY_REASONS);
  const [complaintTypes, setComplaintTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);

  const [nf, setNf] = useState({ nature: '', type: '', tatDays: '' });
  const [nfSelect, setNfSelect] = useState('');
  const [typeSelect, setTypeSelect] = useState('');
  const [dr, setDr] = useState({ main: '', label: '', tat: '' });
  const [drSelect, setDrSelect] = useState('');
  const [labelSelect, setLabelSelect] = useState('');

  const typeOptions = [...new Set([
    ...NATURE_TYPES,
    ...complaintTypes.map(c => c.type || c.name || c).filter(Boolean),
    ...natures.map(n => bufStr(n.type || n.type_of)).filter(Boolean),
  ])];
  const allTypeOptions = nf.type && !typeOptions.includes(nf.type) ? [...typeOptions, nf.type] : typeOptions;

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const reload = async () => {
    setLoading(true);
    const [sheet, nat, dl] = await Promise.allSettled([vmm.getSheetMaster(), vmm.getNatures(), vmm.getDelayReasons()]);
    if (sheet.status === 'fulfilled' && sheet.value && (sheet.value.natures || sheet.value.delayReasons || sheet.value.complaintTypes)) {
      setNatures(mergeNatures(sheet.value.natures || []));
      setComplaintTypes(sheet.value.complaintTypes || []);
      const dr = sheet.value.delayReasons;
      setDelay(dr && dr.grouped ? dr.grouped : dr && Object.keys(dr).length ? dr : FALLBACK_DELAY_REASONS);
    } else {
      if (nat.status === 'fulfilled') setNatures(mergeNatures(nat.value.natures || []));
      else if (sheet.value && Array.isArray(sheet.value.natures)) setNatures(mergeNatures(sheet.value.natures));
      else setNatures(mergeNatures([]));
      if (dl.status === 'fulfilled' && dl.value.grouped) setDelay(dl.value.grouped);
      setComplaintTypes([]);
    }
    setLoading(false);
  };

  useEffect(() => { reload(); }, []);

  const sync = async (sheet, action, row) => {
    setSyncing(true);
    try {
      const res = await vmm.saveMasterRow(sheet, action, row);
      if (res && res.success === false) showToast(res.message || 'Sheet sync failed', 'fail');
      else showToast('Saved to sheet', 'ok');
      await reload();
      return true;
    } catch {
      showToast('Could not reach the sheet sync service. Check that it is running.', 'fail');
      return false;
    } finally {
      setSyncing(false);
    }
  };

  const handleAddNature = async () => {
    if (!nf.nature.trim()) return showToast('Enter a nature of complaint', 'fail');
    const type = nf.type.trim() || 'Repair';
    const rows = [];
    const known = typeOptions.map(t => t.trim().toLowerCase());
    if (typeSelect === '__new__' && type && !known.includes(type.toLowerCase())) {
      rows.push(['ComplaintType', 'create', { type }]);
    }
    rows.push(['Nature', 'create', { nature: nf.nature.trim(), type, tatDays: nf.tatDays === '' ? null : Number(nf.tatDays) }]);

    setSyncing(true);
    let ok = true;
    try {
      for (const [sheet, action, row] of rows) {
        const res = await vmm.saveMasterRow(sheet, action, row);
        if (res && res.success === false) { showToast(res.message || 'Sheet sync failed', 'fail'); ok = false; break; }
      }
      if (ok) showToast('Saved to sheet', 'ok');
      await reload();
      if (ok) {
        setNf({ nature: '', type: '', tatDays: '' });
        setNfSelect('');
        setTypeSelect('');
      }
    } catch {
      showToast('Could not reach the sheet sync service. Check that it is running.', 'fail');
    } finally {
      setSyncing(false);
    }
  };

  const handleNatureSelect = (val) => {
    setNfSelect(val);
    if (val === '__new__') {
      setNf({ nature: '', type: '', tatDays: '' });
      setTypeSelect('');
    } else if (val) {
      const n = natures.find(x => bufStr(x.nature) === val);
      const type = n ? bufStr(n.type || n.type_of) : '';
      const tat = n && (n.tatDays != null || n.tat_days != null) ? String(n.tatDays ?? n.tat_days) : '';
      setNf({ nature: val, type, tatDays: tat });
      setTypeSelect(type);
    } else {
      setNf(p => ({ ...p, nature: '', type: '', tatDays: '' }));
      setTypeSelect('');
    }
  };

  const handleTypeSelect = (val) => {
    setTypeSelect(val);
    if (val !== '__new__') setNf(p => ({ ...p, type: val }));
  };

  const handleDeleteNature = async (item) => {
    if (!window.confirm(`Remove "${item.nature}" from the sheet?`)) return;
    await sync('Nature', 'delete', { nature: item.nature });
  };

  const handleAddDelay = async () => {
    if (!dr.main.trim()) return showToast('Enter a main category', 'fail');
    if (!dr.label.trim()) return showToast('Enter the delay reason', 'fail');
    const ok = await sync('DelayReason', 'create', {
      main: dr.main.trim(),
      label: dr.label.trim(),
      tat: dr.tat === '' ? null : Number(dr.tat),
    });
    if (ok) {
      setDr({ main: '', label: '', tat: '' });
      setDrSelect('');
      setLabelSelect('');
    }
  };

  const handleDeleteDelay = async (main, label) => {
    const who = label ? `"${label}" (${main})` : `"${main}"`;
    if (!window.confirm(`Remove ${who} from the sheet?`)) return;
    await sync('DelayReason', 'delete', label ? { main, label } : { main });
  };

  const mains = Object.keys(delay);

  const labelOptions = (drSelect && drSelect !== '__new__' ? (delay[drSelect] || []) : [])
    .map(sr => bufStr(sr.label)).filter(Boolean);
  const allLabelOptions = dr.label && !labelOptions.includes(dr.label) ? [...labelOptions, dr.label] : labelOptions;

  const handleMainSelect = (val) => {
    setDrSelect(val);
    if (val === '__new__') {
      setLabelSelect('');
      setDr({ main: '', label: '', tat: '' });
    } else if (val) {
      // Mirror Nature: picking a category auto-fills the first reason label + TAT
      const first = (delay[val] || [])[0];
      setLabelSelect(first && bufStr(first.label) ? bufStr(first.label) : '');
      setDr({
        main: val,
        label: first && bufStr(first.label) ? bufStr(first.label) : '',
        tat: first && first.tat != null ? String(first.tat) : '',
      });
    } else {
      setLabelSelect('');
      setDr({ main: '', label: '', tat: '' });
    }
  };

  const handleLabelSelect = (val) => {
    setLabelSelect(val);
    if (val === '__new__') {
      setDr(p => ({ ...p, label: '' }));
    } else if (drSelect && drSelect !== '__new__' && val) {
      const sr = (delay[drSelect] || []).find(x => bufStr(x.label) === val);
      setDr(p => ({ ...p, label: val, tat: sr && sr.tat != null ? String(sr.tat) : '' }));
    } else {
      setDr(p => ({ ...p, label: '', tat: '' }));
    }
  };

  return (
    <div className="settings-page">
      <div className="page-heading">
        <h2>Settings</h2>
        <p>Manage Nature of Complaint and Delay Reason dropdowns used in case logging.</p>
      </div>

      <div className="settings-tabs">
        <button className={`settings-tab ${tab === 'nature' ? 'active' : ''}`} onClick={() => setTab('nature')}>
          Nature of Complaint
        </button>
        <button className={`settings-tab ${tab === 'delay' ? 'active' : ''}`} onClick={() => setTab('delay')}>
          Delay Reason
        </button>
      </div>

      {tab === 'nature' && (
        <div className="settings-grid">
          <div className="settings-panel">
            <div className="settings-panel-title">Add Nature of Complaint</div>
            <p className="settings-note">Saved to the sheet immediately — appears in case logging, email parsing, and reports.</p>
            <div className="settings-form">
              <label>Nature of complaint
                <select value={nfSelect} onChange={e => handleNatureSelect(e.target.value)} disabled={syncing}>
                  <option value="">— Select a nature —</option>
                  <option value="__new__">➕ Add new nature…</option>
                  {natures.map((n, i) => (
                    <option key={i} value={bufStr(n.nature)}>{bufStr(n.nature)}</option>
                  ))}
                </select>
              </label>
              {nfSelect === '__new__' && (
                <label>New nature name
                  <input
                    value={nf.nature}
                    onChange={e => setNf(p => ({ ...p, nature: e.target.value }))}
                    placeholder="e.g. AC - Water Leakage"
                  />
                </label>
              )}
              <label>Complaint type
                <select value={typeSelect} onChange={e => handleTypeSelect(e.target.value)} disabled={syncing}>
                  <option value="">— Select type —</option>
                  <option value="__new__">➕ Add new type…</option>
                  {allTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              {typeSelect === '__new__' && (
                <label>New complaint type
                  <input
                    value={nf.type}
                    onChange={e => setNf(p => ({ ...p, type: e.target.value }))}
                    placeholder="e.g. Fire & Safety"
                  />
                </label>
              )}
              <label>TAT days (optional)
                <input
                  type="number"
                  min="0"
                  value={nf.tatDays}
                  onChange={e => setNf(p => ({ ...p, tatDays: e.target.value }))}
                  placeholder="e.g. 7"
                />
              </label>
              <p className={`settings-mode ${nfSelect === '__new__' ? 'new' : nfSelect ? 'edit' : ''}`}>
                {nfSelect && nfSelect !== '__new__'
                  ? `Editing existing: "${nfSelect}" — type and TAT auto-filled, you can still change them.`
                  : nfSelect === '__new__'
                    ? 'Adding a new nature — type and TAT are up to you. A new complaint type is also saved to the sheet.'
                    : 'Pick an existing nature to auto-fill its type, or choose "Add new nature".'}
              </p>
              <button className="settings-btn primary" onClick={handleAddNature} disabled={syncing}>
                {syncing ? 'Syncing to sheet…' : 'Add to sheet'}
              </button>
            </div>
          </div>

          <div className="settings-panel">
            <div className="settings-panel-title">Existing Natures ({loading ? '…' : natures.length})</div>
            {loading ? <p className="settings-note">Loading…</p> : (
              <div className="settings-list">
                {natures.length === 0 && <p className="settings-note">Nothing loaded yet.</p>}
                {natures.map(n => (
                  <div className="settings-item" key={n.nature}>
                    <div className="settings-item-main">
                      <span className="settings-item-label">{bufStr(n.nature)}</span>
                      <span className="settings-item-sub">
                        {bufStr(n.type)}
                        {(n.tatDays || n.tat_days) != null && ` · TAT ${bufStr(n.tatDays || n.tat_days)} days`}
                      </span>
                    </div>
                    <button className="settings-del" onClick={() => handleDeleteNature(n)} disabled={syncing}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'delay' && (
        <div className="settings-grid">
          <div className="settings-panel">
            <div className="settings-panel-title">Add Delay Reason</div>
            <p className="settings-note">Saved to the sheet immediately — appears in follow-up TAT dropdowns.</p>
            <div className="settings-form">
              <label>Main category
                <select value={drSelect} onChange={e => handleMainSelect(e.target.value)} disabled={syncing}>
                  <option value="">— Select a main category —</option>
                  <option value="__new__">➕ Add new category…</option>
                  {mains.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              {drSelect === '__new__' && (
                <label>New main category
                  <input
                    value={dr.main}
                    onChange={e => setDr(p => ({ ...p, main: e.target.value }))}
                    placeholder="e.g. Delay From Vendor Side"
                  />
                </label>
              )}
              <label>Reason label
                <select value={labelSelect} onChange={e => handleLabelSelect(e.target.value)} disabled={syncing}>
                  <option value="">— {drSelect && drSelect !== '__new__' ? 'Select a reason label' : 'Pick a main category first'} —</option>
                  <option value="__new__">➕ Add new reason…</option>
                  {allLabelOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              {labelSelect === '__new__' && (
                <label>New reason label
                  <input
                    value={dr.label}
                    onChange={e => setDr(p => ({ ...p, label: e.target.value }))}
                    placeholder="e.g. Vendor Visit Pending"
                  />
                </label>
              )}
              <label>TAT days (optional)
                <input
                  type="number"
                  min="0"
                  value={dr.tat}
                  onChange={e => setDr(p => ({ ...p, tat: e.target.value }))}
                  placeholder="e.g. 2"
                />
              </label>
              <p className={`settings-mode ${drSelect === '__new__' ? 'new' : drSelect ? 'edit' : ''}`}>
                {drSelect && drSelect !== '__new__'
                  ? `Editing existing: "${drSelect}" — first reason auto-selected, its TAT auto-filled.`
                  : drSelect === '__new__'
                    ? 'Adding a new category — main, reason, and TAT are up to you.'
                    : 'Pick an existing category to auto-fill its reason and TAT, or choose "Add new category".'}
              </p>
              <button className="settings-btn primary" onClick={handleAddDelay} disabled={syncing}>
                {syncing ? 'Syncing to sheet…' : 'Add to sheet'}
              </button>
            </div>
          </div>

          <div className="settings-panel">
            <div className="settings-panel-title">Existing Delay Reasons ({loading ? '…' : mains.length} categories)</div>
            {loading ? <p className="settings-note">Loading…</p> : (
              <div className="settings-list">
                {mains.length === 0 && <p className="settings-note">Nothing loaded yet.</p>}
                {mains.map(main => (
                  <div className="settings-group" key={main}>
                    <div className="settings-group-head">
                      <strong>{main}</strong>
                      <button className="settings-del" onClick={() => handleDeleteDelay(main)} disabled={syncing}>Remove category</button>
                    </div>
                    {delay[main].map(sr => (
                      <div className="settings-item" key={`${main}-${sr.label}`}>
                        <div className="settings-item-main">
                          <span className="settings-item-label">{bufStr(sr.label)}</span>
                          {sr.tat != null && <span className="settings-item-sub">TAT {sr.tat} days</span>}
                        </div>
                        <button className="settings-del" onClick={() => handleDeleteDelay(main, sr.label)} disabled={syncing}>Remove</button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <div className={`settings-toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}