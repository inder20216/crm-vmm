import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import './BulkClose.css';

const BASE = import.meta.env.VITE_API_BASE || 'https://automation.openmindhelpline.com/webhook';

export default function BulkClose() {
  const { currentUser } = useAuth();
  if (currentUser?.role !== 'admin') return <Navigate to="/complaints/email" replace />;

  const [file,          setFile]          = useState(null);
  const [uploading,     setUploading]     = useState(false);
  const [uploadDone,    setUploadDone]    = useState(false);
  const [uploadStatus,  setUploadStatus]  = useState(null); // { ok, msg }
  const [running,       setRunning]       = useState(false);
  const [runStatus,     setRunStatus]     = useState(null); // { ok, msg }
  const fileInputRef = useRef();

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setUploadDone(false);
    setUploadStatus(null);
    setRunStatus(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.name.endsWith('.csv')) {
      setFile(f);
      setUploadDone(false);
      setUploadStatus(null);
      setRunStatus(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadStatus(null);
    try {
      const buffer = await file.arrayBuffer();
      const blob = new Blob([buffer], { type: 'text/csv' });
      const formData = new FormData();
      formData.append('data', blob, file.name);
      const res = await fetch(`${BASE}/vmm-csv-upload`, { method: 'POST', body: formData });
      if (res.ok) {
        setUploadDone(true);
        setUploadStatus({ ok: true, msg: `${file.name} uploaded — rows added to sheet.` });
      } else {
        setUploadStatus({ ok: false, msg: `Upload failed (${res.status} ${res.statusText})` });
      }
    } catch (err) {
      setUploadStatus({ ok: false, msg: 'Connection error. Check your network.' });
    } finally {
      setUploading(false);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setRunStatus(null);
    try {
      const res = await fetch(`${BASE}/close-cases`, { method: 'POST' });
      let body = null;
      try { body = await res.json(); } catch {}
      if (!res.ok) {
        setRunStatus({ ok: false, msg: `Process failed (${res.status} ${res.statusText})` });
        return;
      }
      if (body?.status === 'error' || body?.success === false) {
        setRunStatus({ ok: false, msg: body.message || 'Workflow reported an error. Check n8n logs.' });
        return;
      }
      const count = body?.count;
      const msg = count != null
        ? `${count} case${count !== 1 ? 's' : ''} closed. Closure emails sent to stores and FMs.`
        : 'All pending cases processed. Closure emails sent to stores and FMs.';
      setRunStatus({ ok: true, msg });
      setFile(null);
      setUploadDone(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setRunStatus({ ok: false, msg: 'Connection error. Check your network.' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bc-page">
      <div className="bc-header">
        <h1 className="bc-title">Bulk Close Cases</h1>
        <p className="bc-subtitle">Upload a CSV to close multiple complaints and send closure emails in one go</p>
      </div>

      <div className="bc-body">

        {/* ── Step 1 ── */}
        <div className={`bc-step${uploadDone ? ' bc-step-done' : ''}`}>
          <div className="bc-step-num">1</div>
          <div className="bc-step-content">
            <div className="bc-step-title">Upload CSV File</div>
            <div className="bc-step-desc">
              Required columns: <strong>Complaint No</strong>, <strong>Email Subject</strong>,{' '}
              <strong>Case Closed By</strong>, <strong>Remarks</strong>
            </div>

            <div
              className={`bc-dropzone${file ? ' bc-dropzone-ready' : ''}`}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              {file ? (
                <>
                  <div className="bc-file-icon">📄</div>
                  <div className="bc-file-name">{file.name}</div>
                  <div className="bc-file-size">{(file.size / 1024).toFixed(1)} KB · Click to change</div>
                </>
              ) : (
                <>
                  <div className="bc-file-icon">☁</div>
                  <div className="bc-drop-text">Drop a CSV file here or <span>click to browse</span></div>
                </>
              )}
            </div>

            <button
              className="bc-btn bc-btn-upload"
              onClick={handleUpload}
              disabled={!file || uploading}
            >
              {uploading ? 'Uploading…' : 'Upload CSV'}
            </button>

            {uploadStatus && (
              <div className={`bc-status${uploadStatus.ok ? ' bc-status-ok' : ' bc-status-err'}`}>
                {uploadStatus.ok ? '✓' : '✕'} {uploadStatus.msg}
              </div>
            )}
          </div>
        </div>

        {/* ── Arrow ── */}
        <div className="bc-arrow">↓</div>

        {/* ── Step 2 ── */}
        <div className={`bc-step${!uploadDone ? ' bc-step-locked' : ''}`}>
          <div className="bc-step-num">2</div>
          <div className="bc-step-content">
            <div className="bc-step-title">Run Bulk Close</div>
            <div className="bc-step-desc">
              Closes all pending rows from the sheet, inserts complaint logs, and sends closure emails to each store and FM.
            </div>

            <button
              className="bc-btn bc-btn-run"
              onClick={handleRun}
              disabled={!uploadDone || running}
            >
              {running ? 'Processing…' : 'Close All Pending Cases'}
            </button>

            {runStatus && (
              <div className={`bc-status${runStatus.ok ? ' bc-status-ok' : ' bc-status-err'}`}>
                {runStatus.ok ? '✓' : '✕'} {runStatus.msg}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
