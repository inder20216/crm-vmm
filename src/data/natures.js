// Fallback natures — used until the API/master-data responds.
// Same set the Settings page writes to vmm_natureofproblem.
export const FALLBACK_NATURES = [
  { nature: 'Not Working',                             type: 'Breakdown',   tatDays: 1  },
  { nature: 'Not Maintaining Proper Temperature',      type: 'Breakdown',   tatDays: 2  },
  { nature: 'Servicing / Maintenance Required',        type: 'Maintenance', tatDays: 2  },
  { nature: 'Part Not Working',                        type: 'Repair',      tatDays: 2  },
  { nature: 'Repair Required',                         type: 'Repair',      tatDays: 3  },
  { nature: 'Requirement / Installation / Replacement', type: 'Requirement', tatDays: 10 },
];

export function mergeNatures(apiList, fallback = FALLBACK_NATURES) {
  const seen = new Set();
  const out = [];
  for (const n of [...(apiList || []), ...fallback]) {
    const label = n && (n.nature || n.name || n.type_of || '');
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({
      nature: label,
      type:   n.type || n.type_of || 'Repair',
      tatDays: n.tatDays != null ? n.tatDays : (n.tat_days != null ? n.tat_days : 0),
    });
  }
  return out;
}