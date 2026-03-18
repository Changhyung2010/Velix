import React, { useEffect, useRef, useState, useCallback } from 'react';

export type NodeTone = 'queued' | 'mapping' | 'building' | 'review' | 'done' | 'blocked';

export interface MindMapNode {
  id: string;
  label: string;
  role: string;
  tone: NodeTone;
}

interface SwarmMindMapProps {
  nodes: MindMapNode[];
  coordinatorStatus: string;
  isActive: boolean;
  onAgentClick?: (nodeId: string) => void;
  selectedNodeId?: string | null;
}

const TONE_COLORS: Record<NodeTone, string> = {
  queued: '#6B7280',
  mapping: '#06B6D4',
  building: '#3B82F6',
  review: '#F59E0B',
  done: '#10B981',
  blocked: '#EF4444',
};

const ROLE_COLORS: Record<string, string> = {
  scout: '#06B6D4',
  builder: '#8B5CF6',
  reviewer: '#F59E0B',
};

// Slightly larger nodes so text fits comfortably inside the shapes
const COORD_R = 42;   // hexagon circumradius — flat-to-flat ≈ 72 px
const AGENT_R = 30;   // circle radius inside the ring SVG — outer ring at +4 = 34
const MAX_COLS = 4;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
// Threshold (px) before a mousedown counts as a drag rather than a click
const DRAG_THRESHOLD = 4;

const hexPath = (cx: number, cy: number, r: number): string => {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return `M ${pts.join(' L ')} Z`;
};

