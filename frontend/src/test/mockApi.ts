/**
 * Phase 8 frontend test helpers.
 * Provides a controllable mock for apiService so component tests can verify
 * that the UI renders exactly what the backend returns — never fabricated data.
 */
import type {
  ScanSession,
  LedgerVerification,
  LedgerEventRecord,
  BackendGraphExport,
  SystemHealthOverview,
} from '../services/api';

/** A vitest-compatible assertion helper. */
export interface MockCall {
  args: unknown[];
  result: unknown;
}

/**
 * Factory that returns a mock ApiService object suitable for injection into
 * the InvestigationProvider. Each method is tracked so tests can assert
 * calls and override return values.
 *
 * Parameters are typed as `unknown[]` in the tracker to avoid TypeScript
 * assignability issues between the typed method signatures and the generic
 * tracker wrapper. The returned `mock` object preserves the real signatures.
 */
export function createMockApiService() {
  const calls: Record<string, MockCall[]> = {};

  function track<T extends (...args: any[]) => unknown>(
    methodName: string,
    fn: T,
  ): T {
    return ((...args: unknown[]) => {
      const call: MockCall = { args, result: undefined };
      calls[methodName] ??= [];
      calls[methodName].push(call);
      const result = (fn as (...a: unknown[]) => unknown)(...args);
      call.result = result;
      return result;
    }) as unknown as T;
  }

  const mock = {
    // ── Upload + Scan ──
    uploadAndScanDataset: track('uploadAndScanDataset', (_file: File) =>
      Promise.resolve<ScanSession>({
        scan_id: 'scan-mock-001',
        batch_id: 'batch-mock-001',
        created_at: '2026-01-01T00:00:00Z',
        status: 'IN_PROGRESS',
        stage: 'INGESTION',
        progress: 0,
        input_artifacts: [],
        findings: [],
        assessment: null,
        errors: [],
        warnings: [],
        stage_results: {},
      }),
    ),

    uploadModel: track('uploadModel', (_file: File) =>
      Promise.resolve({
        model_id: 'model-mock-001',
        artifact_hash: 'a'.repeat(64),
        name: 'mock_model',
        version: '1.0',
        identity_digest: 'b'.repeat(64),
      }),
    ),

    fetchModels: track('fetchModels', () => Promise.resolve([])),

    getScanSession: track('getScanSession', (_scanId: string) =>
      Promise.resolve<ScanSession>({
        scan_id: 'scan-mock-001',
        batch_id: 'batch-mock-001',
        created_at: '2026-01-01T00:00:00Z',
        status: 'COMPLETED',
        stage: 'COMPLETED',
        progress: 1,
        input_artifacts: [],
        findings: [],
        assessment: null,
        errors: [],
        warnings: [],
        stage_results: {},
      }),
    ),

    quarantineDatasetImage: track(
      'quarantineDatasetImage',
      (_batch: string, _sample: string) =>
        Promise.resolve({
          sample_id: 'mock',
          file_name: '',
          sha256_hash: '',
          result: 'POISONED / ALTERED' as const,
          integrity_status: 'FAIL' as const,
          trust_status: 'REVOKED' as const,
          anomaly_score: null,
          evidence: [],
          action: 'QUARANTINE',
          preview_data_url: null,
          quarantined: true,
        }),
    ),

    // ── Ledger ──
    verifyLedger: track('verifyLedger', () =>
      Promise.resolve<LedgerVerification>({
        valid: true,
        events_checked: 10,
        last_verified_sequence: 10,
        first_invalid_sequence: null,
        failure_reason: null,
      }),
    ),

    fetchLedgerEvents: track('fetchLedgerEvents', () =>
      Promise.resolve<LedgerEventRecord[]>([]),
    ),

    recordAnalystDecision: track(
      'recordAnalystDecision',
      (entityId: string, _decision: string, actor: string, opts: Record<string, unknown> = {}) =>
        Promise.resolve<LedgerEventRecord>({
          sequence: 1,
          timestamp: '2026-01-01T00:00:00Z',
          event_type: 'analyst_decision',
          actor,
          scan_id: typeof opts['scanId'] === 'string' ? opts['scanId'] : null,
          entity_id: entityId,
          payload_hash: '0000',
          previous_hash: '0000',
          current_hash: '0000',
          signature: 'mock-signature',
        }),
    ),

    // ── Graph ──
    fetchGraphExport: track('fetchGraphExport', (_batchId?: string) =>
      Promise.resolve<BackendGraphExport>({
        nodes: [
          {
            id: 'n1',
            node_type: 'DATASET_BATCH',
            label: 'batch-001',
            properties: { status: 'warning' },
          },
        ],
        edges: [],
        graph_digest: 'deadbeef',
      }),
    ),

    traceEntityLineage: track('traceEntityLineage', () => Promise.resolve(null)),

    // ── Dashboard ──
    isBackendAvailable: track('isBackendAvailable', () => Promise.resolve(true)),

    fetchOverview: track('fetchOverview', () =>
      Promise.resolve<SystemHealthOverview>({
        total_datasets: 5,
        total_models: 3,
        total_inferences: 1024,
        total_reports: 7,
        quarantined_assets: 1,
        under_review_assets: 2,
        accepted_assets: 2,
        active_threats_count: 0,
        chain_head_hash: 'abc123',
        system_integrity_status: 'OPERATIONAL',
      }),
    ),

    fetchDashboardTimeline: track('fetchDashboardTimeline', () => Promise.resolve([])),
    fetchContributors: track('fetchContributors', () => Promise.resolve([])),

    // ── Fusion / Reports ──
    runFusionEvaluate: track('runFusionEvaluate', () => Promise.resolve(null)),
    getFusedAssessment: track('getFusedAssessment', () => Promise.resolve(null)),
    generateReport: track('generateReport', () => Promise.resolve(null)),

    // ── Crypto ──
    auditCryptographicChain: track('auditCryptographicChain', () => Promise.resolve(null)),
    fetchOfflineReadiness: track('fetchOfflineReadiness', () => Promise.resolve(null)),
    fetchBenchmarks: track('fetchBenchmarks', () => Promise.resolve(null)),
    fetchInferenceChain: track('fetchInferenceChain', () => Promise.resolve(null)),
  };

  return { mock, calls };
}

/** Assert a tracked method was called at least once. */
export function expectCalled(calls: Record<string, MockCall[]>, method: string) {
  const arr = calls[method];
  if (!arr || arr.length === 0) {
    throw new Error(`Expected ${method} to be called, but it was not.`);
  }
  return arr;
}
