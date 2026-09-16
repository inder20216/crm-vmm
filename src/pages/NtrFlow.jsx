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
import './NtrFlow.css';

function NtrNode({ data, selected }) {
  return (
    <div className={`ntrf-node tone-${data.tone} ${selected ? 'selected' : ''} ${data.done ? 'is-done' : ''}`}>
      <Handle type="target" position={Position.Top} className="ntrf-handle" />
      <Handle type="source" position={Position.Bottom} className="ntrf-handle" />
      <div className="ntrf-node-icon">{data.icon}</div>
      <div className="ntrf-node-body">
        <div className="ntrf-node-title">
          {data.label}
          {data.done && <span className="ntrf-badge done">live</span>}
          {data.manual && <span className="ntrf-badge manual">deploy</span>}
          {data.blocked && <span className="ntrf-badge blocked">blocked</span>}
        </div>
        {data.detail && <div className="ntrf-node-detail">{data.detail}</div>}
      </div>
    </div>
  );
}

const nodeTypes = { ntr: NtrNode };

const EDGE_STYLE = { strokeWidth: 2, strokeDasharray: '6 6' };
const MARK = { type: MarkerType.ArrowClosed };

const NODES = [
  // Row 0 — entry
  {
    id: 'page', type: 'input', sourcePosition: 'bottom', position: { x: 300, y: 0 },
    data: { icon: '📦', label: 'NTR Requests Page Opens', tone: 'violet', detail: 'List mode — store consumable supply requests', done: true },
  },
  // Row 1 — two modes
  {
    id: 'list', type: 'ntr', position: { x: 0, y: 150 },
    data: { icon: '🗂️', label: 'List & refresh', tone: 'blue', detail: 'GET vmm-ntr-list (n8n) → request cards', done: true },
  },
  {
    id: 'upload', type: 'ntr', position: { x: 600, y: 150 },
    data: { icon: '📤', label: 'Upload NTR', tone: 'blue', detail: '+ Upload NTR button → upload mode', done: true },
  },
  // Row 2 — upload steps
  {
    id: 'store', type: 'ntr', position: { x: 600, y: 300 },
    data: { icon: '🏬', label: 'Store lookup', tone: 'blue', detail: 'Enter store code → PHP vmm-sp-store', done: true },
  },
  {
    id: 'csv', type: 'ntr', position: { x: 600, y: 440 },
    data: { icon: '🗒️', label: 'Upload CSV', tone: 'blue', detail: 'Template: article no, name, last received, qty, stock, days, requirement', done: true },
  },
  {
    id: 'validate', type: 'ntr', position: { x: 600, y: 590 },
    data: { icon: '🔎', label: 'Validate articles', tone: 'amber', detail: 'POST vmm-ntr-validate (n8n) → valid vs not-in-master', done: true },
  },
  {
    id: 'preview', type: 'ntr', position: { x: 600, y: 740 },
    data: { icon: '👁️', label: 'Preview & confirm', tone: 'amber', detail: 'Valid items will be logged · invalid appear in email only', done: true },
  },
  // Row 2b — list mode branch
  {
    id: 'select', type: 'ntr', position: { x: 0, y: 300 },
    data: { icon: '🖱️', label: 'Select request', tone: 'blue', detail: 'GET vmm-ntr-items → item table', done: true },
  },
  {
    id: 'csvlist', type: 'ntr', position: { x: 0, y: 460 },
    data: { icon: '⬇️', label: 'Download CSV', tone: 'gray', detail: 'Export items for the selected request', done: true },
  },
  // Row 3 — submit
  {
    id: 'save', type: 'ntr', position: { x: 600, y: 900 },
    data: { icon: '💾', label: 'Save to DB', tone: 'green', detail: 'POST vmm-ntr-save (n8n) → MySQL · returns request no', done: true },
  },
  {
    id: 'email', type: 'ntr', position: { x: 600, y: 1050 },
    data: { icon: '📧', label: 'Send confirmation email', tone: 'green', detail: 'Graph API → store To, HO CC · lists invalid items', done: true },
  },
  {
    id: 'done', type: 'output', targetPosition: 'top', position: { x: 600, y: 1200 },
    data: { icon: '✅', label: 'NTR Logged', tone: 'green', detail: 'Success screen → request saved + email sent', done: true },
  },
  // List refresh loop
  {
    id: 'refresh', type: 'ntr', position: { x: 0, y: 610 },
    data: { icon: '🔄', label: 'List auto-refreshes', tone: 'gray', detail: 'Back to list mode with the new request shown', done: true },
  },
];

const EDGES = [
  { id: 'e-page-list',     source: 'page',     target: 'list',     label: 'view list',    style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-page-upload',   source: 'page',     target: 'upload',   label: 'add request',  style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-upload-store',  source: 'upload',   target: 'store',                            style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-store-csv',     source: 'store',    target: 'csv',      label: 'found',        style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-csv-validate',  source: 'csv',      target: 'validate',                         style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-validate-preview', source: 'validate', target: 'preview', label: 'review',      style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-preview-save',  source: 'preview',  target: 'save',     label: 'confirm',      style: { ...EDGE_STYLE, stroke: '#22c55e' }, markerEnd: MARK, animated: true },
  { id: 'e-save-email',    source: 'save',     target: 'email',    label: 'notify',       style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-email-done',    source: 'email',    target: 'done',     label: 'done',         style: { ...EDGE_STYLE, stroke: '#22c55e' }, markerEnd: MARK, animated: true },
  { id: 'e-list-select',   source: 'list',     target: 'select',                           style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-select-csvlist', source: 'select',  target: 'csvlist',                          style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-done-refresh',  source: 'done',     target: 'refresh',  label: 'reload list',  style: { ...EDGE_STYLE, stroke: '#9ca3af' }, markerEnd: MARK },
];

export default function NtrFlow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(EDGES);

  return (
    <div className="ntrf-page">
      <div className="page-heading">
        <h2>NTR Request Workflow</h2>
        <p>Non-Trading Requests — list, upload, validate, save to DB, and email the store. DB ops via n8n today; email via Graph API. n8n stays only where required.</p>
      </div>
      <div className="ntrf-container">
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
          <MiniMap pannable zoomable nodeColor="#f59e0b" maskColor="rgba(0,0,0,0.06)" />
        </ReactFlow>
      </div>
    </div>
  );
}