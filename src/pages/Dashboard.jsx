import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { vmm } from '../api/vmm';
import './Dashboard.css';

const STATUS_COLORS = { Escalated: 'red', Open: 'blue', Closed: 'green', 'Partially Closed': 'amber', 'Not Connected': 'orange' };

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Val({ loading, value }) {
  if (loading) return <span style={{ fontSize: 18, color: '#94a3b8' }}>…</span>;
  return typeof value === 'number' ? value.toLocaleString() : (value ?? '—');
}

export default function Dashboard() {
  const [stats,        setStats]        = useState({});
  const [recent,       setRecent]       = useState([]);
  const [productivity, setProductivity] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');

  useEffect(() => {
    vmm.dashboardStats()
      .then(res => {
        if (res.success) {
          setStats(res.stats || {});
          setRecent(res.recentComplaints || []);
          setProductivity(res.productivity || []);
        } else {
          setError('Dashboard data returned unexpected format.');
        }
      })
      .catch(() => setError('Could not load dashboard data — check n8n connection.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="dashboard">
      <div className="page-heading">
        <h2>Dashboard</h2>
        <p>VMM Facility Complaints — Overview</p>
      </div>

      {error && <div className="dash-error">{error}</div>}

      {/* ── Row 1: Volume stats ── */}
      <div className="stats-grid">
        <div className="stat-card stat-purple">
          <div className="stat-label">Total Complaints</div>
          <div className="stat-value"><Val loading={loading} value={stats.totalAll} /></div>
          <div className="stat-sub">All time</div>
        </div>
        <div className="stat-card stat-blue">
          <div className="stat-label">Open Now</div>
          <div className="stat-value"><Val loading={loading} value={stats.totalOpen} /></div>
          <div className="stat-sub">Pending resolution</div>
        </div>
        <div className="stat-card stat-green">
          <div className="stat-label">Closed</div>
          <div className="stat-value"><Val loading={loading} value={stats.totalClosed} /></div>
          <div className="stat-sub">All time</div>
        </div>
        <div className="stat-card stat-red">
          <div className="stat-label">Critical</div>
          <div className="stat-value"><Val loading={loading} value={stats.critical} /></div>
          <div className="stat-sub">Overdue &gt; 7 days</div>
        </div>
      </div>

      {/* ── Row 2: Period stats ── */}
      <div className="stats-grid stats-grid-sm">
        <div className="stat-card stat-indigo">
          <div className="stat-label">Logged Today</div>
          <div className="stat-value stat-value-sm"><Val loading={loading} value={stats.loggedToday} /></div>
        </div>
        <div className="stat-card stat-indigo">
          <div className="stat-label">Logged This Week</div>
          <div className="stat-value stat-value-sm"><Val loading={loading} value={stats.loggedWeek} /></div>
        </div>
        <div className="stat-card stat-indigo">
          <div className="stat-label">Logged This Month</div>
          <div className="stat-value stat-value-sm"><Val loading={loading} value={stats.loggedMonth} /></div>
        </div>
        <div className="stat-card stat-teal">
          <div className="stat-label">Closed Today</div>
          <div className="stat-value stat-value-sm"><Val loading={loading} value={stats.closedToday} /></div>
        </div>
        <div className="stat-card stat-teal">
          <div className="stat-label">Closed This Week</div>
          <div className="stat-value stat-value-sm"><Val loading={loading} value={stats.closedWeek} /></div>
        </div>
        <div className="stat-card stat-teal">
          <div className="stat-label">Closed This Month</div>
          <div className="stat-value stat-value-sm"><Val loading={loading} value={stats.closedMonth} /></div>
        </div>
      </div>

      <div className="dash-two-col">

        {/* ── Recent Open Complaints ── */}
        <div className="dash-card dash-card-wide">
          <div className="dash-card-head">
            <h3>Open Complaints</h3>
            {loading && <span className="badge-pill">Loading…</span>}
            {!loading && <span className="badge-pill">{recent.length} shown</span>}
          </div>
          {!loading && recent.length === 0 && (
            <div className="dash-empty">No open complaints. All clear!</div>
          )}
          {recent.length > 0 && (
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Complaint No</th>
                  <th>Store</th>
                  <th>Product</th>
                  <th>Status</th>
                  <th>EDC</th>
                  <th>Overdue</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(r => {
                  const status = r.status || 'Open';
                  const color  = STATUS_COLORS[status] || 'blue';
                  const days   = r.days_overdue;
                  return (
                    <tr key={r.id} className={days > 0 ? 'row-overdue' : ''}>
                      <td className="mono">
                        <Link to={`/complaints/${r.id}`} className="dash-link">
                          {r.complaintno || `#${r.id}`}
                        </Link>
                      </td>
                      <td>
                        <div className="dash-store-name">{r.store_name || r.storename || '—'}</div>
                        <div className="dash-store-code">{r.storecode} {r.city ? `· ${r.city}` : ''}</div>
                      </td>
                      <td>
                        <div>{r.productname}</div>
                        <div className="dash-vendor">{r.vendorname}</div>
                      </td>
                      <td><span className={`status-tag status-${color}`}>{status}</span></td>
                      <td className="dash-date">{fmtDate(r.closuredate)}</td>
                      <td className={days > 0 ? 'overdue' : 'dash-date'}>
                        {days > 0 ? `${days}d` : days === 0 ? 'Today' : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Agent Productivity ── */}
        <div className="dash-card">
          <div className="dash-card-head">
            <h3>Agent Productivity</h3>
            <span className="dash-period-note">This month</span>
          </div>
          {!loading && productivity.length === 0 && (
            <div className="dash-empty">No activity this month.</div>
          )}
          {productivity.length > 0 && (
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Logged</th>
                  <th>Closed</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {productivity.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <div className="dash-agent-name">{p.agent_name || `Agent (uid ${p.uid})`}</div>
                    </td>
                    <td className="dash-num">{p.logged}</td>
                    <td className="dash-num dash-num-green">{p.closed}</td>
                    <td className="dash-num dash-num-orange">{p.open}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="dash-prod-note">
            Agent names will show once user login is configured.
          </div>
        </div>

      </div>
    </div>
  );
}
