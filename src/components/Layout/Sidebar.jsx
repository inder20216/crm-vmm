import { NavLink, useLocation } from 'react-router-dom';
import './Sidebar.css';

const NAV = [
  {
    label: 'Dashboard',
    icon: '⊞',
    to: '/',
  },
  {
    label: 'Complaints',
    icon: '📋',
    children: [
      { label: 'Log New Case',  to: '/complaints/add' },
      { label: 'Search',        to: '/complaints/search' },
      { label: 'Email Inbox',   to: '/complaints/email' },
    ],
  },
  {
    label: 'NTR Requests',
    icon: '📦',
    to: '/ntr',
  },
  {
    label: 'Follow-up',
    icon: '🔁',
    to: '/followup',
  },
  {
    label: 'Reports',
    icon: '📊',
    to: '/reports',
  },
];

export default function Sidebar({ collapsed, onToggle }) {
  const location = useLocation();

  const isParentActive = (children) =>
    children?.some(c => location.pathname.startsWith(c.to));

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-logo">
        <div className="sidebar-logo-mark">OM</div>
        {!collapsed && (
          <div className="sidebar-logo-text">
            <div className="sidebar-logo-name">Open Mind</div>
            <div className="sidebar-logo-sub">VMM CRM</div>
          </div>
        )}
      </div>

      <nav className="sidebar-nav">
        {NAV.map(item =>
          item.children ? (
            <div key={item.label} className="nav-group">
              <div className={`nav-group-label ${isParentActive(item.children) ? 'active' : ''}`}>
                <span className="nav-icon">{item.icon}</span>
                {!collapsed && <span>{item.label}</span>}
              </div>
              {!collapsed && (
                <div className="nav-children">
                  {item.children.map(child => (
                    <NavLink
                      key={child.to}
                      to={child.to}
                      className={({ isActive }) => `nav-child ${isActive ? 'active' : ''}`}
                    >
                      → {child.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          )
        )}
      </nav>

      <button className="sidebar-toggle" onClick={onToggle} title="Toggle sidebar">
        {collapsed ? '›' : '‹'}
      </button>
    </aside>
  );
}
