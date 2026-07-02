import React, { useRef } from 'react';
import './RelationGraph.css'; 

// 1. 稍微修改一下类型名称并导出，让外面的 Game 也能认识它们
export type GraphNode = { id: string; x: number; y: number; name: string };
export type GraphEdge = { id: string; source: string; target: string; label: string };

// 2. 定义一个“接口”，声明我们要向父组件索要哪些数据和修改工具
interface Props {
  nodes: GraphNode[];
  setNodes: React.Dispatch<React.SetStateAction<GraphNode[]>>;
  edges: GraphEdge[];
  setEdges: React.Dispatch<React.SetStateAction<GraphEdge[]>>;
}

// 3. 在函数参数里接收这些工具（注意这里不再使用自己的 useState 了）
export default function RelationGraph({ nodes, setNodes, edges, setEdges }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);

  // 添加新节点
  const handleAddNode = () => {
    const newNode: GraphNode = {
      id: `node_${Date.now()}`,
      x: 50 + Math.random() * 100,
      y: 50 + Math.random() * 100,
      name: '新人物'
    };
    setNodes([...nodes, newNode]);
  };

  // ... 往下原有的逻辑完全不用动，一直到文件末尾 ...

  // 双击节点重命名
  const handleDoubleClickNode = (id: string, currentName: string) => {
    const newName = prompt('输入人物名称:', currentName);
    if (newName) {
      setNodes(nodes.map(n => n.id === id ? { ...n, name: newName } : n));
    }
  };

  // 双击边重命名关系
  const handleDoubleClickEdge = (id: string, currentLabel: string) => {
    const newLabel = prompt('输入人物关系:', currentLabel);
    if (newLabel) {
      setEdges(edges.map(e => e.id === id ? { ...e, label: newLabel } : e));
    }
  };

  // --- 拖拽核心逻辑 ---
  const handleDragStart = (e: React.DragEvent, nodeId: string) => {
    e.dataTransfer.setData('nodeId', nodeId);
    // 设置拖拽时的透明度视觉反馈
    setTimeout(() => (e.target as HTMLElement).style.opacity = '0.5', 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).style.opacity = '1';
  };

  // 在画布上移动节点或建立连线
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('nodeId');
    if (!draggedId) return;

    // 检查是否拖到了垃圾桶上
    const targetElement = e.target as HTMLElement;
    if (targetElement.closest('.trash-zone')) {
      setNodes(nodes.filter(n => n.id !== draggedId));
      setEdges(edges.filter(edge => edge.source !== draggedId && edge.target !== draggedId));
      return;
    }

    // 检查是否拖到了另一个节点上 (建立连线)
    const targetNodeElement = targetElement.closest('.graph-node');
    if (targetNodeElement) {
      const targetId = targetNodeElement.getAttribute('data-id');
      if (targetId && targetId !== draggedId) {
        // 检查是否已经存在反向或正向连线
        const exists = edges.find(edge => (edge.source === draggedId && edge.target === targetId));
        if (!exists) {
          setEdges([...edges, { id: `edge_${Date.now()}`, source: draggedId, target: targetId, label: '关系' }]);
        }
        return;
      }
    }

    // 如果只是在画布上移动位置
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - 30; // 减去圆形半径的一半以便鼠标居中
      const y = e.clientY - rect.top - 30;
      setNodes(nodes.map(n => n.id === draggedId ? { ...n, x, y } : n));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // 必须阻止默认事件才能允许放置
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
        {/* SVG 层用于绘制连线 */}
        <svg className="relation-svg">
          {/* 定义箭头标记 */}
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="28" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="#FF8FAB" />
            </marker>
          </defs>
          {edges.map(edge => {
            const source = nodes.find(n => n.id === edge.source);
            const target = nodes.find(n => n.id === edge.target);
            if (!source || !target) return null;
            
            // 简单连线计算 (加上半径偏移量 30)
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

        {/* DOM 层用于渲染可拖拽节点 */}
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

        {/* 垃圾桶区域 */}
        <div className="trash-zone flat-box">
          🗑️ 拖至此处删除
        </div>
      </div>
    </div>
  );
}