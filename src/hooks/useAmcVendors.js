import { useEffect, useState } from 'react';
import { vmm } from '../api/vmm';
import { AMC_VENDOR_ROWS } from '../data/amcVendors';

let cachedRows = null;
let cachedSource = 'local';
let inFlight = null;

const localRows = () => AMC_VENDOR_ROWS.map(r => ({ ...r }));

export async function loadAmcVendors(force = false) {
  if (!force && cachedRows) return { rows: cachedRows, source: cachedSource };
  if (inFlight) return inFlight;

  inFlight = vmm.getAmcVendors()
    .then(rows => {
      cachedRows = rows;
      cachedSource = 'sql';
      return { rows, source: 'sql' };
    })
    .catch(() => {
      cachedRows = localRows();
      cachedSource = 'local';
      return { rows: cachedRows, source: 'local' };
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}

export function useAmcVendors() {
  const [state, setState] = useState({
    rows: cachedRows || localRows(),
    source: cachedRows ? cachedSource : 'local',
    loading: !cachedRows,
  });

  useEffect(() => {
    let alive = true;
    loadAmcVendors().then(result => {
      if (alive) setState({ ...result, loading: false });
    });
    return () => { alive = false; };
  }, []);

  return state;
}

export async function refreshAmcVendors() {
  return loadAmcVendors(true);
}
