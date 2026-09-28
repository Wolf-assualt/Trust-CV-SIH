/**
 * Phase 8 Integration Tests — Frontend ↔ Backend Assurance Integration
 *
 * Verifies:
 * 1. The investigation store initialises in the correct idle state.
 * 2. After a dataset upload the store holds the scan_id from the backend.
 * 3. startScan() refuses to proceed when no scan_id exists.
 * 4. Stage codes in PIPELINE_STAGES match the keys the backend writes into
 *    ScanSession.stage_results (critical for the polling mapper to work).
 * 5. The VerdictCard renders UNAVAILABLE when no assessment is present.
 * 6. clearArtifacts also clears scan state.
 *
 * These tests use the controllable mock API from test/mockApi.ts so no real
 * network calls are made.  The tests verify behaviour, not presentation details.
 */
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InvestigationProvider, useInvestigation } from '../state/investigationStore';
import { PIPELINE_STAGES } from '../data/mockScenario';
import { createMockApiService } from './mockApi';

// ── Backend stage_results keys written by app/api/scan.py ─────────────────
const BACKEND_STAGE_RESULT_KEYS = new Set([
  'DATA_INGESTION',
  'HASH_VERIFICATION',
  'DATASET_ANALYSIS',
  'DUPLICATE_DETECTION',
  'LABEL_INTEGRITY',
  'QUALITY_ANALYSIS',
  'TRIGGER_CANDIDATE_ANALYSIS',
  'OOD_DETECTION',
  'MODEL_INTEGRITY',
  'BACKDOOR_ANALYSIS',
  'INFERENCE_VALIDATION',
  'DISTRIBUTION_SHIFT',
  'EVIDENCE_FUSION',
  'EVIDENCE_GRAPH',
  'FINAL_VERDICT',
]);

// ── Mock API setup ──────────────────────────────────────────────────────────

let mockApiModule: ReturnType<typeof createMockApiService>;

/**
 * Replace the production apiService singleton with the controllable mock.
 */
vi.mock('../services/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/api')>();
  return {
    ...original,
    apiService: new Proxy({} as typeof original.apiService, {
      get(_target, prop: string) {
        // Delegate to the current mock instance so individual tests can override.
        return (mockApiModule?.mock as Record<string, unknown>)?.[prop];
      },
    }),
  };
});

