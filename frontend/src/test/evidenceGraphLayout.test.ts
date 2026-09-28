import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import {
  layoutGraph,
  GRAPH_W,
  GRAPH_H,
  isFiniteCoord,
  buildEdgePath,
  countEdgeCrossings,
  computeGraphHeight,
  sanitizeTransform,
  DEFAULT_ZOOM_TRANSFORM,
  EvidenceGraphErrorBoundary,
  type InputGraphNode,
} from "../components/results/EvidenceGraph";
import type { GraphEdge, GraphNode } from "../types/graph";

describe("EvidenceGraph Layout & Coordinate Geometry", () => {
  const sampleNodes: InputGraphNode[] = [
    {
      id: "actor_alice",
      label: "Contributor Alice",
      nodeType: "CONTRIBUTOR",
      status: "normal",
      properties: {},
    },
    {
      id: "dataset_v1",
      label: "Batch Ingestion 01",
      nodeType: "DATASET_BATCH",
      status: "normal",
      properties: {},
    },
    {
      id: "model_resnet",
      label: "ResNet50 Weights",
      nodeType: "MODEL",
      status: "warning",
      properties: {},
    },
    {
      id: "infer_rec_99",
      label: "Inference Run 99",
      nodeType: "INFERENCE_RECORD",
      status: "normal",
      properties: {},
    },
    {
      id: "fused_finding_01",
      label: "Fusion Assessment",
      nodeType: "FUSION_ASSESSMENT",
      status: "critical",
      properties: {},
    },
  ];

  const sampleEdges: GraphEdge[] = [
    { id: "e1", sourceId: "actor_alice", targetId: "dataset_v1", edgeType: "AUTHORED_BY" },
    { id: "e2", sourceId: "dataset_v1", targetId: "model_resnet", edgeType: "TRAINED_ON" },
    { id: "e3", sourceId: "model_resnet", targetId: "infer_rec_99", edgeType: "GENERATED_BY" },
    { id: "e4", sourceId: "infer_rec_99", targetId: "fused_finding_01", edgeType: "FLAGGED_WITH" },
  ];

  it("asserts all laid-out coordinates are finite and inside the viewBox", () => {
    const laidOut = layoutGraph(sampleNodes, sampleEdges);

    expect(laidOut.length).toBe(sampleNodes.length);

    laidOut.forEach(node => {
      expect(isFiniteCoord(node.x)).toBe(true);
      expect(isFiniteCoord(node.y)).toBe(true);
      expect(Number.isNaN(node.x)).toBe(false);
      expect(Number.isNaN(node.y)).toBe(false);

      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(GRAPH_W);
      expect(node.y).toBeGreaterThan(0);
      expect(node.y).toBeLessThan(GRAPH_H);

      expect(node.x === 0 && node.y === 0).toBe(false);
    });
  });

  it("spans nodes across canvas in 5 readable stage columns", () => {
    const laidOut = layoutGraph(sampleNodes, sampleEdges);
    const byId = Object.fromEntries(laidOut.map(n => [n.id, n]));

    const actor = byId["actor_alice"];
    const dataset = byId["dataset_v1"];
    const model = byId["model_resnet"];
    const inference = byId["infer_rec_99"];
    const finding = byId["fused_finding_01"];

    // Stage X must strictly advance from left to right across the canvas
    expect(actor.x).toBeLessThan(dataset.x);
    expect(dataset.x).toBeLessThan(model.x);
    expect(model.x).toBeLessThan(inference.x);
    expect(inference.x).toBeLessThan(finding.x);

    // First stage at left bound (120), last stage at right bound (1500)
    expect(actor.x).toBe(120);
    expect(finding.x).toBe(1500);
  });

  it("handles missing, NaN, or 0 coordinates gracefully and places in stage column", () => {
    const problematicNodes: InputGraphNode[] = [
      {
        id: "bad_node_1",
        label: "Missing Pos",
        nodeType: "CONTRIBUTOR",
        status: "normal",
        properties: {},
        x: undefined,
        y: undefined,
      },
      {
        id: "bad_node_2",
        label: "NaN Pos",
        nodeType: "MODEL",
        status: "warning",
        properties: {},
        x: NaN,
        y: NaN,
      },
      {
        id: "bad_node_3",
        label: "Zero Pos",
        nodeType: "FUSION_ASSESSMENT",
        status: "critical",
        properties: {},
        x: 0,
        y: 0,
      },
    ];

    const laidOut = layoutGraph(problematicNodes, []);
    expect(laidOut.length).toBe(3);

    laidOut.forEach(node => {
      expect(isFiniteCoord(node.x)).toBe(true);
      expect(isFiniteCoord(node.y)).toBe(true);
      expect(node.x).toBeGreaterThan(0);
      expect(node.y).toBeGreaterThan(0);
    });
  });

  it("spreads multiple nodes within the same column evenly along y", () => {
    const columnNodes: InputGraphNode[] = [
      { id: "m1", label: "Model A", nodeType: "MODEL", status: "normal", properties: {} },
      { id: "m2", label: "Model B", nodeType: "MODEL", status: "normal", properties: {} },
      { id: "m3", label: "Model C", nodeType: "MODEL", status: "normal", properties: {} },
    ];

    const laidOut = layoutGraph(columnNodes, []);
    expect(laidOut.length).toBe(3);

    // All should share the same stage X column
    const colX = laidOut[0].x;
    laidOut.forEach(n => {
      expect(n.x).toBe(colX);
    });

    // Y values must be distinct and spread
    const yVals = laidOut.map(n => n.y).sort((a, b) => a - b);
    expect(yVals[1] - yVals[0]).toBeGreaterThan(25);
    expect(yVals[2] - yVals[1]).toBeGreaterThan(25);
  });

  it("keeps existing nodes stable when new nodes are added on polling", () => {
    const initial = layoutGraph(sampleNodes.slice(0, 3), []);
    const existingMap = new Map<string, { x: number; y: number }>();
    initial.forEach(n => existingMap.set(n.id, { x: n.x, y: n.y }));

    // Poll adds 2 new nodes
    const secondPoll = layoutGraph(sampleNodes, sampleEdges, existingMap);

    // Initial 3 nodes must retain their exact previous coordinates
    initial.forEach(prev => {
      const current = secondPoll.find(n => n.id === prev.id);
      expect(current).toBeDefined();
      expect(current!.x).toBe(prev.x);
      expect(current!.y).toBe(prev.y);
    });

    // New nodes must also have finite coordinates inside viewBox
    secondPoll.slice(3).forEach(n => {
      expect(isFiniteCoord(n.x)).toBe(true);
      expect(isFiniteCoord(n.y)).toBe(true);
      expect(n.x).toBeGreaterThan(0);
      expect(n.y).toBeGreaterThan(0);
    });
  });

  it("builds straight edge paths from node border to node border with no curves", () => {
    const path = buildEdgePath(100, 200, 350, 400);
    expect(path).toMatch(/^M\s+[\d.]+\s+[\d.]+\s+L\s+[\d.]+\s+[\d.]+$/);
    expect(path).not.toContain("C");
    expect(path).not.toContain("Q");
    expect(path).not.toContain("S");

    // Endpoints must start and end on the border
    const [startStr, endStr] = path.replace("M ", "").split(" L ");
    const [sx, sy] = startStr.split(" ").map(Number);
    const [tx, ty] = endStr.split(" ").map(Number);

    const startDist = Math.hypot(sx - 100, sy - 200);
    const endDist = Math.hypot(tx - 350, ty - 400);

    expect(startDist).toBeCloseTo(20, 1);
    expect(endDist).toBeCloseTo(20, 1);
  });

  it("routes column-skipping edges with straight segments around obstacles", () => {
    const directColliding = buildEdgePath(100, 300, 600, 300, 20, 20, [
      { x: 350, y: 300, id: "obstacle_node" },
    ]);

    expect(directColliding).not.toContain("C");
    expect(directColliding).not.toContain("Q");
    expect(directColliding.split("L").length).toBeGreaterThanOrEqual(3);
    expect(directColliding.startsWith("M 120 300")).toBe(true);
  });

  it("asserts the output is deterministic and crossings <= alphabetical ordering", () => {
    const testNodes: InputGraphNode[] = [
      { id: "d1", nodeType: "DATASET_BATCH", label: "Dataset A", status: "normal", properties: {} },
      { id: "d2", nodeType: "DATASET_BATCH", label: "Dataset B", status: "normal", properties: {} },
      { id: "m1", nodeType: "MODEL", label: "Model A", status: "normal", properties: {} },
      { id: "m2", nodeType: "MODEL", label: "Model B", status: "normal", properties: {} },
    ];

    const testEdges: GraphEdge[] = [
      { id: "e1", sourceId: "d1", targetId: "m2", edgeType: "TRAINED_ON" },
      { id: "e2", sourceId: "d2", targetId: "m1", edgeType: "TRAINED_ON" },
    ];

    const run1 = layoutGraph(testNodes, testEdges);
    const run2 = layoutGraph(testNodes, testEdges);

    expect(run1).toEqual(run2);

    const alphaLaidOut: GraphNode[] = [
      { ...testNodes[0], x: 350, y: 250 },
      { ...testNodes[1], x: 350, y: 350 },
      { ...testNodes[2], x: 600, y: 250 },
      { ...testNodes[3], x: 600, y: 350 },
    ];
    const alphaCrossings = countEdgeCrossings(alphaLaidOut, testEdges);
    expect(alphaCrossings).toBe(1);

    const baryCrossings = countEdgeCrossings(run1, testEdges);
    expect(baryCrossings).toBeLessThanOrEqual(alphaCrossings);
    expect(baryCrossings).toBe(0);
  });

  it("renders a 1-image scan as a clean left-to-right chain with horizontal lines and zero crossings", () => {
    const chainNodes: InputGraphNode[] = [
      { id: "actor_1", nodeType: "CONTRIBUTOR", label: "Alice", status: "normal", properties: {} },
      { id: "batch_1", nodeType: "DATASET_BATCH", label: "Batch 1", status: "normal", properties: {} },
      { id: "model_1", nodeType: "MODEL", label: "Model 1", status: "normal", properties: {} },
      { id: "infer_1", nodeType: "INFERENCE_RECORD", label: "Inference 1", status: "normal", properties: {} },
      { id: "finding_1", nodeType: "FUSION_ASSESSMENT", label: "Finding 1", status: "normal", properties: {} },
    ];

    const chainEdges: GraphEdge[] = [
      { id: "e1", sourceId: "actor_1", targetId: "batch_1", edgeType: "AUTHORED_BY" },
      { id: "e2", sourceId: "batch_1", targetId: "model_1", edgeType: "TRAINED_ON" },
      { id: "e3", sourceId: "model_1", targetId: "infer_1", edgeType: "GENERATED_BY" },
      { id: "e4", sourceId: "infer_1", targetId: "finding_1", edgeType: "FLAGGED_WITH" },
    ];

    const laidOut = layoutGraph(chainNodes, chainEdges);

    const yValues = laidOut.map(n => n.y);
    const firstY = yValues[0];
    yValues.forEach(y => {
      expect(y).toBe(firstY);
    });

    expect(countEdgeCrossings(laidOut, chainEdges)).toBe(0);
  });

  // ── Mandatory Vitest Requirements from Task Specification ───────────────

  it("10 sample nodes: all coordinates are finite, inside 0..1600 x 0..600, no two nodes closer than 2 * radius", () => {
    const datasetNode: InputGraphNode = {
      id: "dataset_root",
      nodeType: "DATASET_BATCH",
      label: "Batch",
      status: "normal",
      properties: {},
    };

    const sampleNodes10: InputGraphNode[] = Array.from({ length: 10 }, (_, i) => ({
      id: `sample_${i + 1}`,
      nodeType: "SAMPLE",
      label: `Img ${i + 1}`,
      status: i < 3 ? "critical" : "normal", // 3 poisoned samples
      properties: i < 3 ? { severity: "critical", isPoisoned: true } : {},
    }));

    const edges: GraphEdge[] = sampleNodes10.map(s => ({
      id: `e_${s.id}`,
      sourceId: datasetNode.id,
      targetId: s.id,
      edgeType: "CONTAINS_SAMPLE",
    }));

    const allNodes = [datasetNode, ...sampleNodes10];
    const laidOut = layoutGraph(allNodes, edges);

    expect(laidOut.length).toBe(11);

    // Height must be fixed at 600, never making page taller
    expect(computeGraphHeight(allNodes)).toBe(600);

    // All coordinates finite and inside viewBox
    laidOut.forEach(n => {
      expect(isFiniteCoord(n.x)).toBe(true);
      expect(isFiniteCoord(n.y)).toBe(true);
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(GRAPH_W);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(GRAPH_H);
    });

    // No two nodes closer than 2 * radius
    for (let i = 0; i < laidOut.length; i++) {
      for (let j = i + 1; j < laidOut.length; j++) {
        const n1 = laidOut[i];
        const n2 = laidOut[j];
        const r1 = (n1 as any).radius || 20;
        const r2 = (n2 as any).radius || 20;
        const minDist = r1 + r2;
        const dist = Math.hypot(n1.x - n2.x, n1.y - n2.y);
        expect(dist).toBeGreaterThanOrEqual(minDist - 1);
      }
    }

    // Critical/poisoned samples should be top-left in the grid
    const sampleResults = laidOut.filter(n => n.nodeType === "SAMPLE");
    const firstSample = sampleResults[0];
    expect(firstSample.status).toBe("critical");
  });

  it("40 sample nodes: all coordinates are finite, inside 0..1600 x 0..600, no two nodes closer than 2 * radius", () => {
    const datasetNode: InputGraphNode = {
      id: "dataset_root_40",
      nodeType: "DATASET_BATCH",
      label: "Batch 40",
      status: "normal",
      properties: {},
    };

    const sampleNodes40: InputGraphNode[] = Array.from({ length: 40 }, (_, i) => ({
      id: `sample_${i + 1}`,
      nodeType: "SAMPLE",
      label: `Img ${i + 1}`,
      status: i < 5 ? "critical" : "normal",
      properties: i < 5 ? { severity: "critical" } : {},
    }));

    const edges: GraphEdge[] = sampleNodes40.map(s => ({
      id: `e_${s.id}`,
      sourceId: datasetNode.id,
      targetId: s.id,
      edgeType: "CONTAINS_SAMPLE",
    }));

    const allNodes = [datasetNode, ...sampleNodes40];
    const laidOut = layoutGraph(allNodes, edges);

    expect(laidOut.length).toBe(41);
    expect(computeGraphHeight(allNodes)).toBe(600);

    // All coordinates finite and inside viewBox
    laidOut.forEach(n => {
      expect(isFiniteCoord(n.x)).toBe(true);
      expect(isFiniteCoord(n.y)).toBe(true);
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(GRAPH_W);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(GRAPH_H);
    });

    // No two nodes closer than 2 * radius
    for (let i = 0; i < laidOut.length; i++) {
      for (let j = i + 1; j < laidOut.length; j++) {
        const n1 = laidOut[i];
        const n2 = laidOut[j];
        const r1 = (n1 as any).radius || 14;
        const r2 = (n2 as any).radius || 14;
        const minDist = r1 + r2;
        const dist = Math.hypot(n1.x - n2.x, n1.y - n2.y);
        expect(dist).toBeGreaterThanOrEqual(minDist - 1);
      }
    }
  });

  it("1 sample node: contributor, dataset, sample and finding share the same y (a straight horizontal chain)", () => {
    const chainNodes: InputGraphNode[] = [
      { id: "contributor_01", nodeType: "CONTRIBUTOR", label: "Alice", status: "normal", properties: {} },
      { id: "dataset_01", nodeType: "DATASET_BATCH", label: "Dataset 01", status: "normal", properties: {} },
      { id: "sample_01", nodeType: "SAMPLE", label: "Sample 01", status: "normal", properties: {} },
      { id: "finding_01", nodeType: "FUSION_ASSESSMENT", label: "Verdict 01", status: "critical", properties: {} },
    ];

    const chainEdges: GraphEdge[] = [
      { id: "e1", sourceId: "contributor_01", targetId: "dataset_01", edgeType: "AUTHORED_BY" },
      { id: "e2", sourceId: "dataset_01", targetId: "sample_01", edgeType: "CONTAINS_SAMPLE" },
      { id: "e3", sourceId: "sample_01", targetId: "finding_01", edgeType: "FLAGGED_WITH" },
    ];

    const laidOut = layoutGraph(chainNodes, chainEdges);

    expect(laidOut.length).toBe(4);

    const contributor = laidOut.find(n => n.id === "contributor_01")!;
    const dataset = laidOut.find(n => n.id === "dataset_01")!;
    const sample = laidOut.find(n => n.id === "sample_01")!;
    const finding = laidOut.find(n => n.id === "finding_01")!;

    expect(contributor).toBeDefined();
    expect(dataset).toBeDefined();
    expect(sample).toBeDefined();
    expect(finding).toBeDefined();

    // Contributor, dataset, sample and finding share the same y (a straight horizontal chain)
    expect(contributor.y).toBe(dataset.y);
    expect(sample.y).toBe(dataset.y);
    expect(finding.y).toBe(dataset.y);

    // Left-to-right progression
    expect(contributor.x).toBeLessThan(dataset.x);
    expect(dataset.x).toBeLessThan(sample.x);
    expect(sample.x).toBeLessThan(finding.x);
  });
});

