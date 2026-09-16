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
import './FollowUpFlow.css';

function FuNode({ data, selected }) {
  return (
    <div className={`fuf-node tone-${data.tone} ${selected ? 'selected' : ''} ${data.done ? 'is-done' : ''}`}>
      <Handle type="target" position={Position.Top} className="fuf-handle" />
      <Handle type="source" position={Position.Bottom} className="fuf-handle" />
      <div className="fuf-node-icon">{data.icon}</div>
      <div className="fuf-node-body">
        <div className="fuf-node-title">
          {data.label}
          {data.done && <span className="fuf-badge done">live</span>}
          {data.manual && <span className="fuf-badge manual">deploy</span>}
        </div>
        {data.detail && <div className="fuf-node-detail">{data.detail}</div>}
      </div>
    </div>
  );
}

const nodeTypes = { fu: FuNode };

const EDGE_STYLE = { strokeWidth: 2, strokeDasharray: '6 6' };
const MARK = { type: MarkerType.ArrowClosed };

const NODES = [
  // Row 0 — entry
  {
    id: 'page', type: 'input', sourcePosition: 'bottom', position: { x: 300, y: 0 },
    data: { icon: '🧭', label: 'Follow-up Page Opens', tone: 'violet', detail: 'Agent dashboard — open cases requiring action', done: true },
  },
  // Row 1 — parallel data loads
  {
    id: 'fetch', type: 'fu', position: { x: 300, y: 150 },
    data: { icon: '📥', label: 'Fetch open complaints', tone: 'blue', detail: 'PHP: vmm-followup-complaints · latest status ≠ Closed', done: true },
  },
  {
    id: 'reasons', type: 'fu', position: { x: 650, y: 150 },
    data: { icon: '🗂️', label: 'Get delay reasons', tone: 'blue', detail: 'PHP: vmm-sp-delay-reasons · fallback list on error', done: true },
  },
  // Row 2 — list
  {
    id: 'filter', type: 'fu', position: { x: 300, y: 290 },
    data: { icon: '🔍', label: 'Filter & search', tone: 'blue', detail: 'Tabs: All · Overdue · Due Today · NC + search box', done: true },
  },
  {
    id: 'select', type: 'fu', position: { x: 300, y: 430 },
    data: { icon: '👆', label: 'Select complaint', tone: 'blue', detail: 'Summary card shows store · product · vendor · FM · EDC', done: true },
  },
  // Row 3 — context
  {
    id: 'history', type: 'fu', position: { x: 300, y: 570 },
    data: { icon: '📜', label: 'Case history loads', tone: 'blue', detail: 'PHP: vmm-complaint-detail → activity log table', done: true },
  },
  {
    id: 'method', type: 'fu', position: { x: 650, y: 570 },
    data: { icon: '📞', label: 'Follow-up method', tone: 'blue', detail: 'Call · Email Reply · Vendor Update', done: true },
  },
  // Row 4 — decision
  {
    id: 'status', type: 'fu', position: { x: 300, y: 710 },
    data: { icon: '⚡', label: 'Choose status action', tone: 'amber', detail: 'Closed · Partially Closed · Escalated · Update EDC · Not Connected · Note' },
  },
  {
    id: 'validation', type: 'fu', position: { x: 650, y: 710 },
    data: { icon: '🛡️', label: 'Validation rules', tone: 'gray', detail: 'Not Connected → Call only, EDC today + 3 · Closed requires date + closed-by · remarks optional only for Closed / Not Connected' },
  },
  // Row 5 — detail
  {
    id: 'reason', type: 'fu', position: { x: 300, y: 850 },
    data: { icon: '🗓️', label: 'Delay reason → EDC', tone: 'amber', detail: 'EDC = today + reason TAT · Payment under process → next cycle 7 / 14 / 21 / 28', done: true },
  },
  // Row 6 — submit
  {
    id: 'submit', type: 'fu', position: { x: 300, y: 990 },
    data: {
      icon: '🚀', label: 'Submit to server', tone: 'green',
      detail: 'PHP vmm-close-complaint (Closed / Partially Closed / Escalated) · vmm-update-edc · vmm-not-connected · n8n vmm-email-log-activity (Note)',
      done: true,
    },
  },
  // Row 7 — outcomes
  {
    id: 'closed', type: 'output', targetPosition: 'top', position: { x: 300, y: 1130 },
    data: { icon: '✅', label: 'Closed / Resolved', tone: 'green', detail: 'Closure email via Graph API · case removed from list', done: true },
  },
  {
    id: 'others', type: 'output', targetPosition: 'top', position: { x: 650, y: 1130 },
    data: { icon: '🔁', label: 'Partially Closed · Escalated · EDC · NC · Note', tone: 'gray', detail: 'Case stays in list · history reloads → back to Case history' },
  },
];

const EDGES = [
  { id: 'e-page-fetch',   source: 'page',  target: 'fetch',      label: 'open cases',     style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-page-reasons', source: 'page',  target: 'reasons',    label: 'in parallel',    style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-fetch-filter', source: 'fetch', target: 'filter',                            style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-reasons-filter', source: 'reasons', target: 'filter',                        style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-filter-select', source: 'filter', target: 'select',                          style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-select-history', source: 'select', target: 'history',                        style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-select-method', source: 'select', target: 'method',                          style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-history-status', source: 'history', target: 'status',                        style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-method-status', source: 'method', target: 'status',                          style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-status-reason', source: 'status', target: 'reason',   label: 'delay + EDC',  style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-status-validation', source: 'status', target: 'validation',                  style: { ...EDGE_STYLE, stroke: '#9ca3af' }, markerEnd: MARK },
  { id: 'e-reason-submit', source: 'reason', target: 'submit',                          style: EDGE_STYLE, markerEnd: MARK },
  { id: 'e-submit-closed', source: 'submit', target: 'closed',   label: 'email + remove', style: { ...EDGE_STYLE, stroke: '#22c55e' }, markerEnd: MARK, animated: true },
  { id: 'e-submit-others', source: 'submit', target: 'others',   label: 'reload history', style: EDGE_STYLE, markerEnd: MARK },
];

export default function FollowUpFlow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(EDGES);

  return (
    <div className="fuf-page">
      <div className="page-heading">
        <h2>Follow-up Workflow</h2>
        <p>How an agent works a case in the Follow-up page — fetch list, pick method + status, set delay reason, submit.</p>
      </div>
      <div className="fuf-container">
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
          <MiniMap pannable zoomable nodeColor="#3b82f6" maskColor="rgba(0,0,0,0.06)" />
        </ReactFlow>
      </div>
    </div>
  );
}