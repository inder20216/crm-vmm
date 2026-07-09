import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Layout/Sidebar';
import Dashboard from './pages/Dashboard';
import CaseLoggingForm from './components/CaseLogging/CaseLoggingForm';
import SearchComplaints from './pages/SearchComplaints';
import EmailComplaints    from './pages/EmailComplaints';
import NtrRequests        from './pages/NtrRequests';
import ComplaintDetail    from './pages/ComplaintDetail';
import Reports             from './pages/Reports';
import FollowUp            from './pages/FollowUp';
import './App.css';

export default function App() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <BrowserRouter>
      <div className="app-shell">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
        <div className="app-body">
          <header className="top-bar">
            <span className="top-bar-title">VMM Facility Management CRM</span>
            <div className="top-bar-user">
              <span className="user-dot" />
              <span>VMM Agent</span>
            </div>
          </header>
          <main className="app-main">
            <Routes>
              <Route path="/"                  element={<Dashboard />} />
              <Route path="/complaints/add"    element={<div className="main"><CaseLoggingForm /></div>} />
              <Route path="/complaints/search" element={<SearchComplaints />} />
              <Route path="/complaints/email"  element={<EmailComplaints />} />
              <Route path="/ntr"              element={<NtrRequests />} />
              <Route path="/complaints/:id"   element={<ComplaintDetail />} />
              <Route path="/followup"         element={<FollowUp />} />
              <Route path="/reports"          element={<Reports />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