describe("EvidenceGraph Zoom Clamping, Sanitization & Error Boundary", () => {
  it("sanitizeTransform: preserves valid coordinates and clamps zoom between 0.4 and 3.0", () => {
    // Normal transform within range
    expect(sanitizeTransform({ x: 120, y: -80, k: 1.5 })).toEqual({ x: 120, y: -80, k: 1.5 });

    // Clamp lower bound to 0.4
    expect(sanitizeTransform({ x: 0, y: 0, k: 0.1 }).k).toBe(0.4);

    // Clamp upper bound to 3.0
    expect(sanitizeTransform({ x: 0, y: 0, k: 4.8 }).k).toBe(3.0);
  });

  it("sanitizeTransform: resets to Fit view if any coordinate or scale is NaN, Infinity, or negative", () => {
    expect(sanitizeTransform({ x: NaN, y: 0, k: 1 })).toEqual(DEFAULT_ZOOM_TRANSFORM);
    expect(sanitizeTransform({ x: 0, y: Infinity, k: 1 })).toEqual(DEFAULT_ZOOM_TRANSFORM);
    expect(sanitizeTransform({ x: 0, y: 0, k: NaN })).toEqual(DEFAULT_ZOOM_TRANSFORM);
    expect(sanitizeTransform({ x: 0, y: 0, k: -1 })).toEqual(DEFAULT_ZOOM_TRANSFORM);
    expect(sanitizeTransform(null as any)).toEqual(DEFAULT_ZOOM_TRANSFORM);
  });

  it("layoutGraph guards against missing, undefined, or empty node ids", () => {
    const invalidNodes = [
      { id: "", nodeType: "SAMPLE", label: "Empty ID", status: "normal", properties: {} },
      null as any,
      { nodeType: "CONTRIBUTOR", label: "No ID", status: "normal", properties: {} } as any,
    ];
    const result = layoutGraph(invalidNodes, []);
    expect(result).toHaveLength(0);
  });

  it("EvidenceGraphErrorBoundary displays fallback message and reset button on crash", () => {
    const ThrowingComponent = () => {
      throw new Error("Simulated rendering crash");
    };

    render(
      React.createElement(
        EvidenceGraphErrorBoundary,
        null,
        React.createElement(ThrowingComponent, null),
      ),
    );

    expect(screen.getByText("Graph error - Reset view")).toBeDefined();
    expect(screen.getByRole("button", { name: /Reset view/i })).toBeDefined();
  });
});
