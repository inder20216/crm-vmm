import { useEffect, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import { vmm } from '../api/vmm';
import { STAGES, executePipeline, runParseAll, runParse } from '../workflow/emailPipeline';
import 'reactflow/dist/style.css';
import './EmailFlow.css';

const nodeTypes = { mail: MailStageNode };

function PreviewRows({ data }) {
  if (data == null) return <div className="ef-preview-empty">no data</div>;
  return (
    <div className="ef-preview-box">
      {Object.entries(data).map(([k, v]) => {
        if (v == null) return null;
        const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, x => x.toUpperCase());
        if (typeof v === 'string' && v.length > 200) {
          return (
            <div className="ef-preview-row" key={k}>
              <span className="ef-preview-label">{label}</span>
              <details className="ef-preview-text"><summary>{v.slice(0, 120)}…</summary>{v}</details>
            </div>
          );
        }
        if (Array.isArray(v)) {
          return (
            <div className="ef-preview-row" key={k}>
              <span className="ef-preview-label">{label}</span>
              <div className="ef-preview-arr">
                {v.map((item, i) => (
                  <div key={i} className="ef-preview-arr-item">{typeof item === 'object' ? <PreviewRows data={item} /> : String(item)}</div>
                ))}
              </div>
            </div>
          );
        }
        if (typeof v === 'object') {
          return (
            <div className="ef-preview-row" key={k}>
              <span className="ef-preview-label">{label}</span>
              <div className="ef-preview-object"><PreviewRows data={v} /></div>
            </div>
          );
        }
        return (
          <div className="ef-preview-row" key={k}>
            <span className="ef-preview-label">{label}</span>
            <span className="ef-preview-value">{String(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

function MailStageNode({ data, selected }) {
  const showCount = data.count && data.count !== '…';
  return (
    <div className={`mail-node tone-${data.tone} ${selected ? 'selected' : ''} ${data.disabled ? 'is-off' : ''}`}>
      <Handle type="target" position={Position.Top} className="mail-handle" />
      <Handle type="source" position={Position.Bottom} className="mail-handle" />
      <div className="mail-node-icon">{data.icon}</div>
      <div className="mail-node-main">
        <div className="mail-node-title">
          {data.label}
          {data.disabled && <span className="mail-node-off-badge">off</span>}
        </div>
        {data.detail && <div className="mail-node-detail">{data.detail}</div>}
        {data.engine && <div className="mail-node-engine">{data.engine}</div>}
      </div>
      {data.count != null && (
        <div className={`mail-node-count ${showCount ? '' : 'pulsing'}`}>{data.count}</div>
      )}
    </div>
  );
}

const EDGE_STYLE = { strokeWidth: 2, strokeDasharray: '6 6' };
const MARK = { type: MarkerType.ArrowClosed };

const EDGES = [
  { id: 'e-inbox-fetch',   source: 'inbox', target: 'fetch',     animated: true, label: 'delta',            style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-fetch-parse',   source: 'fetch', target: 'parse',     label: 'pick email',                      style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-parse-lookup',  source: 'parse', target: 'lookup',    label: 'local extract',                    style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-lookup-dec',    source: 'lookup', target: 'decision', label: 'verify',                          style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-dec-ask',       source: 'decision', target: 'ask',    label: 'Needs info',  style: { ...EDGE_STYLE, stroke: '#ef4444' }, markerEnd: MARK },
  { id: 'e-ask-wip',       source: 'ask', target: 'wip',         label: 'waiting',                         style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-dec-log',       source: 'decision', target: 'log',    label: 'Ready',      style: { ...EDGE_STYLE, stroke: '#22c55e' }, markerEnd: MARK },
  { id: 'e-log-confirm',   source: 'log', target: 'confirm',     label: 'confirmation reply',              style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-log-escalate',  source: 'log', target: 'escalate',    label: 'case log',                        style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-confirm-sent',  source: 'confirm', target: 'sent',    animated: true,                           style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-escalate-sent', source: 'escalate', target: 'sent',   animated: true,                           style: EDGE_STYLE, markerEnd: MARK },
];

const NODE_STAGE = {
  fetch: 'fetch',
  parse: 'parse',
  lookup: 'verify',
  decision: 'decide',
  ask: 'reply',
  log: 'log',
  escalate: 'escalate',
};

function buildNodes(s, enabled) {
  const disabled = (id) => {
    const st = NODE_STAGE[id];
    return st ? !enabled[st] : false;
  };
  const engineOf = (id) => {
    const st = NODE_STAGE[id];
    return st ? STAGES[st]?.engine : null;
  };
  return [
    {
      id: 'inbox', type: 'input', sourcePosition: 'bottom',
      position: { x: 300, y: 0 },
      data: {
        icon: '📥', label: 'Microsoft 365 Inbox', tone: 'violet',
        detail: 'vmm.helpdesk@openmind.in',
        engine: 'Mailbox connector',
        count: s.inbox == null ? '…' : `${s.inbox} emails · ${s.unread} unread`,
      },
    },
    {
      id: 'fetch', type: 'mail', position: { x: 300, y: 150 },
      data: { icon: '🔁', label: 'Fetch', tone: 'blue', detail: 'new + changed mailbox items', disabled: disabled('fetch'), engine: engineOf('fetch') },
    },
    {
      id: 'parse', type: 'mail', position: { x: 300, y: 300 },
      data: { icon: '🤖', label: 'Parse', tone: 'blue', detail: 'Store · Employee · Product · Nature', disabled: disabled('parse'), engine: engineOf('parse') },
    },
    {
      id: 'lookup', type: 'mail', position: { x: 300, y: 450 },
      data: { icon: '🔎', label: 'Verify & Enrich', tone: 'blue', detail: 'Store / employee lookup', disabled: disabled('lookup'), engine: engineOf('lookup') },
    },
    {
      id: 'decision', type: 'mail', position: { x: 300, y: 600 },
      data: { icon: '❓', label: 'Complete or Missing?', tone: 'amber', detail: 'All template fields present?', disabled: disabled('decision'), engine: engineOf('decision') },
    },
    {
      id: 'ask', type: 'mail', position: { x: 630, y: 600 },
      data: { icon: '✉️', label: 'Request Missing Details', tone: 'gray', detail: 'Auto reply listing missing fields', disabled: disabled('ask'), engine: engineOf('ask') },
    },
    {
      id: 'wip', type: 'output', targetPosition: 'left', position: { x: 630, y: 760 },
      data: { icon: '🕐', label: 'WIP — Awaiting Reply', tone: 'gray', detail: 'On-hold until customer replies', count: s.wips == null ? '…' : `${s.wips} open` },
    },
    {
      id: 'log', type: 'mail', position: { x: 300, y: 750 },
      data: { icon: '📋', label: 'Log Complaint', tone: 'blue', detail: 'Write complaint record', disabled: disabled('log'), engine: engineOf('log') },
    },
    {
      id: 'confirm', type: 'mail', position: { x: 300, y: 900 },
      data: { icon: '✅', label: 'Send Confirmation Reply', tone: 'green', detail: 'Complaint no + EDC to thread', disabled: disabled('log'), engine: 'Mailbox connector (required)' },
    },
    {
      id: 'escalate', type: 'mail', position: { x: 630, y: 900 },
      data: { icon: '🚨', label: 'Send Case Log / Escalation', tone: 'green', detail: 'Vendor + CC store · FM · HO', disabled: disabled('escalate'), engine: engineOf('escalate') },
    },
    {
      id: 'sent', type: 'output', position: { x: 465, y: 1050 },
      data: { icon: '📤', label: 'Outlook Sent Items', tone: 'green', detail: 'Replies · Confirmations · Escalations', count: s.sent == null ? '—' : `${s.sent} emails` },
    },
  ];
}

const STAGE_ORDER = [
  ['fetch', 'Fetch'],
  ['parse', 'Parse'],
  ['verify', 'Verify & Enrich'],
  ['decide', 'Complete or Missing?'],
  ['reply', 'Missing-details reply'],
  ['log', 'Log Complaint'],
  ['escalate', 'Case log / escalation'],
];

const ALL_STAGES = Object.fromEntries(STAGE_ORDER.map(([k]) => [k, true]));

export default function EmailFlow() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(EDGES);
  const [stats, setStats] = useState({ inbox: null, unread: null, wips: null, sent: null });
  const [enabled, setEnabled] = useState(ALL_STAGES);
  const [aiAssist, setAiAssist] = useState(false);
  const [emails, setEmails] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [parsingAll, setParsingAll] = useState(null);
  const [parseMap, setParseMap] = useState({});
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);
  const [draft, setDraft] = useState(null);
  const [reparseLoading, setReparseLoading] = useState(false);
  const [refData, setRefData] = useState({ products: [], natures: [], templates: [] });

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      vmm.fetchInbox(),
      vmm.getOpenWips(),
      vmm.fetchSent(),
      vmm.getProducts(),
      vmm.getNatures(),
      vmm.getEmailTemplates(),
    ]).then(([inbox, wips, sent, products, natures, templates]) => {
      if (!alive) return;
      const inboxEmails = inbox.status === 'fulfilled' ? (inbox.value.emails || []) : [];
      setStats({
        inbox: inboxEmails.length,
        unread: inboxEmails.filter(e => !e.isRead).length,
        wips: wips.status === 'fulfilled' ? (wips.value.wips || []).length : null,
        sent: sent.status === 'fulfilled' ? (sent.value.emails || []).length : null,
      });
      setRefData({
        products: products.status === 'fulfilled' ? (products.value.products || []) : [],
        natures: natures.status === 'fulfilled' ? (natures.value.natures || []) : [],
        templates: templates.status === 'fulfilled' ? (templates.value.templates || []) : [],
      });
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => { setNodes(buildNodes(stats, enabled)); }, [stats, enabled]); // eslint-disable-line

  const toggleStage = (stage) => setEnabled(prev => ({ ...prev, [stage]: !prev[stage] }));

  const handleFetchInbox = async () => {
    setLoadingInbox(true);
    try {
      const res = await vmm.fetchInbox();
      const list = res.emails || [];
      setEmails(list);
      setParseMap({});
      setStats(prev => ({ ...prev, inbox: list.length, unread: list.filter(e => !e.isRead).length }));
      setSelectedIdx(list.length ? 0 : -1);
    } finally {
      setLoadingInbox(false);
    }
  };

  const handleParseAll = async () => {
    if (!emails.length) return;
    setParsingAll('0');
    setParseMap({});
    setDraft(null);
    try {
      const items = await runParseAll(emails, {
        products: refData.products,
        natures: refData.natures,
        templates: refData.templates,
        onProgress: (done, total) => setParsingAll(`${done}/${total}`),
      });
      const map = {};
      items.forEach((item, i) => {
        if (item.ok) map[i] = item.result;
      });
      setParseMap(map);
    } finally {
      setParsingAll(null);
    }
  };

  useEffect(() => { setDraft(selectedIdx >= 0 ? (parseMap[selectedIdx] ? { ...parseMap[selectedIdx] } : null) : null); }, [selectedIdx]); // eslint-disable-line

  const updDraft = (k, v) => setDraft(prev => ({ ...(prev || parsedNow || {}), [k]: v }));

  const handleSaveDraft = () => {
    if (selectedIdx < 0 || !draft) return;
    setParseMap(prev => ({ ...prev, [selectedIdx]: { ...draft } }));
  };

  const handleReparse = async () => {
    if (selectedIdx < 0) return;
    const email = emails[selectedIdx];
    if (!email) return;
    setReparseLoading(true);
    try {
      const res = await runParse(email, [], {
        products: refData.products,
        natures: refData.natures,
        templates: refData.templates,
        aiAssist: true,
        lockedFields: {
          storeCode: draft?.storeCode || email.storeCode || '',
          employeeCode: draft?.employeeCode || '',
          productName: draft?.productName || '',
          natureOfProblem: draft?.natureOfProblem || '',
          description: draft?.description || '',
        },
      });
      setParseMap(prev => ({ ...prev, [selectedIdx]: res }));
      setDraft({ ...res });
    } finally {
      setReparseLoading(false);
    }
  };

  const handleRun = async () => {
    if (selectedIdx < 0 || !emails[selectedIdx]) return;
    setRunning(true);
    setResults([]);
    try {
      const email = emails[selectedIdx];
      const r = await executePipeline(email, [], {
        products: refData.products,
        natures: refData.natures,
        templates: refData.templates,
        aiAssist,
        stages: { ...enabled, thread: true },
        parsedOverride: parseMap[selectedIdx] || null,
        preloadedEmails: emails,
      });
      setResults(r);
    } catch (e) {
      setResults([{ key: 'error', ok: false, detail: `Pipeline error: ${e?.message || e}` }]);
    } finally {
      setRunning(false);
    }
  };

  const selected = selectedIdx >= 0 ? emails[selectedIdx] : null;
  const parsedNow = selectedIdx >= 0 ? parseMap[selectedIdx] : null;

  return (
    <div className="ef-page">
      <div className="page-heading">
        <h2>Email Workflow</h2>
        <p>React Flow orchestrates the pipeline · mail access and sending stay on the mailbox connector (required) · parsing and decisions run locally in the browser</p>
      </div>
      <div className="ef-layout">
        <aside className="ef-panel">
          <div className="ef-panel-block">
            <div className="ef-panel-title">Emails</div>
            <button className="ef-btn primary" onClick={handleFetchInbox} disabled={loadingInbox}>
              {loadingInbox ? 'Fetching all…' : `Fetch all emails${emails.length ? ` (${emails.length})` : ''}`}
            </button>
            <button className="ef-btn" onClick={handleParseAll} disabled={parsingAll !== null || !emails.length}>
              {parsingAll !== null ? `Parsing via API… ${parsingAll}` : `Parse all via API${emails.length ? ` (${emails.length})` : ''}`}
            </button>
            {Object.keys(parseMap).length > 0 && (
              <p className="ef-hint">{Object.keys(parseMap).length} of {emails.length} parsed · select one and run the pipeline</p>
            )}
            <select
              className="ef-select"
              value={selectedIdx}
              onChange={e => setSelectedIdx(Number(e.target.value))}
              disabled={!emails.length}
            >
              {emails.length === 0 && <option value={-1}>No emails loaded</option>}
              {emails.map((m, i) => (
                <option key={i} value={i}>
                  {parseMap[i] ? '✓ ' : '· '}{m.fromName || m.fromAddr || '?'} — {m.subject || '(no subject)'}
                </option>
              ))}
            </select>
            {selected && <div className="ef-email-pick">
              <span>{selected.fromName || selected.fromAddr}</span>
              <span>{selected.subject || '(no subject)'}</span>
            </div>}
            {parsedNow && (() => {
              const ed = draft || parsedNow;
              return (
                <div className="ef-parse-edit">
                  <div className="ef-parse-meta">
                    <span className="ef-chip meta">{ed.source || 'local'}</span>
                    <span className={`ef-chip ${ed.score >= 80 ? '' : ed.score >= 50 ? 'warn' : 'meta'}`}>{ed.score != null ? `score ${ed.score}/100` : 'score –'}</span>
                    {ed.autoFixed?.length > 0 && <span className="ef-chip warn">{ed.autoFixed.length} auto-fixed</span>}
                    {ed.missingFromTemplate?.length > 0 && (
                      <span className="ef-chip warn">missing: {ed.missingFromTemplate.join(', ')}</span>
                    )}
                    <span className="ef-chip break">{ed.selectedTemplateId ? `template ${ed.selectedTemplateId}` : 'no template match'}</span>
                  </div>
                  {ed.autoFixed?.length > 0 && (
                    <div className="ef-fixed-list">{ed.autoFixed.map((f, fi) => <span key={fi}>↻ {f}</span>)}</div>
                  )}
                  <div className="ef-parse-fields">
                    <label>Store code<input value={ed.storeCode || ''} onChange={e => updDraft('storeCode', e.target.value)} /></label>
                    <label>Employee code<input value={ed.employeeCode || ''} onChange={e => updDraft('employeeCode', e.target.value)} /></label>
                    <label>Product<input value={ed.productName || ''} onChange={e => updDraft('productName', e.target.value)} /></label>
                    <label>Nature of problem<input value={ed.natureOfProblem || ''} onChange={e => updDraft('natureOfProblem', e.target.value)} /></label>
                    <label>Description<textarea rows={3} value={ed.description || ''} onChange={e => updDraft('description', e.target.value)} /></label>
                  </div>
                  <div className="ef-parse-actions">
                    <button className="ef-btn" onClick={handleSaveDraft} disabled={!draft}>Save edits</button>
                    <button className="ef-btn" onClick={handleReparse} disabled={reparseLoading}>
                      {reparseLoading ? 'Re-parsing…' : 'Re-parse with AI (keep fixes)'}
                    </button>
                  </div>
                </div>
              );
            })()}
            {!parsedNow && emails.length > 0 && <p className="ef-hint">Select an email and parse it (or run Parse all) to review the AI result.</p>}
          </div>

          <div className="ef-panel-block">
            <div className="ef-panel-title">Stages</div>
            {STAGE_ORDER.map(([key, label]) => (
              <label className="ef-stage" key={key}>
                <input type="checkbox" checked={!!enabled[key]} onChange={() => toggleStage(key)} />
                <span>{label}</span>
                <em>{STAGES[key]?.engine}</em>
              </label>
            ))}
            <label className="ef-stage">
              <input type="checkbox" checked={aiAssist} onChange={e => setAiAssist(e.target.checked)} />
              <span>AI assist on parse</span>
              <em>only when local parse finds nothing</em>
            </label>
          </div>

          <div className="ef-panel-block">
            <button className="ef-btn primary" onClick={handleRun} disabled={running || !selected}>
              {running ? 'Running pipeline…' : 'Run pipeline on selected email'}
            </button>
            <p className="ef-hint">Dry-run — no emails are actually sent or logged.</p>
          </div>

          <div className="ef-panel-block ef-results">
            <div className="ef-panel-title">Run results</div>
            {results.length === 0 && <p className="ef-hint">Pick an email and run the pipeline to see each stage.</p>}
            {results.map((r, i) => (
              <div className={`ef-result ${r.ok ? 'ok' : 'fail'}`} key={`${r.key}-${i}`}>
                <div className="ef-result-head">
                  <span className="ef-result-ico">{r.ok ? '✓' : '✕'}</span>
                  <strong>{STAGES[r.key]?.label || r.key}</strong>
                </div>
                <div className="ef-result-detail">{r.detail}</div>
                {r.preview && (
                  <details className="ef-result-preview" open={i === 0}>
                    <summary>Preview data</summary>
                    <PreviewRows data={r.preview} />
                  </details>
                )}
              </div>
            ))}
          </div>
        </aside>

        <div className="ef-container">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            nodesConnectable
            attributionPosition="bottom-left"
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable nodeColor="#7c3aed" maskColor="rgba(0,0,0,0.06)" />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}