export const SwarmMindMap: React.FC<SwarmMindMapProps> = ({
  nodes,
  coordinatorStatus,
  isActive,
  onAgentClick,
  selectedNodeId,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 500, h: 400 });
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Mutable drag state — stored in a ref so document handlers don't need deps
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    initPanX: 0,
    initPanY: 0,
    moved: false,
  });

  // Keep a ref to current pan so mousedown handler can read it without re-binding
  const panRef = useRef(pan);
  useEffect(() => { panRef.current = pan; }, [pan]);

  // Responsive canvas size via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: Math.max(width, 200), h: Math.max(height, 200) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Non-passive wheel listener so we can call preventDefault
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, parseFloat((z + delta).toFixed(2)))));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Global mouse-move / mouse-up listeners for drag (attached once, use dragRef)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        dragRef.current.moved = true;
      }
      setPan({ x: dragRef.current.initPanX + dx, y: dragRef.current.initPanY + dy });
    };
    const onUp = () => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      setIsDragging(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []); // intentionally empty — uses dragRef and panRef

  // Start a drag from the background (skip agent nodes and controls)
  const handleContainerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('.smm-agent-node') || target.closest('.smm-zoom-controls')) return;
    dragRef.current.active = true;
    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;
    dragRef.current.initPanX = panRef.current.x;
    dragRef.current.initPanY = panRef.current.y;
    dragRef.current.moved = false;
    setIsDragging(true);
    e.preventDefault();
  }, []);

  // Layout math
  const { w, h } = size;
  const COLS = Math.min(MAX_COLS, nodes.length) || 1;
  const ROWS = Math.ceil(nodes.length / COLS);

  const coordX = w / 2;
  const coordY = Math.max(COORD_R + 28, h * 0.16);

  const agentAreaTop = coordY + COORD_R + 50;
  const agentAreaH = h - agentAreaTop - 32;
  const rowSpacing = nodes.length > 0 ? Math.max(100, agentAreaH / ROWS) : 100;
  const colWidth = Math.min(170, (w - 60) / COLS);

  const getAgentPos = (index: number) => {
    const row = Math.floor(index / COLS);
    const isLastRow = row === ROWS - 1;
    const nodesInRow = isLastRow ? nodes.length - row * COLS : COLS;
    const colInRow = index - row * COLS;
    const rowTotalWidth = nodesInRow * colWidth;
    const rowStartX = (w - rowTotalWidth) / 2;
    const x = rowStartX + colInRow * colWidth + colWidth / 2;
    const y = agentAreaTop + row * rowSpacing + AGENT_R;
    return { x, y };
  };

  const agentRingSvgSize = AGENT_R * 2 + 16; // total SVG canvas for the ring
  const agentNodeBoxSize = agentRingSvgSize;   // node div matches ring SVG

  const viewportTransform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;

  return (
    <div
      ref={containerRef}
      className={`swarm-mindmap${isDragging ? ' smm-dragging' : ''}`}
      onMouseDown={handleContainerMouseDown}
    >
      {/* Zoom / reset controls */}
      <div className="smm-zoom-controls">
        <button
          className="smm-zoom-btn"
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, parseFloat((z + 0.15).toFixed(2))))}
          title="Zoom in"
        >+</button>
        <span className="smm-zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          className="smm-zoom-btn"
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, parseFloat((z - 0.15).toFixed(2))))}
          title="Zoom out"
        >−</button>
        <button
          className="smm-zoom-btn"
          onClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }); }}
          title="Reset view"
        >⌂</button>
      </div>

      {/* Zoomable + pannable viewport */}
      <div
        className="smm-viewport"
        style={{ transform: viewportTransform, transformOrigin: 'center center' }}
      >
        {/* Dot-grid background */}
        <svg className="smm-bg" width={w} height={h} aria-hidden="true">
          <defs>
            <pattern id="smm-dot-grid" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="currentColor" />
            </pattern>
          </defs>
          <rect width={w} height={h} fill="url(#smm-dot-grid)" />
        </svg>

        {/* Wires + animated pulses */}
        <svg className="smm-wires" width={w} height={h} aria-hidden="true">
          <defs>
            {nodes.map((node, i) => {
              const { x: ax, y: ay } = getAgentPos(i);
              const midY = (coordY + ay) / 2;
              const d = `M ${coordX},${coordY + COORD_R} C ${coordX},${midY} ${ax},${midY} ${ax},${ay - AGENT_R}`;
              return <path key={`wire-def-${node.id}`} id={`smm-wire-${i}`} d={d} fill="none" />;
            })}
          </defs>

          {nodes.map((node, i) => {
            const { x: ax, y: ay } = getAgentPos(i);
            const midY = (coordY + ay) / 2;
            const d = `M ${coordX},${coordY + COORD_R} C ${coordX},${midY} ${ax},${midY} ${ax},${ay - AGENT_R}`;
            const isRunning = node.tone !== 'queued' && node.tone !== 'done' && node.tone !== 'blocked';
            const wireColor = isRunning ? TONE_COLORS[node.tone] : 'var(--border-default)';
            const isSelected = node.id === selectedNodeId;

            return (
              <g key={`wire-${node.id}`}>
                <path
                  d={d}
                  stroke={isSelected ? 'var(--accent-primary)' : wireColor}
                  strokeWidth={isSelected ? 2.5 : isRunning ? 2 : 1.5}
                  fill="none"
                  strokeDasharray={isRunning || isSelected ? undefined : '5 5'}
                  opacity={isRunning || isSelected ? 0.85 : 0.3}
                />
                {isRunning && (
                  <circle r="4" fill={wireColor} opacity="0.95">
                    <animateMotion dur="1.8s" repeatCount="indefinite">
                      <mpath href={`#smm-wire-${i}`} />
                    </animateMotion>
                  </circle>
                )}
              </g>
            );
          })}
        </svg>

        {/* Coordinator hexagon (SVG shape + text on the same layer) */}
        <svg className="smm-hex-layer" width={w} height={h} aria-hidden="true">
          {isActive && (
            <path
              d={hexPath(coordX, coordY, COORD_R + 10)}
              fill="none"
              stroke="var(--accent-primary)"
              strokeWidth="1.5"
            >
              <animate attributeName="opacity" values="0.5;0;0.5" dur="2.2s" repeatCount="indefinite" />
              <animate
                attributeName="d"
                values={`${hexPath(coordX, coordY, COORD_R + 6)};${hexPath(coordX, coordY, COORD_R + 14)};${hexPath(coordX, coordY, COORD_R + 6)}`}
                dur="2.2s"
                repeatCount="indefinite"
              />
            </path>
          )}
          <path
            d={hexPath(coordX, coordY, COORD_R)}
            fill="var(--bg-secondary)"
            stroke="var(--accent-primary)"
            strokeWidth="2"
          />
          {/* Coordinator text rendered inside SVG so it clips to the hex region naturally */}
          <text
            x={coordX}
            y={coordY - 7}
            textAnchor="middle"
            dominantBaseline="middle"
            className="smm-svg-title"
          >
            Coordinator
          </text>
          <text
            x={coordX}
            y={coordY + 9}
            textAnchor="middle"
            dominantBaseline="middle"
            className="smm-svg-sub"
          >
            {coordinatorStatus.length > 12 ? coordinatorStatus.slice(0, 11) + '…' : coordinatorStatus}
          </text>
        </svg>

        {/* Agent nodes */}
        {nodes.map((node, i) => {
          const { x, y } = getAgentPos(i);
          const roleColor = ROLE_COLORS[node.role] ?? '#6B7280';
          const statusColor = TONE_COLORS[node.tone];
          const isRunning = node.tone !== 'queued' && node.tone !== 'done' && node.tone !== 'blocked';
          const isSelected = node.id === selectedNodeId;
          const ringR = AGENT_R + 4;
          const svgCenter = AGENT_R + 8;

          return (
            <div
              key={node.id}
              className={`smm-node smm-agent-node${isRunning ? ' smm-running' : ''}${isSelected ? ' smm-selected' : ''}`}
              style={{
                left: x,
                top: y,
                width: agentNodeBoxSize,
                height: agentNodeBoxSize,
                '--role-color': roleColor,
                '--status-color': statusColor,
              } as React.CSSProperties}
              onClick={() => {
                if (dragRef.current.moved) return; // suppress click after drag
                onAgentClick?.(node.id);
              }}
              role={onAgentClick ? 'button' : undefined}
              tabIndex={onAgentClick ? 0 : undefined}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onAgentClick?.(node.id); }}
              title={onAgentClick ? `Message ${node.label}` : undefined}
            >
              {/* Ring SVG */}
              <svg
                className="smm-agent-ring-svg"
                width={agentRingSvgSize}
                height={agentRingSvgSize}
                aria-hidden="true"
              >
                <circle
                  cx={svgCenter}
                  cy={svgCenter}
                  r={ringR}
                  fill="var(--bg-primary)"
                  stroke={isSelected ? 'var(--accent-primary)' : roleColor}
                  strokeWidth={isSelected ? 3 : 2}
                />
                {isRunning && !isSelected && (
                  <circle cx={svgCenter} cy={svgCenter} r={ringR} fill="none" stroke={statusColor} strokeWidth="1.5">
                    <animate attributeName="opacity" values="0.6;0;0.6" dur="1.8s" repeatCount="indefinite" />
                    <animate attributeName="r" values={`${ringR};${ringR + 7};${ringR}`} dur="1.8s" repeatCount="indefinite" />
                  </circle>
                )}
                {/* Label text rendered inside SVG so it stays within the circle */}
                <text
                  x={svgCenter}
                  y={svgCenter - 7}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="smm-svg-title"
                >
                  {node.label.length > 9 ? node.label.slice(0, 8) + '…' : node.label}
                </text>
                <text
                  x={svgCenter}
                  y={svgCenter + 9}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="smm-svg-role"
                  style={{ fill: roleColor }}
                >
                  {node.role}
                </text>
              </svg>
              {/* Status badge below the circle */}
              <span className="smm-node-badge" style={{ background: statusColor }}>
                {node.tone.toUpperCase()}
              </span>
            </div>
          );
        })}

        {/* Empty state */}
        {nodes.length === 0 && (
          <div className="smm-empty">
            <svg width="40" height="46" viewBox="0 0 40 46" fill="none" aria-hidden="true">
              <path
                d={hexPath(20, 23, 18)}
                stroke="var(--border-default)"
                strokeWidth="2"
                fill="none"
              />
            </svg>
            <span>Graph appears when swarm launches</span>
          </div>
        )}
      </div>{/* /smm-viewport */}
    </div>
  );
};
