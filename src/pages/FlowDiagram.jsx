import { useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import './FlowDiagram.css';

const initialNodes = [
  {
    id: '1',
    type: 'input',
    data: { label: 'Complaint Received' },
    position: { x: 250, y: 0 },
    style: { background: '#ede9fe', border: '2px solid #7c3aed', borderRadius: 8, padding: '10px 16px', fontWeight: 600, fontSize: 13 },
  },
  {
    id: '2',
    data: { label: 'Log Case' },
    position: { x: 250, y: 100 },
    style: { background: '#fff', border: '2px solid #7c3aed', borderRadius: 8, padding: '10px 16px', fontSize: 13 },
  },
  {
    id: '3',
    data: { label: 'Assign to Agent' },
    position: { x: 250, y: 200 },
    style: { background: '#fff', border: '2px solid #0ea5e9', borderRadius: 8, padding: '10px 16px', fontSize: 13 },
  },
  {
    id: '4',
    data: { label: 'Investigate / Resolve' },
    position: { x: 250, y: 300 },
    style: { background: '#fff', border: '2px solid #f59e0b', borderRadius: 8, padding: '10px 16px', fontSize: 13 },
  },
  {
    id: '5',
    data: { label: 'Needs Escalation?' },
    position: { x: 250, y: 400 },
    type: 'output',
    style: { background: '#fef3c7', border: '2px solid #f59e0b', borderRadius: 8, padding: '10px 16px', fontWeight: 600, fontSize: 13 },
  },
  {
    id: '6',
    data: { label: 'Escalate to Vendor' },
    position: { x: 500, y: 400 },
    style: { background: '#fff', border: '2px solid #ef4444', borderRadius: 8, padding: '10px 16px', fontSize: 13 },
  },
  {
    id: '7',
    data: { label: 'Close Complaint' },
    position: { x: 250, y: 520 },
    type: 'output',
    style: { background: '#dcfce7', border: '2px solid #22c55e', borderRadius: 8, padding: '10px 16px', fontWeight: 600, fontSize: 13 },
  },
];

const initialEdges = [
  { id: 'e1-2', source: '1', target: '2', animated: true, style: { stroke: '#7c3aed', strokeWidth: 2, strokeDasharray: '6 6' }, markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e2-3', source: '2', target: '3', style: { stroke: '#0ea5e9', strokeWidth: 2, strokeDasharray: '6 6' }, markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e3-4', source: '3', target: '4', style: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '6 6' }, markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e4-5', source: '4', target: '5', style: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '6 6' }, markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e5-6', source: '5', target: '6', label: 'Yes', style: { stroke: '#ef4444', strokeWidth: 2, strokeDasharray: '6 6' }, markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e5-7', source: '5', target: '7', label: 'No', style: { stroke: '#22c55e', strokeWidth: 2, strokeDasharray: '6 6' }, markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e6-7', source: '6', target: '7', animated: true, style: { stroke: '#ef4444', strokeWidth: 2, strokeDasharray: '6 6' }, markerEnd: { type: MarkerType.ArrowClosed } },
];

export default function FlowDiagram() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } }, eds)),
    [setEdges],
  );

  return (
    <div className="flow-page">
      <div className="page-heading">
        <h2>Process Flow</h2>
        <p>VMM Complaint Workflow — Drag, connect, and customize nodes</p>
      </div>
      <div className="flow-container">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          attributionPosition="bottom-left"
        >
          <Background />
          <Controls />
          <MiniMap nodeColor="#7c3aed" maskColor="rgba(0,0,0,0.08)" />
        </ReactFlow>
      </div>
    </div>
  );
}