beforeEach(() => {
  mockApiModule = createMockApiService();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── 1. PIPELINE_STAGES code alignment ───────────────────────────────────────

describe('PIPELINE_STAGES stage code alignment', () => {
  it('every stage code exists in the backend stage_results key set', () => {
    const mismatches = PIPELINE_STAGES.filter(
      s => !BACKEND_STAGE_RESULT_KEYS.has(s.code),
    );
    expect(mismatches).toEqual([]);
  });

  it('all stage IDs are unique', () => {
    const ids = PIPELINE_STAGES.map(s => s.id);
    expect(new Set(ids).size).toBe(PIPELINE_STAGES.length);
  });

  it('all stage codes are unique', () => {
    const codes = PIPELINE_STAGES.map(s => s.code);
    expect(new Set(codes).size).toBe(PIPELINE_STAGES.length);
  });

  it('all stages initialize as WAITING', () => {
    const nonWaiting = PIPELINE_STAGES.filter(s => s.status !== 'WAITING');
    expect(nonWaiting).toEqual([]);
  });
});

// ── 2. Helper component ─────────────────────────────────────────────────────

function StoreInspector({
  onRender,
}: {
  onRender: (state: ReturnType<typeof useInvestigation>) => void;
}) {
  const state = useInvestigation();
  onRender(state);
  return null;
}

// ── 3. Initial store state ───────────────────────────────────────────────────

describe('InvestigationStore initial state', () => {
  it('starts with phase=launch and no scan session', async () => {
    let capturedState: ReturnType<typeof useInvestigation> | null = null;

    await act(async () => {
      render(
        <InvestigationProvider>
          <StoreInspector onRender={s => { capturedState = s; }} />
        </InvestigationProvider>,
      );
    });

    expect(capturedState).not.toBeNull();
    expect(capturedState!.phase).toBe('launch');
    expect(capturedState!.currentScanId).toBeNull();
    expect(capturedState!.isScanning).toBe(false);
    expect(capturedState!.isScanCompleted).toBe(false);
    expect(capturedState!.isReadyToScan).toBe(false);
    expect(capturedState!.trustScore).toBeNull();
    expect(capturedState!.findings).toHaveLength(0);
  });
});

// ── 4. startScan guard — must not proceed without scan_id ──────────────────

describe('startScan guard', () => {
  it('sets backendError when called without a scan_id', async () => {
    let capturedState: ReturnType<typeof useInvestigation> | null = null;

    await act(async () => {
      render(
        <InvestigationProvider>
          <StoreInspector onRender={s => { capturedState = s; }} />
        </InvestigationProvider>,
      );
    });

    // isReadyToScan must be false (no upload yet)
    expect(capturedState!.isReadyToScan).toBe(false);
    expect(capturedState!.currentScanId).toBeNull();

    await act(async () => {
      capturedState!.startScan();
    });

    // Should have set a backend error, not transitioned to scan phase.
    expect(capturedState!.backendError).not.toBeNull();
    expect(capturedState!.phase).toBe('launch');
    expect(capturedState!.isScanning).toBe(false);
  });
});

// ── 5. Upload sets scan_id from backend response ────────────────────────────

describe('updateArtifactWithFile — dataset upload', () => {
  it('stores the scan_id returned by the backend after successful upload', async () => {
    let capturedState: ReturnType<typeof useInvestigation> | null = null;

    await act(async () => {
      render(
        <InvestigationProvider>
          <StoreInspector onRender={s => { capturedState = s; }} />
        </InvestigationProvider>,
      );
    });

    const file = new File(['pixel data'], 'dataset.jpg', { type: 'image/jpeg' });

    await act(async () => {
      await capturedState!.updateArtifactWithFile('art-dataset', file);
    });

    await waitFor(() => {
      expect(capturedState!.currentScanId).toBe('scan-mock-001');
    });

    expect(capturedState!.scanSession?.batch_id).toBe('batch-mock-001');
    expect(capturedState!.isReadyToScan).toBe(true);

    // Artifact card should reflect upload state
    const datasetArtifact = capturedState!.artifacts.find(a => a.id === 'art-dataset');
    expect(datasetArtifact?.status).toBe('verified');
    expect(datasetArtifact?.filename).toBe('dataset.jpg');
  });

  it('sets backendError and status=error on upload failure', async () => {
    // Override the mock to simulate upload failure
    (mockApiModule.mock as Record<string, unknown>).uploadAndScanDataset = () =>
      Promise.reject(new Error('Upload failed: server error'));

    let capturedState: ReturnType<typeof useInvestigation> | null = null;

    await act(async () => {
      render(
        <InvestigationProvider>
          <StoreInspector onRender={s => { capturedState = s; }} />
        </InvestigationProvider>,
      );
    });

    const file = new File(['pixel data'], 'bad.jpg', { type: 'image/jpeg' });

    await act(async () => {
      await capturedState!.updateArtifactWithFile('art-dataset', file);
    });

    await waitFor(() => {
      expect(capturedState!.backendError).toContain('Upload failed');
    });

    const datasetArtifact = capturedState!.artifacts.find(a => a.id === 'art-dataset');
    expect(datasetArtifact?.status).toBe('error');
    expect(capturedState!.currentScanId).toBeNull();
    expect(capturedState!.isReadyToScan).toBe(false);
  });
});

// ── 6. VerdictCard UNAVAILABLE state ───────────────────────────────────────

describe('VerdictCard — no assessment', () => {
  it('never invents a verdict when trustScore is null', async () => {
    const { VerdictCard } = await import('../components/results/VerdictCard');

    await act(async () => {
      render(
        <InvestigationProvider>
          <VerdictCard />
        </InvestigationProvider>,
      );
    });

    // Should display the UNAVAILABLE placeholder, not any security verdict.
    expect(screen.getByText(/UNAVAILABLE/i)).toBeTruthy();
    expect(screen.queryByText(/^TRUSTED$/i)).toBeNull();
    expect(screen.queryByText(/^CLEAN$/i)).toBeNull();
  });
});

// ── 7. clearArtifacts also clears scan state ────────────────────────────────

describe('clearArtifacts', () => {
  it('resets scan_id and session when artifacts are cleared', async () => {
    let capturedState: ReturnType<typeof useInvestigation> | null = null;

    await act(async () => {
      render(
        <InvestigationProvider>
          <StoreInspector onRender={s => { capturedState = s; }} />
        </InvestigationProvider>,
      );
    });

    // Upload to create a session
    const file = new File(['data'], 'test.jpg', { type: 'image/jpeg' });
    await act(async () => {
      await capturedState!.updateArtifactWithFile('art-dataset', file);
    });

    await waitFor(() => expect(capturedState!.currentScanId).toBe('scan-mock-001'));

    // Clear should reset everything
    await act(async () => {
      capturedState!.clearArtifacts();
    });

    expect(capturedState!.currentScanId).toBeNull();
    expect(capturedState!.scanSession).toBeNull();
    expect(capturedState!.isReadyToScan).toBe(false);
  });
});

// ── 8. EvidenceGraph — no fabricated data when backend is down ──────────────

describe('EvidenceGraph — no fabricated data when backend is down', () => {
  it('shows empty graph state when fetchGraphExport rejects', async () => {
    // Override mock to simulate backend being down
    (mockApiModule.mock as Record<string, unknown>).fetchGraphExport = () =>
      Promise.reject(new Error('Network error'));

    let capturedState: ReturnType<typeof useInvestigation> | null = null;

    await act(async () => {
      render(
        <InvestigationProvider>
          <StoreInspector onRender={s => { capturedState = s; }} />
        </InvestigationProvider>,
      );
    });

    // Trigger graph load
    await act(async () => {
      await capturedState!.loadEvidenceGraph();
    });

    // Graph must be empty — no fabricated nodes or edges
    expect(capturedState!.graphNodes).toHaveLength(0);
    expect(capturedState!.graphEdges).toHaveLength(0);
    expect(capturedState!.graphDigest).toBe('');
  });

  it('shows empty graph state when fetchGraphExport returns null', async () => {
    (mockApiModule.mock as Record<string, unknown>).fetchGraphExport = () =>
      Promise.resolve(null);

    let capturedState: ReturnType<typeof useInvestigation> | null = null;

    await act(async () => {
      render(
        <InvestigationProvider>
          <StoreInspector onRender={s => { capturedState = s; }} />
        </InvestigationProvider>,
      );
    });

    await act(async () => {
      await capturedState!.loadEvidenceGraph();
    });

    expect(capturedState!.graphNodes).toHaveLength(0);
    expect(capturedState!.graphEdges).toHaveLength(0);
    expect(capturedState!.graphDigest).toBe('');
  });
});


// ── 9. EvidenceGraph scoping, reset isolation, and late response rejection ──

describe('EvidenceGraph scoping, reset isolation, and stale response rejection', () => {
  it('loads graph for scan A, clears immediately on resetInvestigation, and drops slow response from scan A arriving after reset', async () => {
    const scanANodes = [
      { id: 'node_1', node_type: 'DATASET_BATCH', label: 'Batch A', properties: { status: 'passed' } },
      { id: 'node_2', node_type: 'SAMPLE', label: 'Sample 1', properties: { status: 'passed' } },
      { id: 'node_3', node_type: 'SAMPLE', label: 'Sample 2', properties: { status: 'passed' } },
      { id: 'node_4', node_type: 'MODEL', label: 'Model M', properties: { status: 'passed' } },
      { id: 'node_5', node_type: 'FUSION_ASSESSMENT', label: 'Assessment', properties: { status: 'passed' } },
    ];

    const fetchGraphExportMock = vi.fn((_batchId?: string) =>
      Promise.resolve({
        nodes: scanANodes,
        edges: [
          { source_id: 'node_1', target_id: 'node_2', edge_type: 'CONTAINS_SAMPLE' },
        ],
        graph_digest: 'digest_scan_a_12345',
      }),
    );
    (mockApiModule.mock as Record<string, unknown>).fetchGraphExport = fetchGraphExportMock;

    let capturedState: ReturnType<typeof useInvestigation> | null = null;

    await act(async () => {
      render(
        <InvestigationProvider>
          <StoreInspector onRender={s => { capturedState = s; }} />
        </InvestigationProvider>,
      );
    });

    // 1. Simulate starting Scan A by uploading a dataset
    const file = new File(['pixel data'], 'dataset_a.jpg', { type: 'image/jpeg' });
    await act(async () => {
      await capturedState!.updateArtifactWithFile('art-dataset', file);
    });

    await waitFor(() => {
      expect(capturedState!.currentScanId).toBe('scan-mock-001');
    });

    // 2. Load graph for Scan A
    await act(async () => {
      await capturedState!.loadEvidenceGraph();
    });

    // Assert fetchGraphExport was called with the scan's batch_id
    expect(fetchGraphExportMock).toHaveBeenCalledWith('batch-mock-001');

    // Assert graph for Scan A is loaded with 5 nodes
    expect(capturedState!.graphNodes).toHaveLength(5);
    expect(capturedState!.graphDigest).toBe('digest_scan_a_12345');

    // 3. Prepare a deferred slow response for Scan A that hangs in flight
    let slowResolve: (val: any) => void;
    const slowPromise = new Promise(resolve => {
      slowResolve = resolve;
    });

    (mockApiModule.mock as Record<string, unknown>).fetchGraphExport = vi.fn(() => slowPromise);

    // Trigger slow in-flight fetch for Scan A
    let inflightLoad: Promise<void>;
    act(() => {
      inflightLoad = capturedState!.loadEvidenceGraph();
    });

    // 4. Operator clicks "New Investigation" (resetInvestigation)
    act(() => {
      capturedState!.resetInvestigation();
    });

    // Assert graphNodes is empty immediately upon reset
    expect(capturedState!.graphNodes).toHaveLength(0);
    expect(capturedState!.graphEdges).toHaveLength(0);
    expect(capturedState!.graphDigest).toBe('');

    // 5. Simulate the slow response from Scan A arriving AFTER the reset
    await act(async () => {
      slowResolve!({
        nodes: scanANodes,
        edges: [
          { source_id: 'node_1', target_id: 'node_2', edge_type: 'CONTAINS_SAMPLE' },
        ],
        graph_digest: 'digest_scan_a_12345',
      });
      await inflightLoad!;
    });

    // Assert the late response was DROPPED — graph remains empty
    expect(capturedState!.graphNodes).toHaveLength(0);
    expect(capturedState!.graphEdges).toHaveLength(0);
    expect(capturedState!.graphDigest).toBe('');
  });
});
