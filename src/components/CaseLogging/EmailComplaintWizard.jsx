import { useEffect, useState } from 'react';
import { vmm } from '../../api/vmm';
import {
  ATTACHMENT_MANDATORY, COMPLAINT_STEPS, PRODUCT_VENDORS, AUTO_WARRANTY_VALUES,
  WARRANTY_LABELS, getAutoWarranty, getFixedVendor, getVendorsForProduct,
  getAmcServiceType, getStoreAmcVendors, isAmcLookupProduct, isHoDirectProduct,
  isFireProductName, isGensetProduct, isTemperatureNature, showsTemperatureOption,
  toContractType, catalogOptions, norm,
} from './caseWorkflow';
import { AddableSelect, ProductSearch, WorkflowStep } from './WorkflowControls';

// The same 9-step New Case workflow, rendered for one email complaint item.
// Every value lives on the parent complaintItems[] entry so Add Another
// Complaint keeps an independent wizard per product.
export default function EmailComplaintWizard({
  item, allItems, products, natures, storeCode, amcRows, driveAttachments,
  errors = {}, onChange, onSelectItem, onAddNature,
}) {
  const [polishing, setPolishing] = useState(false);

  const { categories: categoryOptions, vendors: sqlVendorOptions } = catalogOptions(products);

  const visibleNatures = (natures || []).filter(n =>
    !isTemperatureNature(n.nature) || showsTemperatureOption(item.productName)
  );

  const autoWarranty   = getAutoWarranty(item.productName);
  const isFixedVendor  = !!getFixedVendor(item.productName);
  const isHoDirect     = isHoDirectProduct(item.productName);
  const isGenset       = isGensetProduct(item.productName);
  const isFireProduct  = isFireProductName(item.productName);
  const isAutoRouted   = !!autoWarranty;
  const warranty       = item.warranty || autoWarranty || '';

  const isAmcStoreMode   = warranty === 'Under AMC' && isAmcLookupProduct(item.productName) && !isAutoRouted;
  const isAmcManualMode  = warranty === 'Under AMC' && !isAutoRouted;
  const isBrandMode      = warranty === 'Under Warranty' && !isAutoRouted;
  const isPlainVendorMode = !!warranty && !isAutoRouted && !isAmcManualMode && !isBrandMode;

  const amcServiceType  = getAmcServiceType(item.productName);
  const storeAmcVendors = getStoreAmcVendors(amcRows, storeCode, item.productName);

  // Auto-fill the store's AMC vendor once per store/product/warranty combination.
  // The key lives on the item so switching complaint tabs cannot overwrite a
  // vendor that the agent changed manually.
  useEffect(() => {
    if (!isAmcStoreMode || !storeAmcVendors.length) return;
    const key = `${storeCode}|${amcServiceType}|${warranty}`;
    if (item.amcAutoFillKey === key) return;
    onChange({
      vendorName: storeAmcVendors[0],
      vendorQuery: '',
      vendorFreeText: '',
      amcAutoFillKey: key,
      amcLookup: 'found',
    });
  }, [isAmcStoreMode, storeAmcVendors, storeCode, amcServiceType, warranty, item.amcAutoFillKey, onChange]);

  const brandOptions = getVendorsForProduct(item.productName);
  const filteredBrands = brandOptions.filter(v =>
    !item.vendorQuery?.trim() || v.toLowerCase().includes(item.vendorQuery.toLowerCase()) || v === item.vendorName
  );
  const vendorOptions = (isAmcStoreMode && storeAmcVendors.length)
    ? [...storeAmcVendors, ...sqlVendorOptions.filter(v => !storeAmcVendors.includes(v))]
    : sqlVendorOptions;
  const filteredVendors = vendorOptions.filter(v =>
    !item.vendorQuery?.trim() || v.toLowerCase().includes(item.vendorQuery.toLowerCase()) || v === item.vendorName
  );

  const handleProduct = (p) => {
    const fixedVendor = getFixedVendor(p.name);
    const hoDirect    = isHoDirectProduct(p.name);
    const amcLookup   = isAmcLookupProduct(p.name);
    const auto        = getAutoWarranty(p.name);
    const previous    = item.warranty || '';
    const nextWarranty = auto || (AUTO_WARRANTY_VALUES.has(previous) ? '' : previous);

    let vendorName = p.vendor || '';
    if (fixedVendor) vendorName = fixedVendor;
    else if (hoDirect) vendorName = 'N/A — HO Direct';
    else if (amcLookup || isGensetProduct(p.name) || isFireProductName(p.name)) vendorName = '';

    const patch = {
      productName:      p.name,
      aiProductName:    '',
      productUnmatched: false,
      productShortName: p.shortName || '',
      productType:      p.category || '',
      category:         p.category || '',
      warranty:         nextWarranty,
      contractType:     nextWarranty ? toContractType(nextWarranty) : '',
      vendorName,
      vendorQuery:      '',
      vendorFreeText:   '',
      noneBrand:        '',
      gensetChoice:     '',
      amcAutoFillKey:   '',
      amcLookup:        'idle',
      errorsCleared:    true,
    };
    // Portal rule: temperature nature is AC-only.
    if (!showsTemperatureOption(p.name) && isTemperatureNature(item.natureOfProblem)) {
      patch.natureOfProblem = '';
      patch.complaintType   = '';
      patch.tatDays         = '';
    }
    onChange(patch);
  };

  const handleNature = (value) => {
    const n = (natures || []).find(x => x.nature === value);
    onChange({
      natureOfProblem: value,
      complaintType:   n?.type || (value ? 'Repair' : ''),
      tatDays:         n ? (n.tatDays ?? '') : (value ? 7 : ''),
    });
  };

  const handleWarranty = (e) => {
    const next = e.target.value;
    onChange({
      warranty:         next,
      contractType:     next ? toContractType(next) : '',
      vendorName:       '',
      vendorQuery:      '',
      vendorFreeText:   '',
      noneBrand:        '',
      gensetChoice:     '',
      amcAutoFillKey:   '',
      amcLookup:        'idle',
      errorsCleared:    true,
    });
  };

  const polishRemarks = async () => {
    if (!(item.description || '').trim()) return;
    setPolishing(true);
    try {
      const res = await vmm.polishRemarks(item.description);
      if (res?.success && res.polishedText) onChange({ description: res.polishedText });
    } catch { /* keep the original text if polishing is unavailable */ }
    finally { setPolishing(false); }
  };

  const driveFiles = (driveAttachments || []).filter(a => a.viewLink);
  const localFiles = item.localAttachments || [];
  const isAttachSelected = (idx) =>
    item.selectedAttachIndices === null || (item.selectedAttachIndices || []).includes(idx);

  const toggleAttach = (idx) => {
    const all = driveFiles.map((_, i) => i);
    if (item.selectedAttachIndices === null) {
      onChange({ selectedAttachIndices: all.filter(i => i !== idx) });
      return;
    }
    const selected = item.selectedAttachIndices || [];
    const next = selected.includes(idx)
      ? selected.filter(i => i !== idx)
      : [...selected, idx];
    onChange({ selectedAttachIndices: next.length === all.length ? null : next });
  };

  const attachmentNames = [
    ...(item.noImage ? [] : driveFiles.filter((_, i) => isAttachSelected(i)).map(a => a.name)),
    ...localFiles.map(f => f.name),
  ];

  return (
    <div className="wf-grid ec-wizard-grid">
      {COMPLAINT_STEPS.map((step, i) => (
        <WorkflowStep key={step.name} n={i + 1} title={step.name} sub={step.sub} wide={i === 8}>
          {i === 0 && (
            <>
              <ProductSearch
                products={products}
                value={item.productName}
                error={!!errors.productName}
                onChange={handleProduct}
              />
              {errors.productName && <p className="err-msg">{errors.productName}</p>}
              {item.productUnmatched && (
                <p className="ec-product-not-found-inline" role="alert">
                  ⚠ “{item.aiProductName || item.productName}” doesn&apos;t exist in the dropdown.
                  Select a product above or add it with ➕.
                </p>
              )}
            </>
          )}

          {i === 1 && (
            <>
              <AddableSelect
                className="wf-input"
                value={item.category || ''}
                disabled={!!item.productName}
                options={categoryOptions}
                placeholder="— Select category —"
                storageKey="categories"
                inputPlaceholder="New category name"
                onChange={value => onChange({ category: value, productType: value })}
              />
              {item.productName && (
                <p className="wf-msg ok">✓ Auto-selected from “{item.productName}” — change the product to change the category.</p>
              )}
            </>
          )}

          {i === 2 && (
            <>
              <AddableSelect
                className="wf-input"
                error={!!errors.natureOfComplaint}
                value={item.natureOfProblem || ''}
                options={visibleNatures.map(n => n.nature)}
                placeholder="— Select Nature of Complaint —"
                storageKey="natures"
                inputPlaceholder="New nature of complaint"
                onAddValue={onAddNature}
                onChange={handleNature}
              />
              {!showsTemperatureOption(item.productName) && (
                <p className="wf-help">Temperature complaints are shown only for AC / Server Room AC (portal rule).</p>
              )}
              {item.natureOfProblem && item.tatDays !== '' && item.tatDays != null && (
                <p className="wf-help">Type: <strong>{item.complaintType || '—'}</strong> · TAT: {item.tatDays} day(s)</p>
              )}
              {errors.natureOfComplaint && <p className="err-msg">{errors.natureOfComplaint}</p>}
            </>
          )}

          {i === 3 && (
            isAutoRouted ? (
              <p className={`wf-msg ${isFixedVendor || isHoDirect ? 'ok' : ''}`}>
                {isFixedVendor && `Portal rule — vendor ${getFixedVendor(item.productName)} auto-assigned; warranty step skipped.`}
                {isHoDirect && 'Portal rule — routed to Facility Manager / HO Team; warranty and vendor steps skipped.'}
                {isGenset && 'Portal rule — genset skips warranty; choose the brand in the Vendor step.'}
                {isFireProduct && 'Portal rule — fire products skip warranty; vendor from sticker is optional.'}
              </p>
            ) : (
              <>
                <select
                  className={`wf-input ${errors.warranty ? 'err' : ''}`}
                  value={warranty}
                  onChange={handleWarranty}
                >
                  <option value="">— Select warranty / AMC status —</option>
                  {WARRANTY_LABELS.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
                {warranty === 'Not Applicable' && (
                  <p className="wf-help">Not sure? Portal guidance says select Not Applicable — the team verifies during inspection.</p>
                )}
                {errors.warranty && <p className="err-msg">{errors.warranty}</p>}
              </>
            )
          )}

          {i === 4 && (
            <div className="wf-stack">
              {isFixedVendor && (
                <p className="wf-msg ok">Portal rule — {getFixedVendor(item.productName)} auto-assigned as the vendor.</p>
              )}
              {isHoDirect && (
                <p className="wf-msg ok">Portal rule — no vendor required; routed to HO / Facility Manager.</p>
              )}
              {isGenset && (
                <>
                  <p className="wf-help">Portal rule — choose Kirloskar, or send other brands to HO.</p>
                  <div className="wf-inline">
                    <button type="button"
                      className={`wf-btn ${item.gensetChoice === 'Kirloskar' ? 'active' : ''}`}
                      onClick={() => onChange({ gensetChoice: 'Kirloskar', vendorName: 'Kirloskar' })}>
                      Kirloskar
                    </button>
                    <button type="button"
                      className={`wf-btn ${item.gensetChoice === 'other' ? 'active' : ''}`}
                      onClick={() => onChange({ gensetChoice: 'other', vendorName: 'N/A — HO Direct' })}>
                      Other brand (HO)
                    </button>
                  </div>
                  {errors.vendor && <p className="err-msg">{errors.vendor}</p>}
                </>
              )}
              {isFireProduct && (
                <>
                  <p className="wf-help">Portal rule — enter the vendor from the unit sticker. This is optional.</p>
                  <input className="wf-input" type="text" placeholder="Sticker vendor (optional)"
                    value={item.vendorFreeText || ''}
                    onChange={e => onChange({ vendorFreeText: e.target.value, vendorName: e.target.value.trim() })} />
                </>
              )}
              {isAmcManualMode && (
                <>
                  {isAmcStoreMode && (
                    <p className={`wf-msg ${storeAmcVendors.length ? 'ok' : ''}`}>
                      {storeAmcVendors.length
                        ? `✓ ${storeCode} · ${amcServiceType}: ${storeAmcVendors[0]} — auto-filled from the store record`
                        : `No ${amcServiceType} vendor mapped for ${storeCode || 'this store'} — select below or enter manually.`}
                    </p>
                  )}
                  <p className="wf-help">
                    {isAmcStoreMode
                      ? 'Auto-filled from this store’s AMC record — you can change it below or type a custom vendor name.'
                      : 'Select the AMC vendor from the live SQL list, or type a custom vendor name.'}
                  </p>
                  <input className="wf-input" type="text" placeholder="Search AMC vendor…"
                    value={item.vendorQuery || ''}
                    onChange={e => onChange({ vendorQuery: e.target.value })} />
                  <AddableSelect
                    className="wf-input"
                    error={!!errors.vendor}
                    value={item.vendorName || ''}
                    options={filteredVendors}
                    placeholder="— Select AMC vendor —"
                    storageKey="vendors"
                    inputPlaceholder="New AMC vendor name"
                    onChange={value => onChange({ vendorName: value, vendorFreeText: '', amcAutoFillKey: '' })}
                  />
                  <input className="wf-input" type="text" placeholder="Or enter AMC vendor manually"
                    value={item.vendorFreeText || ''}
                    onChange={e => onChange({ vendorFreeText: e.target.value, vendorName: e.target.value.trim(), vendorQuery: '' })} />
                  {errors.vendor && <p className="err-msg">{errors.vendor}</p>}
                </>
              )}
              {isBrandMode && (
                <>
                  <input className="wf-input" type="text" placeholder="Search brand…"
                    value={item.vendorQuery || ''}
                    onChange={e => onChange({ vendorQuery: e.target.value })} />
                  <AddableSelect
                    className="wf-input"
                    error={!!errors.vendor}
                    value={item.vendorName === 'N/A — HO Direct' ? '__none__' : (item.vendorName || '')}
                    options={filteredBrands}
                    extraOptions={[{ value: '__none__', label: 'None of the above (HO team will handle)' }]}
                    placeholder="— Select brand —"
                    storageKey="vendors"
                    inputPlaceholder="New brand name"
                    onChange={value => onChange({
                      vendorName: value === '__none__' ? 'N/A — HO Direct' : value,
                      noneBrand: '',
                    })}
                  />
                  {item.vendorName === 'N/A — HO Direct' && (
                    <input className="wf-input" type="text" placeholder="Brand name (optional — added to remarks)"
                      value={item.noneBrand || ''}
                      onChange={e => onChange({ noneBrand: e.target.value })} />
                  )}
                  <p className="wf-help">
                    {brandOptions.length} brand(s) available for {item.productName || 'this product'}
                    {!PRODUCT_VENDORS[norm(item.productName)] && ' — showing the standard warranty brand list'}
                  </p>
                  {errors.vendor && <p className="err-msg">{errors.vendor}</p>}
                </>
              )}
              {isPlainVendorMode && (
                <>
                  <p className="wf-help">Select the vendor from the live SQL list, or type a custom name / NA.</p>
                  <input className="wf-input" type="text" placeholder="Search vendor…"
                    value={item.vendorQuery || ''}
                    onChange={e => onChange({ vendorQuery: e.target.value })} />
                  <AddableSelect
                    className="wf-input"
                    error={!!errors.vendor}
                    value={item.vendorName || ''}
                    options={filteredVendors}
                    placeholder="— Select vendor —"
                    storageKey="vendors"
                    inputPlaceholder="New vendor name"
                    onChange={value => onChange({ vendorName: value, vendorFreeText: '' })}
                  />
                  <input className="wf-input" type="text" placeholder="Or enter vendor manually (or NA)"
                    value={item.vendorFreeText || ''}
                    onChange={e => onChange({ vendorFreeText: e.target.value, vendorName: e.target.value.trim(), vendorQuery: '' })} />
                  {errors.vendor && <p className="err-msg">{errors.vendor}</p>}
                </>
              )}
              {!warranty && <p className="wf-help">Select a warranty status first.</p>}
            </div>
          )}

          {i === 5 && (
            <>
              <input className={`wf-input ${errors.productLocation ? 'err' : ''}`} type="text"
                placeholder="e.g. Ground Floor near lift"
                value={item.productLocation || ''}
                onChange={e => onChange({ productLocation: e.target.value })} />
              {errors.productLocation && <p className="err-msg">{errors.productLocation}</p>}
            </>
          )}

          {i === 6 && (
            <div className="wf-stack">
              {ATTACHMENT_MANDATORY.includes(item.complaintType) && !item.noImage && (
                <p className="wf-help">Mandatory for {item.complaintType} complaints.</p>
              )}
              {!item.noImage && (
                <>
                  {driveFiles.length > 0 && (
                    <div className="ec-wizard-drive-files">
                      <div className="wf-help">Email attachments (saved to Drive) — untick any that do not belong to this complaint:</div>
                      {driveFiles.map((a, idx) => (
                        <label key={`${a.name}-${idx}`} className="ec-wizard-file-row">
                          <input type="checkbox" checked={isAttachSelected(idx)} onChange={() => toggleAttach(idx)} />
                          <span>{a.name}</span>
                          <a href={a.viewLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>View</a>
                        </label>
                      ))}
                    </div>
                  )}
                  <input
                    className={`wf-input wf-file ${errors.attachments ? 'err' : ''}`}
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf"
                    multiple
                    onChange={e => onChange({ localAttachments: Array.from(e.target.files || []) })}
                  />
                  <p className="wf-help">Accepted: JPG, PNG, PDF · Email attachments and local files appear together in Review and Remarks.</p>
                  {attachmentNames.length > 0 && (
                    <ul className="file-list">
                      {attachmentNames.map((name, idx) => <li key={`${name}-${idx}`}>📎 {name}</li>)}
                    </ul>
                  )}
                </>
              )}
              <label className="no-image-check">
                <input type="checkbox" checked={!!item.noImage}
                  onChange={e => onChange({
                    noImage: e.target.checked,
                    localAttachments: e.target.checked ? [] : localFiles,
                  })} />
                No image available / will be shared later
              </label>
              {errors.attachments && <p className="err-msg">{errors.attachments}</p>}
            </div>
          )}

          {i === 7 && (
            <>
              <div className="wf-remarks-head">
                <span>Describe the problem</span>
                <button type="button"
                  className={`btn-ai-polish ${polishing ? 'loading' : ''}`}
                  onClick={polishRemarks}
                  disabled={polishing || !(item.description || '').trim()}
                  title="Let AI rewrite this professionally">
                  {polishing ? '✦ Polishing…' : '✦ AI Polish'}
                </button>
              </div>
              <textarea className={`wf-input ${errors.description ? 'err' : ''}`} rows={4}
                placeholder="Describe the problem…"
                value={item.description || ''}
                onChange={e => onChange({ description: e.target.value })} />
              {allItems.length > 1 && (
                <p className="wf-help">Each complaint needs its own description when logging multiple complaints.</p>
              )}
              {!allItems.length || allItems.length === 1 ? (
                <p className="wf-help">You can write in English or Hinglish — AI Polish will rewrite it professionally.</p>
              ) : null}
              {errors.description && <p className="err-msg">{errors.description}</p>}
            </>
          )}

          {i === 8 && (
            <div className="ec-wizard-review">
              {(allItems || []).map((other, idx) => {
                const otherWarranty = other.warranty || getAutoWarranty(other.productName);
                const otherFiles = [
                  ...(other.noImage ? [] : (() => {
                    const files = (driveAttachments || []).filter(a => a.viewLink);
                    return other.selectedAttachIndices === null
                      ? files.map(a => a.name)
                      : (other.selectedAttachIndices || []).map(i => files[i]?.name).filter(Boolean);
                  })()),
                  ...(other.localAttachments || []).map(f => f.name),
                ];
                return (
                  <div key={other.id}
                    className={`ec-wizard-review-card ${other.id === item.id ? 'active' : ''} ${other.productUnmatched ? 'product-missing' : ''}`}
                    onClick={() => onSelectItem?.(other.id)}>
                    <div className="ec-wizard-review-title">
                      Complaint #{idx + 1}{other.id === item.id ? ' · editing' : ' · click to edit'}
                    </div>
                    {[
                      ['Type', other.complaintType],
                      ['Category', other.category],
                      ['Product', other.productName],
                      ['Nature', other.natureOfProblem],
                      ['Warranty', otherWarranty],
                      ['Vendor', other.vendorName],
                      ...(other.noneBrand ? [['Brand info', other.noneBrand]] : []),
                      ['Location', other.productLocation],
                      ['Attachments', otherFiles.join(', ')],
                      ['Remarks', other.description],
                    ].map(([label, value]) => (
                      <div key={label} className={`wf-review-item ${label === 'Product' && other.productUnmatched ? 'product-missing' : ''}`}>
                        <span>{label}</span>
                        <strong className={value ? '' : 'empty'}>
                          {value || '—'}
                          {label === 'Product' && other.productUnmatched && (
                            <em className="ec-review-warn"> — “{other.aiProductName || other.productName}” not in dropdown</em>
                          )}
                        </strong>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </WorkflowStep>
      ))}
    </div>
  );
}
