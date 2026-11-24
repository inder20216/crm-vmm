import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { isAmcLookupProduct, norm } from './caseWorkflow';

const CUSTOM_KEY = 'vmm-custom-options-v1';
const ADD_VALUE = '__add__';

function readCustomStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function readCustomList(kind) {
  const list = readCustomStore()[kind];
  return Array.isArray(list) ? list : [];
}

// Remember newly typed values in this browser. Complaint natures are also
// written to the master sheet by the parent form; the other lists have no
// master-write endpoint yet, so persistence here keeps them available.
function addCustomOption(kind, value) {
  const text = String(value || '').trim();
  if (!text) return;
  const store = readCustomStore();
  const list = Array.isArray(store[kind]) ? store[kind] : [];
  const keyOf = item => norm(typeof item === 'string' ? item : item?.name);
  if (!list.some(item => keyOf(item) === norm(text))) list.push(text);
  store[kind] = list;
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(store)); } catch { /* storage may be unavailable */ }
}

function readCustomProducts() {
  return readCustomList('products').filter(p => p && typeof p === 'object' && p.name);
}

function addCustomProduct(product) {
  const name = String(product?.name || '').trim();
  if (!name) return;
  const store = readCustomStore();
  const list = Array.isArray(store.products) ? store.products : [];
  if (list.some(p => norm(p?.name) === norm(name))) return;
  list.push({
    name,
    category: String(product?.category || '').trim(),
    vendor: String(product?.vendor || '').trim(),
    shortName: String(product?.shortName || '').trim(),
    custom: true,
  });
  store.products = list;
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(store)); } catch { /* storage may be unavailable */ }
}

