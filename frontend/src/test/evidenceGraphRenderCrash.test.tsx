import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { EvidenceGraph } from '../components/results/EvidenceGraph';
import { InvestigationContext, type InvestigationContextType } from '../state/investigationStore';

function TestHarness({
  initialNodes,
  initialEdges,
  onControllerReady,
}: {
  initialNodes: any[];
  initialEdges: any[];
  onControllerReady: (controller: any) => void;
}) {
  const [nodes, setNodes] = useState<any[]>(initialNodes);
  const [edges, setEdges] = useState<any[]>(initialEdges);
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isScanCompleted, setIsScanCompleted] = useState(true);

  React.useEffect(() => {
    onControllerReady({ setNodes, setEdges, setSelectedNode, setIsScanning, setIsScanCompleted });
  }, [onControllerReady]);

  const mockContextValue: Partial<InvestigationContextType> = {
    currentScanId: 'test-scan-1',
    graphNodes: nodes,
    graphEdges: edges,
    graphDigest: 'digest-1',
    selectedGraphNode: selectedNode,
    setSelectedGraphNode: setSelectedNode,
    isScanning,
    isScanCompleted,
    loadEvidenceGraph: vi.fn(),
  };

  return (
    <InvestigationContext.Provider value={mockContextValue as InvestigationContextType}>
      <EvidenceGraph />
    </InvestigationContext.Provider>
  );
}

describe('EvidenceGraph Render Crash Scenarios', () => {
  const sampleNodes: any[] = [
    { id: 'actor_1', nodeType: 'CONTRIBUTOR', label: 'Alice', status: 'normal', properties: {} },
    { id: 'dataset_1', nodeType: 'DATASET_BATCH', label: 'Batch 1', status: 'normal', properties: {} },
    { id: 'sample_1', nodeType: 'SAMPLE', label: 'Sample 1', status: 'normal', properties: {} },
    { id: 'sample_2', nodeType: 'SAMPLE', label: 'Sample 2', status: 'normal', properties: {} },
    { id: 'finding_1', nodeType: 'FUSION_ASSESSMENT', label: 'Finding 1', status: 'critical', properties: {} },
  ];

  const sampleEdges: any[] = [
    { id: 'e1', sourceId: 'actor_1', targetId: 'dataset_1', edgeType: 'AUTHORED_BY' },
    { id: 'e2', sourceId: 'dataset_1', targetId: 'sample_1', edgeType: 'CONTAINS_SAMPLE' },
    { id: 'e3', sourceId: 'dataset_1', targetId: 'sample_2', edgeType: 'CONTAINS_SAMPLE' },
    { id: 'e4', sourceId: 'sample_1', targetId: 'finding_1', edgeType: 'FLAGGED_WITH' },
  ];

  it('(a) re-render with the same nodes but a changed status', async () => {
    let controller: any = null;
    render(
      <TestHarness
        initialNodes={sampleNodes}
        initialEdges={sampleEdges}
        onControllerReady={c => { controller = c; }}
      />
    );

    await act(async () => {
      controller.setNodes([
        { ...sampleNodes[0] },
        { ...sampleNodes[1] },
        { ...sampleNodes[2], status: 'critical' },
        { ...sampleNodes[3] },
        { ...sampleNodes[4] },
      ]);
    });

    expect(screen.queryByText(/Graph error/i)).toBeNull();
  });

  it('(b) node removed while hovered or selected', async () => {
    let controller: any = null;
    const { container } = render(
      <TestHarness
        initialNodes={sampleNodes}
        initialEdges={sampleEdges}
        onControllerReady={c => { controller = c; }}
      />
    );

    // Hover over sample_1
    const nodeGroups = container.querySelectorAll('.ev-graph-node-group');
    expect(nodeGroups.length).toBeGreaterThan(0);
    fireEvent.mouseEnter(nodeGroups[2]);

    // Select sample_1
    await act(async () => {
      controller.setSelectedNode(sampleNodes[2]);
    });

    // Remove sample_1 from nodes
    await act(async () => {
      controller.setNodes([
        sampleNodes[0],
        sampleNodes[1],
        sampleNodes[3], // sample_1 removed
        sampleNodes[4],
      ]);
      controller.setEdges([
        sampleEdges[0],
        sampleEdges[2],
      ]);
    });

    expect(screen.queryByText(/Graph error/i)).toBeNull();
  });

  it('(c) fresh nodes/edges array with identical ids', async () => {
    let controller: any = null;
    render(
      <TestHarness
        initialNodes={sampleNodes}
        initialEdges={sampleEdges}
        onControllerReady={c => { controller = c; }}
      />
    );

    await act(async () => {
      controller.setNodes(sampleNodes.map(n => ({ ...n })));
      controller.setEdges(sampleEdges.map(e => ({ ...e })));
    });

    expect(screen.queryByText(/Graph error/i)).toBeNull();
  });

  it('(d) backend data with missing layout coordinates, null properties, or detached selected node', async () => {
    let controller: any = null;
    render(
      <TestHarness
        initialNodes={sampleNodes}
        initialEdges={sampleEdges}
        onControllerReady={c => { controller = c; }}
      />
    );

    // Node with null properties
    await act(async () => {
      controller.setSelectedNode({
        id: 'external_detached_node',
        label: 'Detached',
        nodeType: 'SAMPLE',
        status: undefined,
        properties: null,
      });
    });

    expect(screen.queryByText(/Graph error/i)).toBeNull();
  });
});
