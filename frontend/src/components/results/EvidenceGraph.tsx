import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  Network,
  Users,
  Database,
  FileImage,
  Cpu,
  Activity,
  ShieldAlert,
  AlertTriangle,
  FileText,
  GitBranch,
  Box,
  Eye,
  Maximize2,
  Layers,
  ZoomIn,
  ZoomOut,
  Lock,
  Unlock,
} from 'lucide-react';
import { useInvestigation } from '../../state/investigationStore';
import type { GraphNode, NodeType, GraphEdge as GraphEdgeType } from '../../types/graph';
import type { NormalizedStatus, EdgeVisualCategory } from '../../utils/statusNormalize';
import { edgeVisualCategory } from '../../utils/statusNormalize';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import './EvidenceGraph.css';

/* ════════════════════════════════════════════════════════════════════════════
   Constants & Geometry (Fixed 1600x600 Horizontal ViewBox)
   ════════════════════════════════════════════════════════════════════════════ */

export const GRAPH_W = 1600;
export const GRAPH_H = 600;
export const NODE_RADIUS = 20;
export const MAX_PARTICLES = 60;
export const POLL_INTERVAL_MS = 2000;

export const DEFAULT_ZOOM_TRANSFORM = { x: 0, y: 0, k: 1 };

/**
 * Validates that every transform coordinate is a finite number,
 * clamps zoom factor k between 0.4 and 3.0, and guards against NaN / Infinity.
 * If any value is invalid, resets cleanly to the Fit view.
 */
export function sanitizeTransform(t: { x: number; y: number; k: number }): { x: number; y: number; k: number } {
  if (
    !t ||
    typeof t.x !== 'number' ||
    typeof t.y !== 'number' ||
    typeof t.k !== 'number' ||
    !Number.isFinite(t.x) ||
    !Number.isFinite(t.y) ||
    !Number.isFinite(t.k) ||
    t.k <= 0
  ) {
    console.warn('[EvidenceGraph] Non-finite or invalid zoom/pan transform detected, resetting to Fit view:', t);
    return { ...DEFAULT_ZOOM_TRANSFORM };
  }

  const k = Math.max(0.4, Math.min(3.0, t.k));
  const maxX = GRAPH_W * 2;
  const maxY = GRAPH_H * 2;
  const x = Math.max(-maxX, Math.min(maxX, t.x));
  const y = Math.max(-maxY, Math.min(maxY, t.y));

  return { x, y, k };
}

export type StageName = 'CONTRIBUTOR' | 'DATASET' | 'SAMPLE' | 'MODEL' | 'INFERENCE' | 'FINDING';

export const STAGE_ORDER: StageName[] = [
  'CONTRIBUTOR',
  'DATASET',
  'SAMPLE',
  'MODEL',
  'INFERENCE',
  'FINDING',
];

export const STAGE_DISPLAY_NAMES: Record<StageName, string> = {
  CONTRIBUTOR: 'CONTRIBUTORS',
  DATASET: 'DATASET & INGEST',
  SAMPLE: 'SAMPLES',
  MODEL: 'MODELS & WEIGHTS',
  INFERENCE: 'INFERENCES',
  FINDING: 'FINDINGS & ASSESSMENTS',
};

export const CANONICAL_STAGE_X: Record<StageName, number> = {
  CONTRIBUTOR: 120,
  DATASET: 420,
  SAMPLE: 760,
  MODEL: 1250,
  INFERENCE: 1350,
  FINDING: 1500,
};

export type InputGraphNode = Omit<GraphNode, 'x' | 'y'> & {
  x?: number;
  y?: number;
  radius?: number;
};

/* ════════════════════════════════════════════════════════════════════════════
   Stage Classification & Layout Helpers
   ════════════════════════════════════════════════════════════════════════════ */

export function getNodeStageName(nodeType: string, status?: string): StageName {
  const t = String(nodeType || '').toUpperCase();
  // SAMPLES identified first to ensure SAMPLE nodes are not grouped into DATASET
  if (t.includes('SAMPLE')) {
    return 'SAMPLE';
  }
  if (
    t.includes('CONTRIBUTOR') ||
    t.includes('ACTOR') ||
    t.includes('USER') ||
    t.includes('SOURCE') ||
    t.includes('AUTHOR')
  ) {
    return 'CONTRIBUTOR';
  }
  if (
    t.includes('DATASET') ||
    t.includes('BATCH') ||
    t.includes('INGEST')
  ) {
    return 'DATASET';
  }
  if (
    t.includes('MODEL') ||
    t.includes('WEIGHT') ||
    t.includes('FINGERPRINT') ||
    t.includes('CHECKPOINT') ||
    t.includes('PREPROCESSING') ||
    t.includes('TRAINING')
  ) {
    return 'MODEL';
  }
  if (
    t.includes('INFER') ||
    t.includes('PREDICT') ||
    t.includes('EXECUTION') ||
    t.includes('RUN') ||
    t.includes('DNA') ||
    t.includes('RECORD') ||
    t.includes('OUTPUT')
  ) {
    return 'INFERENCE';
  }
  if (
    t.includes('FINDING') ||
    t.includes('EVIDENCE') ||
    t.includes('FUSION') ||
    t.includes('ASSESS') ||
    t.includes('REPORT') ||
    t.includes('QUARANTINE') ||
    t.includes('VETO') ||
    t.includes('INCIDENT') ||
    t.includes('DRIFT') ||
    t.includes('POLICY') ||
    t.includes('DECISION') ||
    t.includes('AUDIT')
  ) {
    return 'FINDING';
  }
  if (status === 'critical' || status === 'warning') return 'FINDING';
  return 'MODEL';
}

/** Legacy numeric index mapper (0 to 5) */
export function getNodeStage(nodeType: string, status?: string): number {
  const name = getNodeStageName(nodeType, status);
  return STAGE_ORDER.indexOf(name);
}

/** Computes the horizontal X center for a given stage index (legacy compatible). */
export function getStageX(stageIndex: number, _width: number = GRAPH_W): number {
  const defaultXs = [120, 420, 760, 1250, 1350, 1500];
  const idx = Math.max(0, Math.min(defaultXs.length - 1, stageIndex));
  return defaultXs[idx];
}

