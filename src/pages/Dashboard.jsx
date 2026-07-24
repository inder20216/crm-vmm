import { useEffect, useState } from 'react';
import { vmm } from '../api/vmm';
import './Dashboard.css';

function isoDate(d) { return d.toISOString().split('T')[0]; }
function todayISO()  { return isoDate(new Date()); }

function getPresetRange(preset) {
  const today = new Date();
  const tod = isoDate(today);
  if (preset === 'today')     return { from: tod, to: tod };
  if (preset === 'yesterday') {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    const s = isoDate(y); return { from: s, to: s };
  }
  if (preset === 'week') {
    const dow  = today.getDay();
    const diff = dow === 0 ? 6 : dow - 1;
    const mon  = new Date(today); mon.setDate(today.getDate() - diff);
    return { from: isoDate(mon), to: tod };
  }
  if (preset === 'month') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: isoDate(first), to: tod };
  }
  return { from: tod, to: tod };
}

function Val({ loading, value }) {
  if (loading) return <span style={{ fontSize: 20, color: '#94a3b8' }}>…</span>;
  return typeof value === 'number' ? value.toLocaleString() : (value ?? '—');
}

const PRESETS = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week',      label: 'This Week' },
  { key: 'month',     label: 'This Month' },
  { key: 'custom',    label: 'Custom' },
];

export default function Dashboard() {
  const [preset,       setPreset]       = useState('today');
  const [customFrom,   setCustomFrom]   = useState(todayISO());
  const [customTo,     setCustomTo]     = useState(todayISO());
  const [stats,        setStats]        = useState({});
  const [productivity, setProductivity] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');

  const fetchData = (from, to) => {
    setLoading(true);
    setError('');
    vmm.dashboardStats({ from, to })
      .then(res => {
        if (res.success) {
          setStats(res.stats || {});
          // Deduplicate by agent name (guards against n8n returning repeated rows)
          const seen = new Set();
          const deduped = (res.productivity || []).filter(p => {
            const key = String(p.agent_name || '').trim().toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          setProductivity(deduped);
        } else {
          setError('Dashboard data returned unexpected format.');
        }
      })
      .catch(() => setError('Could not load dashboard data. Please try again.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (preset === 'custom') {
      if (customFrom && customTo) fetchData(customFrom, customTo);
    } else {
      const { from, to } = getPresetRange(preset);
      fetchData(from, to);
    }
  }, [preset, customFrom, customTo]); // eslint-disable-line

  return (
    <div className="dashboard">

      {/* ── Header + filter ── */}
      <div className="dash-top">
        <div className="page-heading">
          <h2>Dashboard</h2>
          <p>VMM Facility Complaints — Overview</p>
        </div>
        <div className="dash-filter-bar">
          {PRESETS.map(p => (
            <button
              key={p.key}
              className={`dash-filter-btn${preset === p.key ? ' active' : ''}`}
              onClick={() => setPreset(p.key)}
            >{p.label}</button>
          ))}
          {preset === 'custom' && (
            <div className="dash-custom-range">
              <input type="date" value={customFrom} max={customTo} className="dash-date-input"
                onChange={e => setCustomFrom(e.target.value)} />
              <span className="dash-range-sep">–</span>
              <input type="date" value={customTo} min={customFrom} className="dash-date-input"
                onChange={e => setCustomTo(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      {error && <div className="dash-error">{error}</div>}

      {/* ── 4 Stat cards ── */}
      <div className="stats-grid">
        <div className="stat-card stat-purple">
          <div className="stat-label">Total Logged</div>
          <div className="stat-value"><Val loading={loading} value={stats.totalLogged} /></div>
          <div className="stat-sub">In selected period</div>
        </div>
        <div className="stat-card stat-red">
          <div className="stat-label">Escalated</div>
          <div className="stat-value"><Val loading={loading} value={stats.escalated} /></div>
          <div className="stat-sub">In selected period</div>
        </div>
        <div className="stat-card stat-green">
          <div className="stat-label">Closed</div>
          <div className="stat-value"><Val loading={loading} value={stats.closed} /></div>
          <div className="stat-sub">In selected period</div>
        </div>
        <div className="stat-card stat-amber">
          <div className="stat-label">EDCs Pending</div>
          <div className="stat-value"><Val loading={loading} value={stats.edcsPending} /></div>
          <div className="stat-sub">Overdue open complaints</div>
        </div>
      </div>

      {/* ── Agent Productivity ── */}
      <div className="dash-card">
        <div className="dash-card-head">
          <h3>Agent Productivity</h3>
          {loading && <span className="badge-pill">Loading…</span>}
        </div>
        {!loading && productivity.length === 0 && (
          <div className="dash-empty">No activity in this period.</div>
        )}
        {productivity.length > 0 && (
          <table className="dash-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Agent</th>
                <th>Logged</th>
                <th>Closed</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {productivity.map((p, i) => (
                <tr key={p.agent_name || i}>
                  <td className="dash-num" style={{ color: '#94a3b8', fontSize: 12 }}>{i + 1}</td>
                  <td><div className="dash-agent-name">{p.agent_name || '—'}</div></td>
                  <td className="dash-num">{p.logged}</td>
                  <td className="dash-num dash-num-green">{p.closed}</td>
                  <td className="dash-num dash-num-orange">{p.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
