import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { loginRequest } from './auth/msalConfig';
import { useAuth } from './context/AuthContext';
import Sidebar from './components/Layout/Sidebar';
import Dashboard from './pages/Dashboard';
import CaseLoggingForm from './components/CaseLogging/CaseLoggingForm';
import SearchComplaints from './pages/SearchComplaints';
import EmailComplaints    from './pages/EmailComplaints';
import NtrRequests        from './pages/NtrRequests';
import ComplaintDetail    from './pages/ComplaintDetail';
import Reports             from './pages/Reports';
import FollowUp            from './pages/FollowUp';
import UserManagement      from './pages/UserManagement';
import './App.css';

function LoginScreen({ onLogin, loading }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{
        flex: '0 0 55%', background: 'linear-gradient(145deg, #1e1b4b 0%, #2d2a6e 60%, #1e1b4b 100%)',
        display: 'flex', flexDirection: 'column', padding: '56px 64px', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -80, right: -80, width: 320, height: 320, borderRadius: '50%', background: 'rgba(124,58,237,.12)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -60, left: -60, width: 240, height: 240, borderRadius: '50%', background: 'rgba(124,58,237,.08)', pointerEvents: 'none' }} />
        <div style={{ marginBottom: 64, position: 'relative' }}>
          <img src="https://raw.githubusercontent.com/inder20216/openmind-assets/main/logo.png" alt="Open Mind" style={{ height: 48, objectFit: 'contain' }} />
        </div>
        <div style={{ position: 'relative', marginBottom: 48 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, color: '#fff', lineHeight: 1.2, margin: '0 0 16px', maxWidth: 420 }}>
            Manage facility complaints with full visibility
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,.55)', lineHeight: 1.7, margin: 0, maxWidth: 400 }}>
            One platform for logging, tracking, escalating, and closing VMM facility complaints — connected to vendors, stores, and your Outlook inbox.
          </p>
        </div>
        <div style={{ marginTop: 'auto', paddingTop: 48, fontSize: 11, color: 'rgba(255,255,255,.25)', position: 'relative' }}>
          Secured by Microsoft Entra ID &nbsp;·&nbsp; vmm.helpdesk@openmind.in
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: '40px 32px' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: '#1e1b4b', margin: '0 0 8px' }}>Welcome to Open Mind's Facility Management CRM</h2>
            <p style={{ fontSize: 14, color: '#64748b', margin: 0, lineHeight: 1.6 }}>Sign in with your official Microsoft account</p>
          </div>
          <button onClick={onLogin} disabled={loading} style={{
            width: '100%', padding: '14px 0', background: loading ? '#94a3b8' : '#0078d4',
            color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 12, boxShadow: loading ? 'none' : '0 4px 14px rgba(0,120,212,.35)', transition: 'all .2s',
          }}>
            <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
              <rect width="10" height="10" fill="#F25022"/><rect x="11" width="10" height="10" fill="#7FBA00"/>
              <rect y="11" width="10" height="10" fill="#00A4EF"/><rect x="11" y="11" width="10" height="10" fill="#FFB900"/>
            </svg>
            {loading ? 'Redirecting to Microsoft…' : 'Sign in with Microsoft'}
          </button>
          <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 14 }}>Signing in with your official email account</p>
          <p style={{ textAlign: 'center', fontSize: 11, color: '#cbd5e1', marginTop: 24, borderTop: '1px solid #e2e8f0', paddingTop: 24 }}>
            Open Mind Services Limited &nbsp;·&nbsp; CRM v1.0
          </p>
        </div>
      </div>
    </div>
  );
}

// Shown after Microsoft login but before MySQL role check completes, or if user is not in the system
function NotAuthorized({ onLogout }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: "-apple-system, sans-serif" }}>
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1e1b4b', marginBottom: 8 }}>Access Not Granted</h2>
        <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, marginBottom: 24 }}>
          Your Microsoft account is not registered in the CRM. Contact your Admin to be added.
        </p>
        <button onClick={onLogout} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          Sign out
        </button>
      </div>
    </div>
  );
}

// Blocks routes the user's role cannot access — redirects to their default page
function RoleRoute({ adminOnly, children }) {
  const { currentUser } = useAuth();
  if (!currentUser) return <Navigate to="/" replace />;
  if (adminOnly && currentUser.role !== 'admin') return <Navigate to="/complaints/email" replace />;
  return children;
}

export default function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const isAuthenticated = useIsAuthenticated();
  const { instance } = useMsal();
  const { currentUser, roleLoading } = useAuth();

  const handleLogin = () => {
    setLoginLoading(true);
    instance.loginRedirect(loginRequest).catch(e => { console.error('Login failed', e); setLoginLoading(false); });
  };
  const handleLogout = () => instance.logoutRedirect();

  if (!isAuthenticated) return <LoginScreen onLogin={handleLogin} loading={loginLoading} />;
  if (roleLoading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7c3aed', fontFamily: 'sans-serif', fontSize: 14 }}>
      Checking access…
    </div>
  );
  if (!currentUser) return <NotAuthorized onLogout={handleLogout} />;

  const isAdmin = currentUser.role === 'admin';

  return (
    <BrowserRouter>
      <div className="app-shell">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} role={currentUser.role} />
        <div className="app-body">
          <header className="top-bar">
            <span className="top-bar-title">VMM Facility Management CRM</span>
            <div className="top-bar-user" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="user-dot" />
              <span>{currentUser.name}</span>
              {isAdmin && (
                <span style={{ fontSize: 10, background: '#7c3aed18', color: '#7c3aed', borderRadius: 10, padding: '2px 8px', fontWeight: 700 }}>
                  {currentUser.type === 'superadmin' ? 'Super Admin' : 'Admin'}
                </span>
              )}
              <button onClick={handleLogout} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#64748b', cursor: 'pointer' }}>
                Sign out
              </button>
            </div>
          </header>
          <main className="app-main">
            <Routes>
              {/* Agent-accessible routes */}
              <Route path="/complaints/email"  element={<EmailComplaints />} />
              <Route path="/complaints/search" element={<SearchComplaints />} />
              <Route path="/complaints/:id"    element={<ComplaintDetail />} />

              {/* Admin-only routes */}
              <Route path="/" element={<RoleRoute adminOnly><Dashboard /></RoleRoute>} />
              <Route path="/complaints/add" element={<RoleRoute adminOnly><div className="main"><CaseLoggingForm /></div></RoleRoute>} />
              <Route path="/ntr"            element={<RoleRoute adminOnly><NtrRequests /></RoleRoute>} />
              <Route path="/followup"       element={<RoleRoute adminOnly><FollowUp /></RoleRoute>} />
              <Route path="/reports"        element={<RoleRoute adminOnly><Reports /></RoleRoute>} />
              <Route path="/users"          element={<RoleRoute adminOnly><UserManagement /></RoleRoute>} />

              {/* Fallback — send agents straight to inbox */}
              <Route path="*" element={<Navigate to={isAdmin ? '/' : '/complaints/email'} replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