/** Checks whether a coordinate is a finite number. */
export function isFiniteCoord(n: number | null | undefined): boolean {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Fixed panel height — graph never makes the page taller */
export function computeGraphHeight(_nodes?: InputGraphNode[]): number {
  return GRAPH_H;
}

/** Format node label: short (max 10 chars + ellipsis) */
export function formatNodeLabel(label: string): string {
  const clean = (label || '').trim();
  if (!clean) return '';
  if (clean.length > 10) {
    return clean.slice(0, 10) + '…';
  }
  return clean;
}

export function isCriticalOrPoisoned(node?: InputGraphNode | GraphNode | null): boolean {
  if (!node) return false;
  const status = String(node.status || '').toLowerCase();
  const rawStatus = String(node.properties?.status || node.properties?.severity || '').toLowerCase();
  const label = String(node.label || '').toLowerCase();
  const id = String(node.id || '').toLowerCase();
  return (
    status === 'critical' ||
    status === 'failed' ||
    rawStatus.includes('poison') ||
    rawStatus.includes('backdoor') ||
    rawStatus.includes('trigger') ||
    rawStatus.includes('critical') ||
    label.includes('poison') ||
    id.includes('poison')
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   Deterministic Horizontal Grid Layout
   ════════════════════════════════════════════════════════════════════════════ */

export function layoutGraph(
  rawNodes: InputGraphNode[],
  edges: GraphEdgeType[] = [],
  optionsOrPositions?: boolean | Map<string, { x: number; y: number }> | { isExpanded?: boolean; positions?: Map<string, { x: number; y: number }> },
  _width: number = GRAPH_W,
  _height: number = GRAPH_H,
): GraphNode[] {
  const isExpanded = typeof optionsOrPositions === "boolean"
    ? optionsOrPositions
    : (optionsOrPositions && typeof optionsOrPositions === "object" && "isExpanded" in optionsOrPositions
        ? (optionsOrPositions as any).isExpanded
        : false);
  const existingMap = optionsOrPositions instanceof Map
    ? optionsOrPositions
    : (optionsOrPositions && typeof optionsOrPositions === "object" && "positions" in optionsOrPositions
        ? (optionsOrPositions as any).positions instanceof Map
          ? (optionsOrPositions as any).positions
          : null
        : null);

  const seen = new Set<string>();
  const nodes = rawNodes.filter(n => {
    if (!n || typeof n.id !== 'string' || !n.id.trim()) {
      console.warn('[EvidenceGraph] Skipping node with missing or invalid id:', n);
      return false;
    }
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });

  if (nodes.length === 0) return [];

  // Group nodes by stage
  const stageNodesMap = new Map<StageName, InputGraphNode[]>();
  STAGE_ORDER.forEach(s => stageNodesMap.set(s, []));

  nodes.forEach(node => {
    const sName = getNodeStageName(node.nodeType, node.status);
    stageNodesMap.get(sName)!.push({ ...node });
  });

  const usedStages = STAGE_ORDER.filter(s => stageNodesMap.get(s)!.length > 0);

  // Compute horizontal X positions for used columns
  const stageXMap: Record<StageName, number> = {} as any;
  if (!usedStages.includes("SAMPLE")) {
    if (usedStages.length === 1) {
      stageXMap[usedStages[0]] = 800;
    } else {
      // Re-space used stages evenly across [120, 1500] so small graphs look balanced
      const minX = 120;
      const maxX = 1500;
      const step = (maxX - minX) / (usedStages.length - 1);
      usedStages.forEach((s, idx) => {
        stageXMap[s] = Math.round(minX + idx * step);
      });
    }
  } else {
    // SAMPLE stage is present: preserve stage pipeline columns left to right
    const hasContributor = usedStages.includes("CONTRIBUTOR");
    const hasDataset = usedStages.includes("DATASET");

    if (hasContributor) stageXMap["CONTRIBUTOR"] = 120;
    if (hasDataset) stageXMap["DATASET"] = hasContributor ? 420 : 120;

    const sampleBaseX = hasDataset ? (hasContributor ? 760 : 540) : (hasContributor ? 420 : 120);
    stageXMap["SAMPLE"] = sampleBaseX;

    const postSampleStages = usedStages.filter(s => s === "MODEL" || s === "INFERENCE" || s === "FINDING");
    if (postSampleStages.length > 0) {
      if (postSampleStages.length === 3) {
        stageXMap["MODEL"] = CANONICAL_STAGE_X["MODEL"];
        stageXMap["INFERENCE"] = CANONICAL_STAGE_X["INFERENCE"];
        stageXMap["FINDING"] = CANONICAL_STAGE_X["FINDING"];
      } else if (postSampleStages.length === 1) {
        stageXMap[postSampleStages[0]] = 1500;
      } else {
        const minPostX = 1250;
        const maxPostX = 1500;
        const step = (maxPostX - minPostX) / (postSampleStages.length - 1);
        postSampleStages.forEach((s, idx) => {
          stageXMap[s] = Math.round(minPostX + idx * step);
        });
      }
    }
  }

  const result: GraphNode[] = [];

  // Helper to layout a non-sample stage
  const layoutNonSampleStage = (st: StageName) => {
    const stNodes = stageNodesMap.get(st)!;
    if (stNodes.length === 0) return;
    const stX = stageXMap[st];

    if (stNodes.length === 1) {
      result.push({
        ...stNodes[0],
        x: stX,
        y: 300,
        radius: 20,
      } as GraphNode);
    } else {
      const gap = Math.min(110, Math.floor(480 / (stNodes.length - 1)));
      const startY = 300 - ((stNodes.length - 1) * gap) / 2;

      // Compute barycenter for each node from connected edges to minimize crossings
      const barycenters = new Map<string, number>();
      stNodes.forEach(n => {
        const connectedYs: number[] = [];
        edges.forEach(e => {
          if (e.targetId === n.id) {
            const src = result.find(r => r.id === e.sourceId);
            if (src && isFiniteCoord(src.y)) connectedYs.push(src.y);
          } else if (e.sourceId === n.id) {
            const tgt = result.find(r => r.id === e.targetId);
            if (tgt && isFiniteCoord(tgt.y)) connectedYs.push(tgt.y);
          }
        });
        if (connectedYs.length > 0) {
          const avg = connectedYs.reduce((a, b) => a + b, 0) / connectedYs.length;
          barycenters.set(n.id, avg);
        }
      });

      const sorted = [...stNodes].sort((a, b) => {
        const bA = barycenters.get(a.id);
        const bB = barycenters.get(b.id);
        if (bA !== undefined && bB !== undefined && bA !== bB) {
          return bA - bB;
        }
        if (bA !== undefined && bB === undefined) return -1;
        if (bA === undefined && bB !== undefined) return 1;
        return a.id.localeCompare(b.id);
      });

      sorted.forEach((n, idx) => {
        result.push({
          ...n,
          x: stX,
          y: Math.round(startY + idx * gap),
          radius: 20,
        } as GraphNode);
      });
    }
  };

  // 1. Layout Pre-Sample Stages: CONTRIBUTOR, DATASET
  layoutNonSampleStage('CONTRIBUTOR');
  layoutNonSampleStage('DATASET');

  // Find dataset reference Y for sample grid centering
  const datasetNode = result.find(r => getNodeStageName(r.nodeType, r.status) === 'DATASET');
  const datasetY = datasetNode && isFiniteCoord(datasetNode.y) ? datasetNode.y : 300;

  // 2. Layout Samples in a Compact Grid
  const samples = stageNodesMap.get('SAMPLE')!;
  if (samples.length > 40 && !isExpanded) {
    // Collapse into single cluster node if > 40 samples and not expanded
    const sx = stageXMap['SAMPLE'] ?? 760;
    const hasCrit = samples.some(s => isCriticalOrPoisoned(s));
    result.push({
      id: 'samples_cluster',
      label: `${samples.length} samples`,
      nodeType: 'SAMPLE_CLUSTER',
      status: hasCrit ? 'critical' : 'normal',
      properties: { count: samples.length, isCluster: true },
      digest: '',
      x: sx,
      y: datasetY,
      radius: 24,
    } as GraphNode);
  } else if (samples.length > 0) {
    // Sort poisoned / critical samples FIRST (top-left in grid)
    const sortedSamples = [...samples].sort((a, b) => {
      const aCrit = isCriticalOrPoisoned(a) ? 1 : 0;
      const bCrit = isCriticalOrPoisoned(b) ? 1 : 0;
      if (aCrit !== bCrit) return bCrit - aCrit; // Critical first
      return a.id.localeCompare(b.id);
    });

    const numSamples = sortedSamples.length;
    const numRows = Math.min(4, numSamples);
    const numCols = Math.ceil(numSamples / 4);

    const sx = stageXMap['SAMPLE'] ?? 760;
    const sampleIdxInUsed = usedStages.indexOf('SAMPLE');
    const nextStageName = sampleIdxInUsed !== -1 && sampleIdxInUsed + 1 < usedStages.length
      ? usedStages[sampleIdxInUsed + 1]
      : null;
    const nextStageX = nextStageName ? stageXMap[nextStageName] : 1550;
    const availSpace = nextStageX - sx - 40;

    let radius = 28;
    let colGap = 90;
    let rowGap = 110;

    // Shrink radius (28 -> 20 -> 14) and gaps if grid would exceed available space
    if ((numCols - 1) * colGap + 2 * radius > availSpace) {
      radius = 20;
      colGap = Math.min(90, Math.max(45, Math.floor((availSpace - 2 * radius) / Math.max(1, numCols - 1))));
      rowGap = 95;
    }
    if ((numCols - 1) * colGap + 2 * radius > availSpace || colGap < 50) {
      radius = 14;
      colGap = Math.min(60, Math.max(25, Math.floor((availSpace - 2 * radius) / Math.max(1, numCols - 1))));
      rowGap = 80;
    }

    const startY = numRows === 1 ? datasetY : datasetY - ((numRows - 1) * rowGap) / 2;

    sortedSamples.forEach((sample, i) => {
      const col = Math.floor(i / 4);
      const row = i % 4;
      const x = sx + col * colGap;
      const y = startY + row * rowGap;

      result.push({
        ...sample,
        x: Math.round(x),
        y: Math.round(y),
        radius,
      } as GraphNode);
    });
  }

  // 3. Layout Post-Sample Stages: MODEL, INFERENCE, FINDING
  layoutNonSampleStage('MODEL');
  layoutNonSampleStage('INFERENCE');
  layoutNonSampleStage('FINDING');

  // 4. If existing positions map was provided, preserve stable node coordinates
  if (existingMap) {
    result.forEach(n => {
      const existing = existingMap.get(n.id);
      if (existing && isFiniteCoord(existing.x) && isFiniteCoord(existing.y)) {
        n.x = existing.x;
        n.y = existing.y;
      }
    });
  }

  return result.filter(n => {
    const valid = n && n.id && isFiniteCoord(n.x) && isFiniteCoord(n.y);
    if (!valid) {
      console.warn('[EvidenceGraph] Layout produced node with non-finite coordinates:', n);
    }
    return valid;
  });
}

/* ════════════════════════════════════════════════════════════════════════════
   Straight Edge Path & Collision Avoidance
   ════════════════════════════════════════════════════════════════════════════ */

export function buildEdgePath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  sourceRadius: number = NODE_RADIUS,
  targetRadius: number = NODE_RADIUS,
  obstacles: Array<{ x: number; y: number; id?: string }> = [],
): string {
  if (!isFiniteCoord(sx) || !isFiniteCoord(sy) || !isFiniteCoord(tx) || !isFiniteCoord(ty)) {
    return '';
  }
  // If target is to the right of source, start at RIGHT edge and end at LEFT edge
  if (tx > sx) {
    const x1 = Math.round(sx + sourceRadius);
    const y1 = Math.round(sy);
    const x2 = Math.round(tx - targetRadius);
    const y2 = Math.round(ty);

    // Check collision with obstacles between source and target
    const minX = sx + sourceRadius + 10;
    const maxX = tx - targetRadius - 10;
    let collidedObs: { x: number; y: number } | null = null;

    if (obstacles.length > 0) {
      const segDx = x2 - x1;
      const segDy = y2 - y1;
      const l2 = segDx * segDx + segDy * segDy;
      if (l2 > 1e-4) {
        for (const obs of obstacles) {
          if (obs.x <= minX || obs.x >= maxX) continue;
          const t = Math.max(0, Math.min(1, ((obs.x - x1) * segDx + (obs.y - y1) * segDy) / l2));
          const projX = x1 + t * segDx;
          const projY = y1 + t * segDy;
          const dist = Math.hypot(obs.x - projX, obs.y - projY);
          if (dist < 24) {
            collidedObs = obs;
            break;
          }
        }
      }
    }

    if (collidedObs) {
      // Route around obstacle with straight segments
      const ox = collidedObs.x;
      const yLane = collidedObs.y >= (sy + ty) / 2 ? collidedObs.y - 45 : collidedObs.y + 45;
      const wx1 = Math.round(sx + (ox - sx) * 0.45);
      const wx2 = Math.round(tx - (tx - ox) * 0.45);
      return `M ${x1} ${y1} L ${wx1} ${y1} L ${ox} ${yLane} L ${wx2} ${ty} L ${x2} ${y2}`;
    }

    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  // Fallback for same column or backwards edge
  const angle = Math.atan2(ty - sy, tx - sx);
  const x1 = Math.round(sx + sourceRadius * Math.cos(angle));
  const y1 = Math.round(sy + sourceRadius * Math.sin(angle));
  const x2 = Math.round(tx - targetRadius * Math.cos(angle));
  const y2 = Math.round(ty - targetRadius * Math.sin(angle));
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

export function countEdgeCrossings(
  nodes: GraphNode[],
  edges: GraphEdgeType[],
): number {
  const posMap = new Map<string, { x: number; y: number }>();
  nodes.forEach(n => {
    if (isFiniteCoord(n.x) && isFiniteCoord(n.y)) {
      posMap.set(n.id, { x: n.x, y: n.y });
    }
  });

  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    const s1 = posMap.get(edges[i].sourceId);
    const t1 = posMap.get(edges[i].targetId);
    if (!s1 || !t1) continue;

    for (let j = i + 1; j < edges.length; j++) {
      const s2 = posMap.get(edges[j].sourceId);
      const t2 = posMap.get(edges[j].targetId);
      if (!s2 || !t2) continue;

      if (segmentsIntersect(s1, t1, s2, t2)) {
        crossings++;
      }
    }
  }
  return crossings;
}

function segmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): boolean {
  if (
    (p1.x === p3.x && p1.y === p3.y) ||
    (p1.x === p4.x && p1.y === p4.y) ||
    (p2.x === p3.x && p2.y === p3.y) ||
    (p2.x === p4.x && p2.y === p4.y)
  ) {
    return false;
  }

  const ccw = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) =>
    (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);

  return (
    ccw(p1, p3, p4) !== ccw(p2, p3, p4) &&
    ccw(p1, p2, p3) !== ccw(p1, p2, p4)
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   Visual Helpers & Icons
   ════════════════════════════════════════════════════════════════════════════ */

function getNodeColor(node?: GraphNode | InputGraphNode | null): string {
  if (!node) return 'var(--accent)';
  switch (node.status) {
    case 'critical': return 'var(--critical)';
    case 'warning':  return 'var(--warning)';
    case 'unknown':  return 'var(--text-muted)';
    default:         return 'var(--accent)';
  }
}

function getNodeBg(node?: GraphNode | InputGraphNode | null): string {
  if (!node) return 'var(--accent-surface)';
  switch (node.status) {
    case 'critical': return 'var(--critical-surface)';
    case 'warning':  return 'var(--warning-surface)';
    case 'unknown':  return 'var(--surface-elevated)';
    default:         return 'var(--accent-surface)';
  }
}

function getNodeIcon(nodeType: NodeType | string) {
  const t = String(nodeType || '').toUpperCase();
  if (t.includes('CONTRIBUTOR'))   return <Users size={14} strokeWidth={1.5} />;
  if (t.includes('DATASET') || t.includes('BATCH')) return <Database size={14} strokeWidth={1.5} />;
  if (t.includes('CLUSTER'))       return <Layers size={14} strokeWidth={1.5} />;
  if (t.includes('SAMPLE'))        return <FileImage size={14} strokeWidth={1.5} />;
  if (t.includes('MODEL'))         return <Cpu size={14} strokeWidth={1.5} />;
  if (t.includes('INFER'))         return <Activity size={14} strokeWidth={1.5} />;
  if (t.includes('FINDING'))       return <ShieldAlert size={14} strokeWidth={1.5} />;
  if (t.includes('EVIDENCE'))      return <Eye size={14} strokeWidth={1.5} />;
  if (t.includes('QUARANTINE'))    return <AlertTriangle size={14} strokeWidth={1.5} />;
  if (t.includes('DRIFT'))         return <GitBranch size={14} strokeWidth={1.5} />;
  if (t.includes('REPORT'))        return <FileText size={14} strokeWidth={1.5} />;
  return <Box size={14} strokeWidth={1.5} />;
}

function particleColor(cat: EdgeVisualCategory): string {
  switch (cat) {
    case 'critical': return 'var(--critical)';
    case 'warning':  return 'var(--warning)';
    default:         return 'var(--accent-text)';
  }
}

function particleSpeed(cat: EdgeVisualCategory): number {
  switch (cat) {
    case 'critical': return 0.008;
    case 'warning':  return 0.005;
    default:         return 0.003;
  }
}

interface TooltipData {
  node: GraphNode;
  x: number;
  y: number;
  upstreamCount: number;
  downstreamCount: number;
}

function computeConnectionCounts(nodeId: string, edges: GraphEdgeType[]) {
  let upstream = 0;
  let downstream = 0;
  edges.forEach(e => {
    if (e.targetId === nodeId) upstream++;
    if (e.sourceId === nodeId) downstream++;
  });
  return { upstream, downstream };
}

interface Particle {
  edgeIndex: number;
  t: number;
  speed: number;
  cat: EdgeVisualCategory;
}

/* ════════════════════════════════════════════════════════════════════════════
   Main Component: EvidenceGraph
   ════════════════════════════════════════════════════════════════════════════ */

const EvidenceGraphInner: React.FC = () => {
  const {
    currentScanId,
    graphNodes,
    graphEdges,
    graphDigest,
    selectedGraphNode,
    setSelectedGraphNode,
    isScanning,
    isScanCompleted,
    loadEvidenceGraph,
  } = useInvestigation();

  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ASSETS' | 'FINDINGS'>('ALL');
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [isClusterExpanded, setIsClusterExpanded] = useState(false);

  // Zoom & Pan state
  const [isGraphActive, setIsGraphActive] = useState(false);
  const [zoomTransform, setZoomTransform] = useState({ x: 0, y: 0, k: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; initialX: number; initialY: number } | null>(null);

  /* ── Deterministic Layout Calculation & Position Cache ─────────────────── */

  const nodePositionsCache = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Reset zoom/pan, hover, selection, and clear position cache ONLY on scan session changes
  useEffect(() => {
    nodePositionsCache.current.clear();
    setZoomTransform({ x: 0, y: 0, k: 1 });
    setHoveredNodeId(null);
    setHoveredEdgeId(null);
    setTooltip(null);
    setIsClusterExpanded(false);
    setIsGraphActive(false);
  }, [currentScanId]);

  const nodeIdsKey = useMemo(() => graphNodes.map(n => n.id).sort().join(','), [graphNodes]);
  const edgeIdsKey = useMemo(() => graphEdges.map(e => e.id).sort().join(','), [graphEdges]);

  const laidOutNodes = useMemo(() => {
    if (graphNodes.length === 0) {
      nodePositionsCache.current.clear();
      return [];
    }
    const nodes = layoutGraph(
      graphNodes as InputGraphNode[],
      graphEdges,
      { isExpanded: isClusterExpanded, positions: nodePositionsCache.current },
      GRAPH_W,
      GRAPH_H,
    );
    // Cache the laid-out positions so identical IDs never jump or recompute
    nodes.forEach(n => {
      if (n && n.id && isFiniteCoord(n.x) && isFiniteCoord(n.y)) {
        nodePositionsCache.current.set(n.id, { x: n.x, y: n.y });
      }
    });
    return nodes;
  }, [nodeIdsKey, edgeIdsKey, isClusterExpanded, graphNodes]);

  // Safe lookups of active selected and hovered nodes by id with null checks
  const activeSelectedNode = useMemo(() => {
    if (!selectedGraphNode || !selectedGraphNode.id) return null;
    return laidOutNodes.find(n => n.id === selectedGraphNode.id) || null;
  }, [selectedGraphNode, laidOutNodes]);

  const activeHoveredNode = useMemo(() => {
    if (!hoveredNodeId) return null;
    return laidOutNodes.find(n => n.id === hoveredNodeId) || null;
  }, [hoveredNodeId, laidOutNodes]);

  // Node position map
  const nodePosMap = useMemo(() => {
    const m = new Map<string, { x: number; y: number; radius: number }>();
    laidOutNodes.forEach(n => {
      if (n && n.id && isFiniteCoord(n.x) && isFiniteCoord(n.y)) {
        m.set(n.id, { x: n.x, y: n.y, radius: (n as any).radius || NODE_RADIUS });
      } else {
        console.warn('[EvidenceGraph] Node skipped from posMap due to non-finite coordinates:', n);
      }
    });
    return m;
  }, [laidOutNodes]);

  // Stage columns with at least one node
  const activeStagesWithCoords = useMemo(() => {
    const seenStages = new Set<StageName>();
    laidOutNodes.forEach(n => {
      seenStages.add(getNodeStageName(n.nodeType, n.status));
    });

    const list: { stage: StageName; name: string; x: number }[] = [];
    STAGE_ORDER.forEach(st => {
      if (seenStages.has(st)) {
        const stageNodes = laidOutNodes.filter(n => getNodeStageName(n.nodeType, n.status) === st && isFiniteCoord(n.x));
        const avgX = stageNodes.length > 0 && isFiniteCoord(stageNodes[0].x)
          ? stageNodes[0].x
          : CANONICAL_STAGE_X[st];
        list.push({
          stage: st,
          name: STAGE_DISPLAY_NAMES[st],
          x: avgX,
        });
      }
    });
    return list;
  }, [laidOutNodes]);

  /* ── Filtered Nodes ─────────────────────────────────────────────────────── */

  const filteredNodes = useMemo(() => {
    return laidOutNodes.filter(node => {
      if (activeFilter === 'ALL') return true;
      const nt = String(node.nodeType).toUpperCase();
      if (activeFilter === 'FINDINGS') return nt.includes('FINDING') || nt.includes('EVIDENCE');
      if (activeFilter === 'ASSETS') return !nt.includes('FINDING');
      return true;
    });
  }, [laidOutNodes, activeFilter]);

  /* ── Blast Radius Traversal ─────────────────────────────────────────────── */

  const connectedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeSelectedNode) {
      ids.add(activeSelectedNode.id);
      graphEdges.forEach((edge: GraphEdgeType) => {
        if (!edge) return;
        if (edge.sourceId === activeSelectedNode.id) ids.add(edge.targetId);
        if (edge.targetId === activeSelectedNode.id) ids.add(edge.sourceId);
      });
    }
    return ids;
  }, [activeSelectedNode, graphEdges]);

  /* ── Hover Connections ──────────────────────────────────────────────────── */

  const hoveredConnectedEdgeIds = useMemo(() => {
    if (!hoveredNodeId) return new Set<string>();
    const set = new Set<string>();
    graphEdges.forEach((e: GraphEdgeType) => {
      if (e.sourceId === hoveredNodeId || e.targetId === hoveredNodeId) {
        set.add(e.id);
      }
    });
    return set;
  }, [hoveredNodeId, graphEdges]);

  const nodeStatusById = useMemo(() => {
    const m = new Map<string, NormalizedStatus>();
    laidOutNodes.forEach(n => m.set(n.id, n.status));
    return m;
  }, [laidOutNodes]);

  const obstaclesList = useMemo(() => {
    return laidOutNodes
      .filter(n => n && isFiniteCoord(n.x) && isFiniteCoord(n.y))
      .map(n => ({ x: n.x, y: n.y, id: n.id }));
  }, [laidOutNodes]);

  /* ── Edges using Straight Lines from Right Edge to Left Edge ────────────── */

  const edgesWithMeta = useMemo(() => {
    return graphEdges
      .map((edge: GraphEdgeType, idx: number) => {
        if (!edge || !edge.id || !edge.sourceId || !edge.targetId) {
          console.warn('[EvidenceGraph] Edge skipped due to missing properties:', edge);
          return null;
        }
        const source = nodePosMap.get(edge.sourceId);
        const target = nodePosMap.get(edge.targetId);
        if (!source || !target) return null;

        if (
          !isFiniteCoord(source.x) ||
          !isFiniteCoord(source.y) ||
          !isFiniteCoord(target.x) ||
          !isFiniteCoord(target.y)
        ) {
          console.warn('[EvidenceGraph] Edge skipped due to non-finite endpoints:', edge, source, target);
          return null;
        }

        const srcNode = laidOutNodes.find(n => n.id === edge.sourceId);
        const tgtNode = laidOutNodes.find(n => n.id === edge.targetId);
        const srcStage = getNodeStage(srcNode?.nodeType || '', srcNode?.status);
        const tgtStage = getNodeStage(tgtNode?.nodeType || '', tgtNode?.status);
        const isColumnSkipping = Math.abs(srcStage - tgtStage) > 1;

        const srcStatus = nodeStatusById.get(edge.sourceId) ?? 'unknown';
        const tgtStatus = nodeStatusById.get(edge.targetId) ?? 'unknown';
        const cat = edgeVisualCategory(srcStatus, tgtStatus);

        const edgeObstacles = obstaclesList.filter(
          o => o.id !== edge.sourceId && o.id !== edge.targetId,
        );

        const path = buildEdgePath(
          source.x,
          source.y,
          target.x,
          target.y,
          source.radius,
          target.radius,
          edgeObstacles,
        );

        const midpoint = {
          x: (source.x + target.x) / 2,
          y: (source.y + target.y) / 2,
        };

        return {
          edge,
          idx,
          source,
          target,
          cat,
          path,
          midpoint,
          isColumnSkipping,
        };
      })
      .filter(Boolean) as {
      edge: GraphEdgeType;
      idx: number;
      source: { x: number; y: number; radius: number };
      target: { x: number; y: number; radius: number };
      cat: EdgeVisualCategory;
      path: string;
      midpoint: { x: number; y: number };
      isColumnSkipping: boolean;
    }[];
  }, [graphEdges, nodePosMap, nodeStatusById, laidOutNodes, obstaclesList]);

  /* ── Particle Animation & Viewport Tracking ─────────────────────────────── */

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafId = useRef<number | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const isTabVisibleRef = useRef<boolean>(typeof document !== 'undefined' ? !document.hidden : true);
  const isGraphIntersectingRef = useRef<boolean>(true);
  const prefersReducedMotion = useRef<boolean>(false);
  const edgePathsRef = useRef<Map<number, SVGPathElement>>(new Map());
  const particleCirclesRef = useRef<Map<number, SVGCircleElement>>(new Map());

  // Stop single animation frame cleanly
  const stopAnimationLoop = useCallback(() => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  }, []);

  // Per-frame worker: direct DOM attribute updates through SVG refs, 0 React state updates
  const animateFrame = useCallback(() => {
    if (!isTabVisibleRef.current || !isGraphIntersectingRef.current || prefersReducedMotion.current) {
      rafId.current = null;
      return;
    }

    const svg = svgRef.current;
    if (!svg) {
      rafId.current = null;
      return;
    }

    const particles = particlesRef.current;
    const edgePaths = edgePathsRef.current;
    const circles = particleCirclesRef.current;

    for (let pIdx = 0; pIdx < particles.length; pIdx++) {
      const p = particles[pIdx];
      p.t += p.speed;
      if (p.t > 1) p.t -= 1;

      const pathEl = edgePaths.get(p.edgeIndex);
      if (!pathEl) continue;

      let circleEl = circles.get(pIdx);
      if (!circleEl) {
        circleEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circleEl.setAttribute('r', '2.5');
        circleEl.setAttribute('class', `ev-graph-particle ev-graph-particle--${p.cat}`);
        circleEl.style.fill = particleColor(p.cat);
        circleEl.style.opacity = '0.85';
        svg.querySelector('.graph-particles-layer')?.appendChild(circleEl);
        circles.set(pIdx, circleEl);
      }

      try {
        const length = pathEl.getTotalLength();
        if (length > 0) {
          const pt = pathEl.getPointAtLength(p.t * length);
          if (Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
            circleEl.setAttribute('cx', pt.x.toFixed(1));
            circleEl.setAttribute('cy', pt.y.toFixed(1));
            circleEl.style.display = '';
          } else {
            console.warn('[EvidenceGraph] Particle coordinate non-finite:', pt);
            circleEl.style.display = 'none';
          }
        } else {
          circleEl.style.display = 'none';
        }
      } catch {
        circleEl.style.display = 'none';
      }
    }

    rafId.current = requestAnimationFrame(animateFrame);
  }, []);

  // Start animation loop: strictly checks ref so a second loop is NEVER started
  const startAnimationLoop = useCallback(() => {
    if (rafId.current !== null) {
      return;
    }
    if (!isTabVisibleRef.current || !isGraphIntersectingRef.current || prefersReducedMotion.current) {
      return;
    }
    rafId.current = requestAnimationFrame(animateFrame);
  }, [animateFrame]);

  // Reduced motion media query listener
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mq) {
      prefersReducedMotion.current = mq.matches;
      const handler = (e: MediaQueryListEvent) => {
        prefersReducedMotion.current = e.matches;
        if (e.matches) {
          stopAnimationLoop();
        } else {
          startAnimationLoop();
        }
      };
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [startAnimationLoop, stopAnimationLoop]);

  // IntersectionObserver to pause loop when graph is offscreen
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(
      entries => {
        const intersecting = entries[0]?.isIntersecting ?? true;
        isGraphIntersectingRef.current = intersecting;
        if (intersecting && isTabVisibleRef.current) {
          startAnimationLoop();
        } else {
          stopAnimationLoop();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [startAnimationLoop, stopAnimationLoop]);

  // Tab visibilitychange listener to pause loop when tab is hidden
  useEffect(() => {
    const handler = () => {
      const visible = !document.hidden;
      isTabVisibleRef.current = visible;
      if (visible && isGraphIntersectingRef.current) {
        startAnimationLoop();
      } else {
        stopAnimationLoop();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
    };
  }, [startAnimationLoop, stopAnimationLoop]);

  // Particle population on edge changes (capped to MAX_PARTICLES=60)
  useEffect(() => {
    stopAnimationLoop();
    if (prefersReducedMotion.current) return;

    const svg = svgRef.current;
    if (!svg) return;

    particleCirclesRef.current.forEach(c => {
      if (c.parentNode) c.parentNode.removeChild(c);
    });
    particleCirclesRef.current.clear();
    edgePathsRef.current.clear();

    const pathElements = svg.querySelectorAll<SVGPathElement>('.ev-graph-edge-path');
    const newParticles: Particle[] = [];

    pathElements.forEach((pathEl, idx) => {
      edgePathsRef.current.set(idx, pathEl);
      const cat = (pathEl.dataset.cat as EdgeVisualCategory) || 'normal';
      const speed = particleSpeed(cat);

      newParticles.push({ edgeIndex: idx, t: 0.1, speed, cat });
      newParticles.push({ edgeIndex: idx, t: 0.6, speed, cat });
    });

    particlesRef.current = newParticles.slice(0, MAX_PARTICLES);
    startAnimationLoop();

    return () => {
      stopAnimationLoop();
      particleCirclesRef.current.forEach(c => {
        if (c.parentNode) c.parentNode.removeChild(c);
      });
      particleCirclesRef.current.clear();
      edgePathsRef.current.clear();
    };
  }, [edgesWithMeta, startAnimationLoop, stopAnimationLoop]);

  // Global unmount cleanup for animation
  useEffect(() => {
    return () => {
      stopAnimationLoop();
    };
  }, [stopAnimationLoop]);

  /* ── Live Polling & On-Mount Fetch ──────────────────────────────────────── */

  useEffect(() => {
    loadEvidenceGraph();
  }, [loadEvidenceGraph, currentScanId]);

  const liveGraphIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isScanning || isScanCompleted) {
      if (liveGraphIntervalRef.current !== null) {
        clearInterval(liveGraphIntervalRef.current);
        liveGraphIntervalRef.current = null;
      }
      return;
    }
    liveGraphIntervalRef.current = window.setInterval(() => {
      loadEvidenceGraph();
    }, POLL_INTERVAL_MS);
    return () => {
      if (liveGraphIntervalRef.current !== null) {
        clearInterval(liveGraphIntervalRef.current);
        liveGraphIntervalRef.current = null;
      }
    };
  }, [isScanning, isScanCompleted, loadEvidenceGraph]);

  /* ── Tooltip Handlers ───────────────────────────────────────────────────── */

  const handleNodeEnter = useCallback(
    (node: GraphNode, x: number, y: number) => {
      setHoveredNodeId(node.id);
      const counts = computeConnectionCounts(node.id, graphEdges);
      setTooltip({
        node,
        x,
        y,
        upstreamCount: counts.upstream,
        downstreamCount: counts.downstream,
      });
    },
    [graphEdges],
  );

  const handleNodeLeave = useCallback(() => {
    setHoveredNodeId(null);
    setTooltip(null);
  }, []);

  /* ── Canvas Selection & Non-Passive Wheel Zoom ──────────────────────────── */

  // Click outside and Escape key release graph active mode so normal page scrolling resumes
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsGraphActive(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsGraphActive(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Native non-passive wheel event listener:
  // When inactive: DO NOT intercept wheel events, allowing smooth two-finger page scroll.
  // When active: preventDefault and zoom the graph.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheelHandler = (e: WheelEvent) => {
      if (!isGraphActive) return;

      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      setZoomTransform(prev => {
        const nextK = prev.k * zoomFactor;
        return sanitizeTransform({ ...prev, k: nextK });
      });
    };

    container.addEventListener('wheel', onWheelHandler, { passive: false });
    return () => container.removeEventListener('wheel', onWheelHandler);
  }, [isGraphActive]);

  /* ── Zoom and Pan Handlers (Guarded with Finite Check and Clamping) ─────── */

  const handleZoomIn = () => {
    setZoomTransform(prev => sanitizeTransform({ ...prev, k: prev.k * 1.15 }));
  };

  const handleZoomOut = () => {
    setZoomTransform(prev => sanitizeTransform({ ...prev, k: prev.k * 0.85 }));
  };

  const handleFitGraph = () => {
    setZoomTransform({ ...DEFAULT_ZOOM_TRANSFORM });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsGraphActive(true);
    if ((e.target as HTMLElement).closest('.ev-graph-node-group')) return;
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialX: zoomTransform.x,
      initialY: zoomTransform.y,
    };
  };

  // Dragging event listeners attached to window with guaranteed cleanup
  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      setZoomTransform(prev =>
        sanitizeTransform({
          ...prev,
          x: dragStartRef.current!.initialX + dx,
          y: dragStartRef.current!.initialY + dy,
        }),
      );
    };

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging]);

  /* ════════════════════════════════════════════════════════════════════════ */
  /* Render                                                                   */
  /* ════════════════════════════════════════════════════════════════════════ */

  const safeTransform = sanitizeTransform(zoomTransform);

  return (
    <div
      id="evidence-graph-section"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        height: 'min(70vh, 640px)',
        maxHeight: 'min(70vh, 640px)',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* Title & Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '12px',
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Network size={16} strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
            <h3
              style={{
                fontSize: '15px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                letterSpacing: '-0.01em',
                margin: 0,
              }}
            >
              Directed Evidence & Lineage Property Graph
            </h3>
            <Badge variant={graphDigest ? 'success' : 'warning'} size="sm">
              {graphDigest ? 'Graph sealed' : 'Graph unavailable'}
            </Badge>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
            Horizontal multi-stage zero-trust lineage. Critical anomalies flagged in top-left.
          </p>
        </div>

        {/* Toolbar: Filters & Fit Reset */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {(['ALL', 'ASSETS', 'FINDINGS'] as const).map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              style={{
                padding: '0.25rem 0.55rem',
                fontSize: '11px',
                fontWeight: activeFilter === f ? 600 : 400,
                border: '1px solid',
                borderColor: activeFilter === f ? 'var(--accent-border)' : 'var(--border)',
                backgroundColor: activeFilter === f ? 'var(--accent-surface)' : 'transparent',
                color: activeFilter === f ? 'var(--accent-text)' : 'var(--text-secondary)',
                borderRadius: '0.25rem',
                cursor: 'pointer',
              }}
            >
              {f}
            </button>
          ))}

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '4px' }}>
            <button
              onClick={handleZoomIn}
              title="Zoom In"
              style={{
                padding: '0.25rem 0.45rem',
                fontSize: '11px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface-muted, rgba(255,255,255,0.04))',
                color: 'var(--text-primary)',
                borderRadius: '0.25rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ZoomIn size={12} />
            </button>
            <button
              onClick={handleZoomOut}
              title="Zoom Out"
              style={{
                padding: '0.25rem 0.45rem',
                fontSize: '11px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface-muted, rgba(255,255,255,0.04))',
                color: 'var(--text-primary)',
                borderRadius: '0.25rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ZoomOut size={12} />
            </button>
          </div>

          <button
            onClick={handleFitGraph}
            title="Reset zoom and center graph view"
            style={{
              padding: '0.25rem 0.6rem',
              fontSize: '11px',
              fontWeight: 500,
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-muted, rgba(255,255,255,0.04))',
              color: 'var(--text-primary)',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Maximize2 size={12} />
            Fit
          </button>

          <button
            onClick={() => setIsGraphActive(prev => !prev)}
            title={isGraphActive ? "Click or press Esc to lock graph view" : "Click to select graph for zoom and pan"}
            style={{
              padding: '0.25rem 0.6rem',
              fontSize: '11px',
              fontWeight: 500,
              border: '1px solid',
              borderColor: isGraphActive ? 'var(--accent-border, #00f0ff)' : 'var(--border)',
              backgroundColor: isGraphActive ? 'rgba(0, 240, 255, 0.1)' : 'var(--surface-muted, rgba(255,255,255,0.04))',
              color: isGraphActive ? 'var(--accent, #00f0ff)' : 'var(--text-secondary)',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {isGraphActive ? <Unlock size={12} /> : <Lock size={12} />}
            {isGraphActive ? "Active" : "Locked"}
          </button>
        </div>
      </div>

      {/* Main Workspace: SVG Canvas & Details Drawer */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: activeSelectedNode ? '1fr 340px' : '1fr',
          gap: '16px',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* SVG Canvas Container */}
        <div
          ref={containerRef}
          onClick={() => setIsGraphActive(true)}
          style={{
            backgroundColor: 'var(--terminal-bg)',
            border: isGraphActive ? '1px solid var(--accent, #00f0ff)' : '1px solid var(--border-subtle)',
            boxShadow: isGraphActive ? '0 0 16px rgba(0, 240, 255, 0.12)' : 'none',
            borderRadius: '8px',
            position: 'relative',
            overflow: 'hidden',
            cursor: !isGraphActive ? 'default' : isDragging ? 'grabbing' : 'grab',
            height: '100%',
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          }}
          onMouseDown={handleMouseDown}
        >
          {/* Subtle activation status hint */}
          {!isGraphActive && laidOutNodes.length > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: '12px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
                color: 'var(--terminal-muted)',
                fontSize: '11px',
                padding: '4px 12px',
                borderRadius: '20px',
                pointerEvents: 'none',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                zIndex: 5,
              }}
            >
              <span>Click graph to enable zoom & pan</span>
            </div>
          )}
          {isGraphActive && laidOutNodes.length > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: '12px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(10, 30, 45, 0.95)',
                border: '1px solid rgba(0, 240, 255, 0.4)',
                color: 'var(--accent, #00f0ff)',
                fontSize: '11px',
                padding: '4px 12px',
                borderRadius: '20px',
                pointerEvents: 'none',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                zIndex: 5,
              }}
            >
              <span>Interactive mode active — scroll to zoom, drag to pan. Click outside or Esc to lock.</span>
            </div>
          )}
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ display: 'block', width: '100%', height: '100%', userSelect: 'none' }}
          >
            <defs>
              <marker
                id="arrow-neutral"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--border-strong)" />
              </marker>
              <marker
                id="arrow-accent"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--accent)" />
              </marker>
              <marker
                id="arrow-warning"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--warning)" />
              </marker>
              <marker
                id="arrow-critical"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--critical)" />
              </marker>
            </defs>

            {/* Zoom / Pan Group */}
            <g transform={`translate(${safeTransform.x}, ${safeTransform.y}) scale(${safeTransform.k})`}>
              {/* ── Stage Columns: ONLY render columns that have nodes ────────── */}
              <g className="graph-stage-lines-layer" opacity={0.7}>
                {activeStagesWithCoords.map(st => (
                  <g key={st.stage}>
                    <line
                      x1={st.x}
                      y1={30}
                      x2={st.x}
                      y2={GRAPH_H - 25}
                      stroke="var(--border)"
                      strokeWidth={1}
                      strokeDasharray="4 6"
                    />
                    <text
                      x={st.x}
                      y={22}
                      textAnchor="middle"
                      fill="var(--terminal-muted)"
                      fontSize="9"
                      fontFamily="'JetBrains Mono', monospace"
                      fontWeight="700"
                      letterSpacing="0.6px"
                    >
                      {st.name}
                    </text>
                  </g>
                ))}
              </g>

              {/* ── Edges Layer (Straight lines from right edge to left edge) ── */}
              <g className="graph-edges-layer">
                {edgesWithMeta.map(em => {
                  const isHoveredEdge = hoveredEdgeId === em.edge.id;
                  const isDirectHovered = hoveredConnectedEdgeIds.has(em.edge.id);
                  const isSelectedConnected = activeSelectedNode
                    ? connectedNodeIds.has(em.edge.sourceId) && connectedNodeIds.has(em.edge.targetId)
                    : false;

                  let edgeOpacity = 0.7;
                  if (activeHoveredNode) {
                    edgeOpacity = isDirectHovered ? 1 : 0.1;
                  } else if (hoveredEdgeId) {
                    edgeOpacity = isHoveredEdge ? 1 : 0.2;
                  } else if (activeSelectedNode) {
                    edgeOpacity = isSelectedConnected ? 1 : 0.15;
                  } else if (em.isColumnSkipping) {
                    edgeOpacity = 0.25;
                  }

                  let strokeColor = 'var(--border-strong)';
                  let markerEnd = 'url(#arrow-neutral)';

                  if (em.cat === 'critical') {
                    strokeColor = 'var(--critical)';
                    markerEnd = 'url(#arrow-critical)';
                  } else if (em.cat === 'warning') {
                    strokeColor = 'var(--warning)';
                    markerEnd = 'url(#arrow-warning)';
                  } else if (isDirectHovered || isSelectedConnected) {
                    strokeColor = 'var(--accent)';
                    markerEnd = 'url(#arrow-accent)';
                  }

                  const strokeWidth = em.isColumnSkipping ? (isHoveredEdge ? 2 : 1) : (isHoveredEdge || isDirectHovered ? 2 : 1.5);

                  return (
                    <g key={em.edge.id}>
                      <path
                        d={em.path}
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeDasharray={em.cat === 'interrupted' ? '4 4' : undefined}
                        markerEnd={markerEnd}
                        className="ev-graph-edge-path"
                        data-cat={em.cat}
                        opacity={edgeOpacity}
                        style={{ transition: 'opacity 0.2s ease, stroke 0.2s ease' }}
                      />
                      {/* Invisible hover capture target */}
                      <path
                        d={em.path}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={14}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setHoveredEdgeId(em.edge.id)}
                        onMouseLeave={() => setHoveredEdgeId(null)}
                      />
                    </g>
                  );
                })}
              </g>

              {/* ── Particles Layer ── */}
              <g className="graph-particles-layer" pointerEvents="none" />

              {/* ── Nodes Layer ── */}
              <g className="graph-nodes-layer">
                {filteredNodes.map(node => {
                  if (!node || !node.id || !isFiniteCoord(node.x) || !isFiniteCoord(node.y)) {
                    console.warn('[EvidenceGraph] Skipped rendering node with invalid id or non-finite coords:', node);
                    return null;
                  }
                  const isSelected = activeSelectedNode?.id === node.id;
                  const isHovered = activeHoveredNode?.id === node.id;
                  const isConnected = connectedNodeIds.has(node.id);
                  const isPoisoned = isCriticalOrPoisoned(node);

                  let opacity = 1;
                  if (activeHoveredNode) {
                    const isHoverDirect = activeHoveredNode.id === node.id || hoveredConnectedEdgeIds.size === 0;
                    opacity = isHoverDirect ? 1 : 0.25;
                  } else if (activeSelectedNode) {
                    opacity = isConnected ? 1 : 0.25;
                  }

                  const color = getNodeColor(node);
                  const bg = getNodeBg(node);
                  const r = (node as any).radius || NODE_RADIUS;

                  return (
                    <g
                      key={node.id}
                      className="ev-graph-node-group"
                      transform={`translate(${node.x}, ${node.y})`}
                      style={{ cursor: 'pointer', opacity, transition: 'opacity 0.2s ease' }}
                      onClick={e => {
                        e.stopPropagation();
                        if (node.nodeType === 'SAMPLE_CLUSTER') {
                          setIsClusterExpanded(true);
                          return;
                        }
                        setSelectedGraphNode(isSelected ? null : node);
                      }}
                      onMouseEnter={() => handleNodeEnter(node, node.x, node.y)}
                      onMouseLeave={handleNodeLeave}
                    >
                      {/* Poisoned / Critical Indicator: Red outer ring and small red dot */}
                      {isPoisoned && (
                        <>
                          <circle
                            r={r + 4}
                            fill="none"
                            stroke="var(--critical, #ef4444)"
                            strokeWidth={2}
                            strokeDasharray="4 3"
                            className="ev-graph-node-incident"
                          />
                          <circle
                            cx={r * 0.7}
                            cy={-r * 0.7}
                            r={3.5}
                            fill="var(--critical, #ef4444)"
                            stroke="var(--terminal-bg, #0f172a)"
                            strokeWidth={1}
                          />
                        </>
                      )}

                      {/* Main Node Circle */}
                      <circle
                        r={r}
                        fill={bg}
                        stroke={isSelected ? 'var(--accent)' : color}
                        strokeWidth={isSelected || isHovered ? 2.5 : 1.5}
                      />

                      {/* Center Node Icon */}
                      <g style={{ color }} transform="translate(-7, -7)" pointerEvents="none">
                        {getNodeIcon(node.nodeType)}
                      </g>

                      {/* Short label under node (max 10 chars + ellipsis) */}
                      <text
                        y={r + 14}
                        fill="var(--terminal-text)"
                        fontSize="11"
                        fontFamily="Inter, sans-serif"
                        fontWeight="500"
                        textAnchor="middle"
                        pointerEvents="none"
                      >
                        {formatNodeLabel(node.label || node.id)}
                      </text>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>

          {/* Empty state message inside canvas */}
          {laidOutNodes.length === 0 && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: '8px',
                color: 'var(--text-muted)',
                fontSize: '13px',
                pointerEvents: 'none',
              }}
            >
              <span>No evidence graph available for current investigation</span>
            </div>
          )}

          {/* Hover Tooltip (shows full type caption and metadata) */}
          {tooltip && activeHoveredNode && (
            <div
              className="ev-graph-tooltip visible"
              style={{
                position: 'absolute',
                left: `${Math.min(92, Math.max(8, ((isFiniteCoord(tooltip.x) ? tooltip.x : GRAPH_W / 2) / GRAPH_W) * 100))}%`,
                top: `${Math.min(88, Math.max(12, ((isFiniteCoord(tooltip.y) ? tooltip.y : GRAPH_H / 2) / GRAPH_H) * 100))}%`,
                pointerEvents: 'none',
              }}
            >
              <div className="ev-graph-tooltip-title">
                <span>{activeHoveredNode.label || activeHoveredNode.id}</span>
                <span
                  className="ev-graph-tooltip-tag"
                  style={{
                    color: getNodeColor(activeHoveredNode),
                    borderColor: getNodeColor(activeHoveredNode),
                  }}
                >
                  {String(activeHoveredNode.nodeType)}
                </span>
              </div>
              <div className="ev-graph-tooltip-row">
                <span className="ev-graph-tooltip-label">Entity ID:</span>
                <span className="ev-graph-tooltip-val">{activeHoveredNode.id}</span>
              </div>
              {activeHoveredNode.digest && (
                <div className="ev-graph-tooltip-row">
                  <span className="ev-graph-tooltip-label">SHA-256:</span>
                  <span className="ev-graph-tooltip-val" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9px' }}>
                    {activeHoveredNode.digest.substring(0, 16)}…
                  </span>
                </div>
              )}
              <div className="ev-graph-tooltip-row">
                <span className="ev-graph-tooltip-label">Status:</span>
                <span className="ev-graph-tooltip-val" style={{ color: getNodeColor(activeHoveredNode), textTransform: 'capitalize' }}>
                  {activeHoveredNode.status}
                </span>
              </div>
              <div className="ev-graph-tooltip-row">
                <span className="ev-graph-tooltip-label">Upstream:</span>
                <span className="ev-graph-tooltip-val">{tooltip.upstreamCount} linked</span>
              </div>
              <div className="ev-graph-tooltip-row">
                <span className="ev-graph-tooltip-label">Downstream:</span>
                <span className="ev-graph-tooltip-val">{tooltip.downstreamCount} linked</span>
              </div>
            </div>
          )}
        </div>

        {/* Selected Node Details Drawer */}
        {activeSelectedNode && (
          <div
            style={{
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              fontSize: '12px',
              height: '100%',
              maxHeight: '100%',
              overflowY: 'auto',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: getNodeColor(activeSelectedNode), display: 'flex', alignItems: 'center' }}>
                  {getNodeIcon(activeSelectedNode.nodeType)}
                </span>
                <Badge variant="default" size="sm">
                  {activeSelectedNode.nodeType}
                </Badge>
              </div>
              <button
                onClick={() => setSelectedGraphNode(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}
              >
                Clear
              </button>
            </div>

            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
                {activeSelectedNode.label}
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginTop: '2px',
                }}
              >
                {activeSelectedNode.id}
              </div>
            </div>

            {activeSelectedNode.digest && (
              <div
                style={{
                  backgroundColor: 'var(--terminal-bg)',
                  padding: '8px',
                  borderRadius: '4px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '10px',
                  color: 'var(--accent-text)',
                  wordBreak: 'break-all',
                }}
              >
                SHA256: {activeSelectedNode.digest}
              </div>
            )}

            {/* Properties summary */}
            {activeSelectedNode.properties &&
              typeof activeSelectedNode.properties === 'object' &&
              !Array.isArray(activeSelectedNode.properties) &&
              Object.keys(activeSelectedNode.properties).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Properties
                </div>
                {Object.entries(activeSelectedNode.properties).slice(0, 8).map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      fontSize: '11px',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>{k}:</span>
                    <span
                      style={{
                        color: 'var(--text-secondary)',
                        fontFamily: typeof v === 'number' || typeof v === 'boolean' ? "'JetBrains Mono', monospace" : 'inherit',
                        textAlign: 'right',
                        wordBreak: 'break-all',
                      }}
                    >
                      {String(v)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px', marginTop: '4px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                Blast radius traversal: {connectedNodeIds.size} linked entities
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedGraphNode(null)}
              style={{ width: '100%', marginTop: 'auto' }}
            >
              Reset Graph Focus
            </Button>
          </div>
        )}
      </div>

      {/* Footer Instructions */}
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>
        Mouse wheel to zoom, drag to pan. Click any node to trace blast radius and inspect provenance metadata.
      </div>
    </div>
  );
};


