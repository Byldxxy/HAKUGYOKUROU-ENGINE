import React, { useRef } from 'react';
import './RelationGraph.css'; 
export type GraphNode = { id: string; x: number; y: number; name: string };
export type GraphEdge = { id: string; source: string; target: string; label: string };

// SECTION: 组件输入
// NOTE: 节点和边由 Game 持有，RelationGraph 只负责编辑交互，避免页签切换时状态丢失。
interface Props {
  nodes: GraphNode[];
  setNodes: React.Dispatch<React.SetStateAction<GraphNode[]>>;
  edges: GraphEdge[];
  setEdges: React.Dispatch<React.SetStateAction<GraphEdge[]>>;
}
export default function RelationGraph({ nodes, setNodes, edges, setEdges }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);

  // SECTION: 节点创建
  // NOTE: 新节点用时间戳生成临时 ID，后续迁入数据库时可替换为服务端 ID。
  const handleAddNode = () => {
    const newNode: GraphNode = {
      id: `node_${Date.now()}`,
      x: 50 + Math.random() * 100,
      y: 50 + Math.random() * 100,
      name: '新人物'
    };
    setNodes([...nodes, newNode]);
  };

  // SECTION: 文本编辑
  // NOTE: 这里先用 prompt 保持轻量，之后可以换成自定义弹窗以统一 UI。
  const handleDoubleClickNode = (id: string, currentName: string) => {
    const newName = prompt('输入人物名称:', currentName);
    if (newName) {
      setNodes(nodes.map(n => n.id === id ? { ...n, name: newName } : n));
    }
  };
  const handleDoubleClickEdge = (id: string, currentLabel: string) => {
    const newLabel = prompt('输入人物关系:', currentLabel);
    if (newLabel) {
      setEdges(edges.map(e => e.id === id ? { ...e, label: newLabel } : e));
    }
  };

  // SECTION: 拖拽生命周期
  // NOTE: dataTransfer 只存 nodeId，真正的数据仍从 React 状态读取。
  const handleDragStart = (e: React.DragEvent, nodeId: string) => {
    e.dataTransfer.setData('nodeId', nodeId);
    setTimeout(() => (e.target as HTMLElement).style.opacity = '0.5', 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).style.opacity = '1';
  };

  // SECTION: 拖放落点处理
  // NOTE: 同一个 drop 分支支持删除、建立关系、移动位置三种行为。
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('nodeId');
    if (!draggedId) return;
    const targetElement = e.target as HTMLElement;
    if (targetElement.closest('.trash-zone')) {
      // NOTE: 删除节点时必须同时移除所有相关边，避免悬空关系。
      setNodes(nodes.filter(n => n.id !== draggedId));
      setEdges(edges.filter(edge => edge.source !== draggedId && edge.target !== draggedId));
      return;
    }
    const targetNodeElement = targetElement.closest('.graph-node');
    if (targetNodeElement) {
      const targetId = targetNodeElement.getAttribute('data-id');
      if (targetId && targetId !== draggedId) {
        // NOTE: 当前只阻止同向重复连线，反向关系允许表达不同含义。
        const exists = edges.find(edge => (edge.source === draggedId && edge.target === targetId));
        if (!exists) {
          setEdges([...edges, { id: `edge_${Date.now()}`, source: draggedId, target: targetId, label: '关系' }]);
        }
        return;
      }
    }
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      // NOTE: 节点视觉尺寸约 60px，减去半径可让鼠标落点位于节点中心。
      const x = e.clientX - rect.left - 30;
      const y = e.clientY - rect.top - 30;
      setNodes(nodes.map(n => n.id === draggedId ? { ...n, x, y } : n));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    // NOTE: 浏览器默认不允许 drop，必须阻止默认行为。
    e.preventDefault();
  };

  return (
    <div className="relation-container">
      <div className="relation-toolbar">
        <button className="flat-btn primary small" onClick={handleAddNode}>+ 新建人物</button>
      </div>

      <div 
        className="relation-canvas" 
        ref={canvasRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <svg className="relation-svg">
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="28" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="#FF8FAB" />
            </marker>
          </defs>
          {edges.map(edge => {
            const source = nodes.find(n => n.id === edge.source);
            const target = nodes.find(n => n.id === edge.target);
            if (!source || !target) return null;
            // NOTE: 节点坐标是左上角，连线需要偏移到圆心。
            const sx = source.x + 30; const sy = source.y + 30;
            const tx = target.x + 30; const ty = target.y + 30;
            const midX = (sx + tx) / 2; const midY = (sy + ty) / 2;

            return (
              <g key={edge.id} onDoubleClick={() => handleDoubleClickEdge(edge.id, edge.label)}>
                <line x1={sx} y1={sy} x2={tx} y2={ty} stroke="#FF8FAB" strokeWidth="2" markerEnd="url(#arrow)" />
                <rect x={midX - 15} y={midY - 10} width="30" height="20" fill="#FAF5F7" rx="4" />
                <text x={midX} y={midY + 4} fontSize="12" fill="#4A2A33" textAnchor="middle" cursor="pointer">
                  {edge.label}
                </text>
              </g>
            );
          })}
        </svg>
        {nodes.map(node => (
          <div
            key={node.id}
            data-id={node.id}
            className="graph-node flat-box clickable"
            draggable
            onDragStart={(e) => handleDragStart(e, node.id)}
            onDragEnd={handleDragEnd}
            onDoubleClick={() => handleDoubleClickNode(node.id, node.name)}
            style={{ left: node.x, top: node.y }}
            title="拖动我，或双击重命名"
          >
            {node.name}
          </div>
        ))}
        <div className="trash-zone flat-box">
          🗑️ 拖至此处删除
        </div>
      </div>
    </div>
  );
}
