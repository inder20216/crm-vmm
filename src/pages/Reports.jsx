import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { vmm } from '../api/vmm';
import './Reports.css';

const TYPE_COLORS   = { Breakdown: '#dc2626', Repair: '#ea580c', Maintenance: '#2563eb', Requirement: '#7c3aed' };
const STATUS_COLORS = { Open: '#2563eb', Escalated: '#dc2626', 'Not Connected': '#ea580c', 'Partially Closed': '#d97706', Closed: '#16a34a' };

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function BarRow({ label, count, total, color }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="rpt-bar-row">
      <div className="rpt-bar-label">{label}</div>
      <div className="rpt-bar-track">
        <div className="rpt-bar-fill" style={{ width: `${pct}%`, background: color || '#7c3aed' }} />
      </div>
      <div className="rpt-bar-count">{count}</div>
    </div>
  );
}

export default function Reports() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const load = () => {
    setLoading(true);
    setError('');
    vmm.getReports()
      .then(res => {
        if (res.success) { setData(res); setLastRefresh(new Date()); }
        else setError('Failed to load report data.');
      })
      .catch(() => setError('Could not reach server.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const totalOpen  = data ? (data.typeBreakdown.reduce((s, r) => s + r.count, 0)) : 0;
  const totalAll   = data ? (data.statusBreakdown.reduce((s, r) => s + r.count, 0)) : 0;
  const overdue    = data?.overdueBreakdown;

  return (
    <div className="rpt-page">
      <div className="rpt-header">
        <div>
          <h2>Reports</h2>
          <p>VMM Facility Complaints — Live Summary</p>
        </div>
        <div className="rpt-header-right">
          <span className="rpt-refresh-time">
            {loading ? 'Refreshing…' : `Updated ${lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
          </span>
          <button className="rpt-refresh-btn" onClick={load} disabled={loading}>↻ Refresh</button>
        </div>
      </div>

      {error && <div className="rpt-error">{error}</div>}

      {loading && !data && (
        <div className="rpt-loading">Loading report data…</div>
      )}

      {data && (
        <>
          {/* Overdue Summary Cards */}
          <div className="rpt-overdue-grid">
            <div className="rpt-ov-card rpt-ov-critical">
              <div className="rpt-ov-num">{overdue.critical}</div>
              <div className="rpt-ov-label">Critical (&gt;7 days)</div>
            </div>
            <div className="rpt-ov-card rpt-ov-high">
              <div className="rpt-ov-num">{overdue.high}</div>
              <div className="rpt-ov-label">High (1–7 days)</div>
            </div>
            <div className="rpt-ov-card rpt-ov-today">
              <div className="rpt-ov-num">{overdue.dueToday}</div>
              <div className="rpt-ov-label">Due Today</div>
            </div>
            <div className="rpt-ov-card rpt-ov-future">
              <div className="rpt-ov-num">{overdue.future}</div>
              <div className="rpt-ov-label">Future (within TAT)</div>
            </div>
            <div className="rpt-ov-card rpt-ov-noedc">
              <div className="rpt-ov-num">{overdue.noEdc}</div>
              <div className="rpt-ov-label">No EDC Set</div>
            </div>
          </div>

          <div className="rpt-grid-2">

            {/* Status Breakdown */}
            <div className="rpt-card">
              <div className="rpt-card-title">Status Breakdown — All Complaints</div>
              <div className="rpt-bars">
                {data.statusBreakdown.map(r => (
                  <BarRow
                    key={r.status}
                    label={r.status || 'Open'}
                    count={r.count}
                    total={totalAll}
                    color={STATUS_COLORS[r.status] || '#64748b'}
                  />
                ))}
                {data.statusBreakdown.length === 0 && (
                  <div className="rpt-empty">No data yet.</div>
                )}
              </div>
            </div>

            {/* Type Breakdown */}
            <div className="rpt-card">
              <div className="rpt-card-title">Complaint Type — Open Only</div>
              <div className="rpt-bars">
                {data.typeBreakdown.map(r => (
                  <BarRow
                    key={r.type}
                    label={r.type || 'Unknown'}
                    count={r.count}
                    total={totalOpen}
                    color={TYPE_COLORS[r.type] || '#64748b'}
                  />
                ))}
                {data.typeBreakdown.length === 0 && (
                  <div className="rpt-empty">No open complaints.</div>
                )}
              </div>
            </div>

            {/* Zone Breakdown */}
            {data.zoneBreakdown.length > 0 && (
              <div className="rpt-card">
                <div className="rpt-card-title">Zone-wise Open Complaints</div>
                <div className="rpt-bars">
                  {data.zoneBreakdown.map(r => (
                    <BarRow
                      key={r.zone}
                      label={r.zone}
                      count={r.count}
                      total={totalOpen}
                      color="#0891b2"
                    />
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* Top Overdue Table */}
          {data.topOverdue.length > 0 && (
            <div className="rpt-card rpt-card-full">
              <div className="rpt-card-title">
                Most Overdue Open Complaints
                <span className="rpt-count-badge">{data.topOverdue.length}</span>
              </div>
              <table className="rpt-table">
                <thead>
                  <tr>
                    <th>Complaint No</th>
                    <th>Store</th>
                    <th>Product</th>
                    <th>Type</th>
                    <th>EDC</th>
                    <th>Days Overdue</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topOverdue.map(r => {
                    const days   = r.days_overdue;
                    const isCrit = days > 7;
                    const tColor = TYPE_COLORS[r.typeofcomplaint] || '#64748b';
                    return (
                      <tr key={r.id}>
                        <td className="mono">
                          <Link to={`/complaints/${r.id}`} style={{ color: '#7c3aed', textDecoration: 'none' }}>
                            {r.complaintno}
                          </Link>
                        </td>
                        <td>
                          <div>{r.store_name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>{r.city}</div>
                        </td>
                        <td>{r.productname}</td>
                        <td>
                          <span className="rpt-type-dot" style={{ background: tColor }} />
                          {r.typeofcomplaint}
                        </td>
                        <td style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(r.edc)}</td>
                        <td className={isCrit ? 'rpt-critical' : 'rpt-high'}>
                          {isCrit ? `⚠ ${days}d` : `${days}d`}
                        </td>
                        <td>
                          <span className="rpt-status-text" style={{ color: STATUS_COLORS[r.current_status] || '#64748b' }}>
                            {r.current_status || 'Open'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
