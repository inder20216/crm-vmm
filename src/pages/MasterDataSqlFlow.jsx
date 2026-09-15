import { useState } from 'react';
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
import 'reactflow/dist/style.css';
import './MasterDataSqlFlow.css';

function StepNode({ data, selected }) {
  return (
    <div className={`msq-node tone-${data.tone} ${selected ? 'selected' : ''} ${data.done ? 'is-done' : ''}`}>
      <Handle type="target" position={Position.Top} className="msq-handle" />
      <Handle type="source" position={Position.Bottom} className="msq-handle" />
      <div className="msq-node-icon">{data.icon}</div>
      <div className="msq-node-body">
        <div className="msq-node-title">
          {data.label}
          {data.done && <span className="msq-badge done">done</span>}
          {data.blocked && <span className="msq-badge blocked">blocked</span>}
          {data.manual && <span className="msq-badge manual">deploy</span>}
        </div>
        {data.detail && <div className="msq-node-detail">{data.detail}</div>}
      </div>
    </div>
  );
}

const nodeTypes = { step: StepNode };

const EDGE_STYLE = { strokeWidth: 2, strokeDasharray: '6 6' };
const MARK = { type: MarkerType.ArrowClosed };

const NODES = [
  // Row 1 — today's sheet path (to be removed)
  {
    id: 'settings', type: 'input', sourcePosition: 'bottom', position: { x: 0, y: 0 },
    data: {
      icon: '⚙️', label: 'Settings page', tone: 'violet',
      detail: 'Nature of Complaint tab · Delay Reason tab', done: true,
    },
  },
  {
    id: 'sheet', type: 'step', position: { x: -220, y: 140 },
    data: {
      icon: '📊', label: 'Google Sheet webhook', tone: 'gray',
      detail: 'vmm-sheet-master (n8n) / Apps Script — write path today', blocked: true,
    },
  },
  {
    id: 'sheet-out', type: 'output', targetPosition: 'top', position: { x: -220, y: 280 },
    data: { icon: '🗑️', label: 'Sheet write path: REMOVE', tone: 'red', detail: 'No shared mailbox, no extra n8n — one DB to trust' },
  },
  // Row 2 — SQL target
  {
    id: 'sql', type: 'step', position: { x: 0, y: 140 },
    data: {
      icon: '🗄️', label: 'MySQL via PHP API', tone: 'green',
      detail: 'vmm.openmindservices.in/webhook — already the core DB API', done: true,
    },
  },
  {
    id: 'tables', type: 'step', position: { x: 0, y: 280 },
    data: {
      icon: '📋', label: 'Master tables', tone: 'blue',
      detail: 'vmm_natureofproblem · vmm_delayreasons · vmm_subdelayreasons (+ type column)', done: true,
    },
  },
  // Row 3 — what needs to change
  {
    id: 'php', type: 'step', position: { x: 0, y: 420 },
    data: {
      icon: '🧩', label: 'Add SQL save endpoints', tone: 'amber', manual: true,
      detail: 'server/webhook/index.php → vmm-master-nature-save · vmm-master-delay-save (+ delete)',
    },
  },
  {
    id: 'sync', type: 'step', position: { x: 0, y: 560 },
    data: {
      icon: '🔗', label: 'Point vmm.js at PHP', tone: 'amber',
      detail: 'saveMasterRow → post(PHP, "vmm-master-…"); read via existing vmm-sp-natures / vmm-sp-delay-reasons',
    },
  },
  {
    id: 'deploy', type: 'step', position: { x: 0, y: 700 },
    data: {
      icon: '🚀', label: 'Upload index.php', tone: 'amber', manual: true,
      detail: 'public_html/webhook/ — remove demo_vmm select-line only when going live',
    },
  },
  {
    id: 'test', type: 'output', targetPosition: 'top', position: { x: 0, y: 840 },
    data: {
      icon: '✅', label: 'Settings saves → SQL', tone: 'green',
      detail: 'Add / Remove natures & delay reasons land in MySQL, no toast error',
    },
  },
];

const EDGES = [
  { id: 'e-settings-sheet', source: 'settings', target: 'sheet', label: 'today', style: { ...EDGE_STYLE, stroke: '#9ca3af' }, markerEnd: MARK },
  { id: 'e-sheet-out', source: 'sheet', target: 'sheet-out', label: 'delete', style: { ...EDGE_STYLE, stroke: '#ef4444' }, markerEnd: MARK, animated: true },
  { id: 'e-settings-sql', source: 'settings', target: 'sql', label: 'target', style: { ...EDGE_STYLE, stroke: '#22c55e' }, markerEnd: MARK },
  { id: 'e-sql-tables', source: 'sql', target: 'tables', style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-sql-php', source: 'sql', target: 'php', label: 'add write endpoints', style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-php-sync', source: 'php', target: 'sync', label: 'wire the SPA', style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-sync-deploy', source: 'sync', target: 'deploy', label: 'deploy server', style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-deploy-test', source: 'deploy', target: 'test', label: 'verify', style: { ...EDGE_STYLE, stroke: '#22c55e' }, markerEnd: MARK, animated: true },
];

export default function MasterDataSqlFlow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(EDGES);

  return (
    <div className="msq-page">
      <div className="page-heading">
        <h2>Settings → SQL Master Data Plan</h2>
        <p>Move Nature of Complaint &amp; Delay Reason storage from the Google Sheet webhook to MySQL via the PHP API.</p>
      </div>
      <div className="msq-container">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-left"
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable nodeColor="#7c3aed" maskColor="rgba(0,0,0,0.06)" />
        </ReactFlow>
      </div>
    </div>
  );
}