/* ════════════════════════════════════════════════════════════════════════════
   Error Boundary Wrapper: EvidenceGraphErrorBoundary & EvidenceGraph
   ════════════════════════════════════════════════════════════════════════════ */

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  resetKey: number;
}

export class EvidenceGraphErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, resetKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[EvidenceGraph] Error message:', error?.message);
    console.error('[EvidenceGraph] Error stack:', error?.stack);
    console.error('[EvidenceGraph] Component stack:', errorInfo?.componentStack);
  }

  handleReset = () => {
    this.setState(prev => ({ hasError: false, error: undefined, resetKey: prev.resetKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          id="evidence-graph-error-fallback"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '24px',
            height: 'min(70vh, 640px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ color: 'var(--critical, #ef4444)', fontSize: '18px', fontWeight: 600 }}>
            Graph error - Reset view
          </div>
          {this.state.error?.message && (
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '12px',
                color: 'var(--critical, #ef4444)',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '6px',
                padding: '8px 14px',
                maxWidth: '650px',
                wordBreak: 'break-word',
              }}
            >
              {this.state.error.message}
            </div>
          )}
          <div style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: '13px', maxWidth: '420px' }}>
            The evidence graph encountered a rendering error. Click below to safely reinitialize the graph.
          </div>
          <Button variant="primary" size="sm" onClick={this.handleReset}>
            Reset view
          </Button>
        </div>
      );
    }
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}

export const EvidenceGraph: React.FC = () => {
  return (
    <EvidenceGraphErrorBoundary>
      <EvidenceGraphInner />
    </EvidenceGraphErrorBoundary>
  );
};