// A normal <select> plus an "Add new" row. Choosing the add option opens an
// inline text box instead of changing the current value; saving selects the new
// value immediately and remembers it for this browser.
export function AddableSelect({
  value, onChange, options = [], placeholder = 'Select…', className = 'wf-input',
  error, disabled, extraOptions = [], addLabel = '➕ Add new…',
  storageKey, inputPlaceholder = 'Type a new value…', onAddValue, style,
}) {
  const [custom, setCustom] = useState(() =>
    storageKey ? readCustomList(storageKey).filter(v => typeof v === 'string') : []
  );
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const merged = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const v of [...options, ...custom]) {
      const key = norm(v);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out;
  }, [options, custom]);

  const extra = useMemo(
    () => extraOptions.map(o => (typeof o === 'string' ? { value: o, label: o } : o)),
    [extraOptions]
  );
  const extraValues = useMemo(() => new Set(extra.map(o => o.value)), [extra]);

  const closeAdd = () => { setAdding(false); setDraft(''); };

  const commit = () => {
    const next = draft.trim();
    closeAdd();
    if (!next) return;
    if (storageKey && !merged.some(v => norm(v) === norm(next))) {
      addCustomOption(storageKey, next);
      setCustom(prev => (prev.some(v => norm(v) === norm(next)) ? prev : [...prev, next]));
    }
    if (onAddValue) Promise.resolve(onAddValue(next)).catch(() => {});
    onChange(next);
  };

  const current = value || '';
  const showCurrent = current && !merged.includes(current) && !extraValues.has(current);

  return (
    <div className="wf-addable" style={style}>
      <select
        className={`${className}${error ? ' err' : ''}`}
        value={current}
        disabled={disabled}
        onChange={e => {
          const next = e.target.value;
          if (next === ADD_VALUE) { setAdding(true); setDraft(''); return; }
          closeAdd();
          onChange(next);
        }}
      >
        <option value="">{placeholder}</option>
        {merged.map(v => <option key={v} value={v}>{v}</option>)}
        {showCurrent && <option value={current}>{current}</option>}
        {extra.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        <option value={ADD_VALUE}>{addLabel}</option>
      </select>
      {adding && (
        <div className="wf-add-row">
          <input
            className="wf-add-input"
            type="text"
            autoFocus
            placeholder={inputPlaceholder}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { e.preventDefault(); closeAdd(); }
            }}
          />
          <button type="button" className="wf-add-save" onClick={commit}>Add</button>
          <button type="button" className="wf-add-cancel" onClick={closeAdd}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// Product dropdown with an inner search box. SQL stores one row per vendor, so
// the list is collapsed to unique product names before it is shown.
export function ProductSearch({ products, value, onChange, error, disabled }) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const [customProducts, setCustomProducts] = useState(readCustomProducts);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftCategory, setDraftCategory] = useState('');
  const wrapRef   = useRef(null);
  const searchRef = useRef(null);
  const listId    = useId();

  const allProducts = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const p of [...(products || []), ...customProducts]) {
      const key = norm(p.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push(p);
    }
    return list;
  }, [products, customProducts]);

  const categoryOptions = useMemo(
    () => [...new Set(allProducts.map(p => p.category).filter(Boolean))].sort(),
    [allProducts]
  );

  const filtered = search.trim()
    ? allProducts.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase()))
    : allProducts;

  const close = () => { setOpen(false); setSearch(''); setAdding(false); setDraftName(''); setDraftCategory(''); };

  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  useEffect(() => {
    const handler = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape' && open) close(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const select = (product) => {
    close();
    onChange(product);
  };

  const canAddProduct = !!draftName.trim() && !!draftCategory.trim();

  const addProduct = () => {
    if (!canAddProduct) return;
    const name = draftName.trim();
    const category = draftCategory.trim();
    const existing = allProducts.find(p => norm(p.name) === norm(name));
    if (existing) { select(existing); return; }
    const product = { name, category, vendor: '', shortName: '', custom: true };
    addCustomProduct(product);
    addCustomOption('categories', category);
    setCustomProducts(prev => [...prev, product]);
    select(product);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        className={`product-select-input ${error ? 'err' : ''}`}
        placeholder={disabled ? 'Loading…' : 'Select product…'}
        value={value || ''}
        readOnly
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      />
      <span className="product-caret" aria-hidden="true">▾</span>
      {open && (
        <div className="product-dropdown" role="listbox">
          <div className="product-search-wrap">
            <input
              ref={searchRef}
              type="text"
              className="product-search-input"
              placeholder="Search all products…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoComplete="off"
            />
            <span className="product-count">{filtered.length} / {allProducts.length}</span>
          </div>
          <div className="product-list">
            {filtered.map(p => (
              <div
                key={norm(p.name)}
                className="product-option"
                role="option"
                onMouseDown={() => select(p)}
              >
                <span className="product-option-name">{p.name}</span>
                <span className="product-option-vendor">
                  {isAmcLookupProduct(p.name) ? 'AMC vendor by store' : (p.category || '—')}
                </span>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="product-option-empty">No products found for “{search}”</div>
            )}
          </div>
          <div className="product-add">
            {!adding ? (
              <button
                type="button"
                className="product-add-toggle"
                onMouseDown={e => e.preventDefault()}
                onClick={() => setAdding(true)}
              >
                ➕ Add new product…
              </button>
            ) : (
              <div className="product-add-form">
                <input
                  type="text"
                  placeholder="New product name"
                  value={draftName}
                  autoFocus
                  onChange={e => setDraftName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); addProduct(); }
                    if (e.key === 'Escape') { e.preventDefault(); setAdding(false); }
                  }}
                />
                <input
                  type="text"
                  list={`${listId}-categories`}
                  placeholder="Category (required)"
                  value={draftCategory}
                  onChange={e => setDraftCategory(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); addProduct(); }
                    if (e.key === 'Escape') { e.preventDefault(); setAdding(false); }
                  }}
                />
                <datalist id={`${listId}-categories`}>
                  {categoryOptions.map(c => <option key={c} value={c} />)}
                </datalist>
                <div className="product-add-actions">
                  <button type="button" className="product-add-save" disabled={!canAddProduct} onClick={addProduct}>
                    Add &amp; select
                  </button>
                  <button type="button" className="product-add-cancel" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                </div>
                <p className="product-add-hint">The new product is remembered in this browser and used for this complaint.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkflowStep({ n, title, sub, wide, children }) {
  return (
    <div className={`wf-field ${wide ? 'wf-wide' : ''}`}>
      <div className="wf-label">
        <span className="wf-num">{n}</span>
        <span className="wf-label-text">
          <span className="wf-title">{title}</span>
          <span className="wf-sub">{sub}</span>
        </span>
      </div>
      <div className="wf-control">{children}</div>
    </div>
  );
}
