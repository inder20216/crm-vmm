import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { vmm } from '../api/vmm';
import './SearchComplaints.css';

const STATUS_COLORS = {
  Logged: 'blue', Open: 'blue', Escalated: 'red',
  Closed: 'green', Resolved: 'green',
  'Partially Closed': 'amber', 'Not Connected': 'orange',
};
const TYPE_COLORS = { Breakdown: 'red', Repair: 'orange', Maintenance: 'blue', Requirement: 'purple' };

function bufStr(v) {
  if (v == null) return null;
  if (typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) {
    try { return new TextDecoder().decode(new Uint8Array(v.data)); } catch { return ''; }
  }
  return v;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function normalise(rows) {
  return rows.map(c => ({
    ...c,
    complaintno:     bufStr(c.complaintno),
    store_name:      bufStr(c.store_name),
    store_code:      bufStr(c.store_code),
    city:            bufStr(c.city),
    state:           bufStr(c.state),
    productname:     bufStr(c.productname),
    vendorname:      bufStr(c.vendorname),
    typeofcomplaint: bufStr(c.typeofcomplaint),
    current_status:  bufStr(c.current_status),
    fmname:          bufStr(c.fmname),
    fmmobileno:      bufStr(c.fmmobileno),
    vendor_ticketno: bufStr(c.vendor_ticketno),
  }));
}

export default function SearchComplaints() {
  const [query,    setQuery]    = useState('');
  const [statusF,  setStatusF]  = useState('');
  const [typeF,    setTypeF]    = useState('');
  const [vendorF,  setVendorF]  = useState('');
  const [fmF,      setFmF]      = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate,   setToDate]   = useState('');
  const [edcFrom,  setEdcFrom]  = useState('');
  const [edcTo,    setEdcTo]    = useState('');
  const [perPage,  setPerPage]  = useState(50);
  const [page,     setPage]     = useState(1);

  const [loading,  setLoading]  = useState(false);
  const [results,  setResults]  = useState([]);
  const [total,    setTotal]    = useState(0);
  const [error,    setError]    = useState('');

  const fetchComplaints = async (params, pg = 1, pp = perPage) => {
    setLoading(true);
    setError('');
    try {
      const res = await vmm.searchComplaints({ ...params, limit: pp, offset: (pg - 1) * pp });
      setResults(normalise(res.complaints || []));
      setTotal(res.total ?? res.count ?? 0);
      setPage(pg);
    } catch {
      setError('Could not reach server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const currentFilters = () => ({
    q: query.trim(), status: statusF, type: typeF,
    vendor: vendorF, fm: fmF, fromDate, toDate, edcFrom, edcTo,
  });

  const doSearch  = (pg = 1) => fetchComplaints(currentFilters(), pg);
  const clearAll  = () => {
    setQuery(''); setStatusF(''); setTypeF('');
    setVendorF(''); setFmF('');
    setFromDate(''); setToDate('');
    setEdcFrom(''); setEdcTo('');
    fetchComplaints({}, 1, perPage);
  };

  useEffect(() => { fetchComplaints({}, 1, 50); }, []);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const rangeStart = (page - 1) * perPage + 1;
  const rangeEnd   = Math.min(page * perPage, total);

  return (
    <div className="sc-page">
      <div className="page-heading">
        <h2>All Complaints</h2>
        <p>VMM Facility Complaints — Search &amp; Filter</p>
      </div>

      <div className="sc-filters">
        {/* Row 1 */}
        <div className="sc-filter-row">
          <input
            className="sc-input sc-input-wide"
            type="text"
            placeholder="Complaint No., Vendor Ticket, Store, Product, Employee…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch(1)}
          />
          <select className="sc-select" value={statusF} onChange={e => setStatusF(e.target.value)}>
            <option value="">Status — All</option>
            <option>Logged</option>
            <option>Open</option>
            <option>Escalated</option>
            <option>Not Connected</option>
            <option>Partially Closed</option>
            <option>Closed</option>
          </select>
          <select className="sc-select" value={typeF} onChange={e => setTypeF(e.target.value)}>
            <option value="">Type — All</option>
            <option>Breakdown</option>
            <option>Repair</option>
            <option>Maintenance</option>
            <option>Requirement</option>
          </select>
          <button className="sc-btn-primary" onClick={() => doSearch(1)} disabled={loading}>
            {loading ? 'Loading…' : 'Search'}
          </button>
          <button className="sc-btn-ghost" onClick={clearAll} disabled={loading}>Reset</button>
        </div>

        {/* Row 2 */}
        <div className="sc-filter-row sc-filter-row-2">
          <input className="sc-input sc-input-sm" placeholder="Vendor" value={vendorF} onChange={e => setVendorF(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch(1)} />
          <input className="sc-input sc-input-sm" placeholder="FM Name" value={fmF} onChange={e => setFmF(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch(1)} />
          <div className="sc-date-group">
            <span className="sc-date-label">Date From</span>
            <input className="sc-input sc-input-date" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div className="sc-date-group">
            <span className="sc-date-label">Date To</span>
            <input className="sc-input sc-input-date" type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
          <div className="sc-date-group">
            <span className="sc-date-label">EDC From</span>
            <input className="sc-input sc-input-date" type="date" value={edcFrom} onChange={e => setEdcFrom(e.target.value)} />
          </div>
          <div className="sc-date-group">
            <span className="sc-date-label">EDC To</span>
            <input className="sc-input sc-input-date" type="date" value={edcTo} onChange={e => setEdcTo(e.target.value)} />
          </div>
        </div>
      </div>

      {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div className="dash-card">
        <div className="dash-card-head">
          <h3>Complaints</h3>
          <span className="badge-count">{total.toLocaleString()} Total Records</span>
          <div className="sc-perpage">
            <label>Show</label>
            <select
              className="sc-select-sm"
              value={perPage}
              onChange={e => {
                const pp = Number(e.target.value);
                setPerPage(pp);
                fetchComplaints(currentFilters(), 1, pp);
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
            <label>records</label>
          </div>
        </div>

        {loading && results.length === 0 ? (
          <div className="sc-loading">Loading complaints…</div>
        ) : results.length === 0 ? (
          <div className="sc-empty-state">
            <div className="sc-empty-icon">📭</div>
            <p>No complaints found matching your criteria.</p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="dash-table">
                <thead>
                  <tr>
                    <th style={{ width: 46 }}>#</th>
                    <th>Complaint Date</th>
                    <th>Complaint No.</th>
                    <th>Vendor Ticket</th>
                    <th>Aging</th>
                    <th>Store Code</th>
                    <th>Store Name</th>
                    <th>State</th>
                    <th>FM Name</th>
                    <th>Product</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, idx) => {
                    const status = r.current_status || 'Open';
                    const sColor = STATUS_COLORS[status] || 'blue';
                    const aging  = parseInt(r.aging ?? 0);
                    return (
                      <tr key={r.id}>
                        <td className="date-cell" style={{ color: '#94a3b8' }}>{rangeStart + idx}</td>
                        <td className="date-cell">{fmtDate(r.created)}</td>
                        <td className="mono">
                          <Link to={`/complaints/${r.complaintno}`} style={{ color: '#7c3aed', textDecoration: 'none' }}>
                            {r.complaintno}
                          </Link>
                        </td>
                        <td className="mono" style={{ fontSize: 11 }}>{r.vendor_ticketno || '—'}</td>
                        <td className={aging > 30 ? 'overdue' : 'days-cell'} style={{ fontWeight: aging > 30 ? 700 : 400 }}>
                          {aging}d
                        </td>
                        <td className="mono" style={{ fontSize: 11 }}>{r.store_code || '—'}</td>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{r.store_name || '—'}</div>
                          {r.city && <div className="store-code">{r.city}</div>}
                        </td>
                        <td className="date-cell">{r.state || '—'}</td>
                        <td style={{ fontSize: 12 }}>
                          <div>{r.fmname || '—'}</div>
                          {r.fmmobileno && <div className="store-code">{r.fmmobileno}</div>}
                        </td>
                        <td style={{ maxWidth: 160 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.productname || '—'}
                          </div>
                          {r.vendorname && <div className="vendor-name">{r.vendorname}</div>}
                        </td>
                        <td>
                          <span className={`status-tag status-${sColor}`}>{status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="sc-pagination">
              <span className="sc-pg-info">
                Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {total.toLocaleString()} records
              </span>
              <div className="sc-pg-btns">
                <button className="sc-pg-btn" disabled={page === 1 || loading} onClick={() => doSearch(1)}>«</button>
                <button className="sc-pg-btn" disabled={page === 1 || loading} onClick={() => doSearch(page - 1)}>‹ Prev</button>
                <span className="sc-pg-cur">Page {page} of {totalPages}</span>
                <button className="sc-pg-btn" disabled={page >= totalPages || loading} onClick={() => doSearch(page + 1)}>Next ›</button>
                <button className="sc-pg-btn" disabled={page >= totalPages || loading} onClick={() => doSearch(totalPages)}>»</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
