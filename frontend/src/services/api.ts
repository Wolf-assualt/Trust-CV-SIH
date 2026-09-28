/**
 * TRUST-CV API Service Adapter
 * Bridges frontend investigation state with FastAPI backend /api/v1 endpoints,
 * with fallback to local air-gapped deterministic simulation.
 */

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  timestamp?: string;
}

// ── Backend schema types (subset needed by frontend) ─────────────────────────

export interface SystemHealthOverview {
  total_datasets: number;
  total_models: number;
  total_inferences: number;
  total_reports: number;
  quarantined_assets: number;
  under_review_assets: number;
  accepted_assets: number;
  active_threats_count: number;
  chain_head_hash: string;
  system_integrity_status: string; // "OPERATIONAL" | "ELEVATED_RISK" | "CRITICAL_ALERT"
}

export interface BackendGraphNode {
  id: string;
  node_type: string;
  label: string;
  properties: Record<string, any>;
}

export interface BackendGraphEdge {
  source_id: string;
  target_id: string;
  edge_type: string;
  metadata: Record<string, any>;
}

export interface BackendGraphExport {
  nodes: BackendGraphNode[];
  edges: BackendGraphEdge[];
  graph_digest: string;
}

export interface ActivityTimelineItem {
  event_id: string;
  timestamp: string;
  event_type: string;
  severity: string;
  entity_id: string;
  description: string;
}

export interface ContributorLeaderboardItem {
  contributor_id: string;
  name: string;
  risk_score: number;
  status: string;
  total_batches: number;
  total_samples: number;
  flagged_findings: number;
}

export interface FusedAssessment {
  assessment_id: string;
  target_entity_id: string;
  risk_score: number;
  confidence_score: number;
  verdict: string;
  coverage: {
    sources_checked: string[];
    coverage_ratio: number;
    missing_sources: string[];
  };
  correlated_findings: string[];
  raw_evidence: any[];
  assessment_digest: string;
  created_at: string;
}

export interface AssuranceReport {
  report_id: string;
  target_asset_id: string;
  overall_verdict: string;
  trust_score: number;
  generated_at: string;
  assessment_digest: string;
}

export interface InferenceChainState {
  chain_head_hash: string;
  chain_length: number;
  genesis_hash: string;
  records: any[];
}

export interface IntegrityFinding {
  finding_id: string;
  check_type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  sample_ids: string[];
  description: string;
  metric_score: number;
  details: Record<string, any>;
}

export interface DatasetIntegrityReport {
  batch_id: string;
  total_samples_analyzed: number;
  findings_count: number;
  findings: IntegrityFinding[];
  overall_health_score: number;
  recommendation: 'ACCEPTED' | 'UNDER_REVIEW' | 'QUARANTINED';
  report_digest: string;
  image_results: ImageAssessment[];
  audit_events: AuditEvent[];
  timestamp: string;
}

export interface ImageAssessment {
  sample_id: string;
  file_name: string;
  sha256_hash: string;
  result: 'REAL / CLEAN' | 'POISONED / ALTERED' | 'SUSPICIOUS';
  integrity_status: 'PASS' | 'FAIL' | 'REVIEW REQUIRED';
  trust_status: 'VERIFIED' | 'UNTRUSTED' | 'REVOKED';
  anomaly_score: number | null;
  evidence: string[];
  action: string;
  preview_data_url: string | null;
  quarantined: boolean;
  batch_id?: string;
}

export interface AuditEvent {
  timestamp: string;
  artifact_id: string;
  sha256_hash: string;
  detection_result: string;
  integrity_status: string;
  reason: string;
  action: string;
}

export interface ScanSession {
  scan_id: string;
  batch_id?: string | null;
  created_at: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  stage: string;
  progress: number;
  input_artifacts: string[];
  findings: any[];
  assessment: any;
  errors: string[];
  warnings: string[];
  stage_results?: Record<string, { status: string; error_code?: string; explanation?: string }>;
}

export interface LedgerVerification {
  valid: boolean;
  events_checked: number;
  last_verified_sequence: number;
  first_invalid_sequence: number | null;
  failure_reason: string | null;
  likely_cause?: 'KEY_ROTATION' | 'TAMPER' | null;
}

export interface LedgerEventRecord {
  sequence: number;
  timestamp: string | null;
  event_type: string;
  actor: string;
  scan_id: string | null;
  entity_id: string;
  payload_hash: string;
  previous_hash: string;
  current_hash: string;
  signature: string | null;
}

export type AnalystDecision = 'ACCEPT' | 'REVIEW' | 'QUARANTINE';

// ── API Service ───────────────────────────────────────────────────────────────

class ApiService {
  private baseUrl = '/api/v1';

  async uploadAndScanDataset(
    file: File,
    baselineFile?: File,
    baselineId?: string,
    modelId?: string,
  ): Promise<ScanSession> {
    const body = new FormData();
    body.append('file', file);
    body.append('dataset_name', file.name);
    if (baselineFile) {
      body.append('baseline_file', baselineFile);
    }
    if (baselineId) {
      body.append('baseline_id', baselineId);
    }
    if (modelId) {
      body.append('model_id', modelId);
    }
    const response = await fetch(`${this.baseUrl}/datasets/upload`, { method: 'POST', body });
    const envelope: ApiResponse<ScanSession> = await response.json();
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error || `Upload failed with HTTP ${response.status}`);
    }
    return envelope.data;
  }

  async fetchModels(): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`);
      const envelope = await response.json();
      return envelope.data || [];
    } catch {
      return [];
    }
  }

  async uploadBaseline(
    file: File,
    opts: { baselineId?: string; name?: string } = {},
  ): Promise<any> {
    const body = new FormData();
    body.append('file', file);
    if (opts.baselineId) body.append('baseline_id', opts.baselineId);
    if (opts.name) body.append('name', opts.name);
    const response = await fetch(`${this.baseUrl}/drift/baselines/upload`, { method: 'POST', body });
    const envelope = await response.json();
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error || `Baseline upload failed with HTTP ${response.status}`);
    }
    return envelope.data;
  }

  /**
   * Upload a model binary file to the backend registry.
   * Returns a ModelIdentityManifest with real artifact_hash, identity_digest,
   * and ECDSA signature — no security analysis is performed client-side.
   */
  async uploadModel(
    file: File,
    opts: { name?: string; version?: string; format?: string; isReference?: boolean } = {},
  ): Promise<{ model_id: string; artifact_hash: string; name: string; version: string; identity_digest: string }> {
    const body = new FormData();
    body.append('file', file);
    body.append('name', opts.name ?? file.name.replace(/\.[^.]+$/, ''));
    body.append('version', opts.version ?? '1.0');
    body.append('format', opts.format ?? this._inferModelFormat(file.name));
    body.append('is_reference', String(opts.isReference ?? false));
    const response = await fetch(`${this.baseUrl}/models/upload`, { method: 'POST', body });
    const envelope: ApiResponse<{ model_id: string; artifact_hash: string; name: string; version: string; identity_digest: string }> = await response.json();
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error || `Model upload failed with HTTP ${response.status}`);
    }
    return envelope.data;
  }

  private _inferModelFormat(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'onnx') return 'ONNX';
    if (ext === 'pt' || ext === 'pth') return 'PYTORCH_WEIGHTS';
    if (ext === 'bin') return 'GENERIC_BINARY';
    return 'ONNX';
  }

  async getScanSession(scanId: string): Promise<ScanSession> {
    const response = await fetch(`${this.baseUrl}/scan/${encodeURIComponent(scanId)}`);
    const envelope: ApiResponse<ScanSession> = await response.json();
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error || `Failed to fetch scan session`);
    }
    return envelope.data;
  }

  async quarantineDatasetImage(batchId: string, sampleId: string): Promise<ImageAssessment> {
    const response = await fetch(`${this.baseUrl}/datasets/quarantine/${encodeURIComponent(batchId)}/${sampleId.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST' });
    const envelope: ApiResponse<ImageAssessment> = await response.json();
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error || `Quarantine failed with HTTP ${response.status}`);
    }
    return envelope.data;
  }

  // ── Tamper-Evident Assurance Ledger (authoritative) ──────────────────────────

  /**
   * Verify the backend ledger hash chain.
   * Throws when the backend is unreachable so callers render UNAVAILABLE rather
   * than inferring validity.
   */
  async verifyLedger(): Promise<LedgerVerification> {
    const response = await fetch(`${this.baseUrl}/ledger/verify`);
    const envelope: ApiResponse<LedgerVerification> = await response.json();
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error || `Ledger verification failed with HTTP ${response.status}`);
    }
    return envelope.data;
  }

  /** List ledger events (optionally limited / scoped to a scan or entity). */
  async fetchLedgerEvents(opts: { limit?: number; scanId?: string; entityId?: string } = {}): Promise<LedgerEventRecord[]> {
    let path = '/ledger/events';
    if (opts.scanId) path = `/ledger/events/scan/${encodeURIComponent(opts.scanId)}`;
    else if (opts.entityId) path = `/ledger/events/entity/${encodeURIComponent(opts.entityId)}`;
    else if (typeof opts.limit === 'number') path = `/ledger/events?limit=${opts.limit}`;

    const response = await fetch(`${this.baseUrl}${path}`);
    const envelope: ApiResponse<LedgerEventRecord[]> = await response.json();
    if (!response.ok) {
      throw new Error(envelope.error || `Ledger event listing failed with HTTP ${response.status}`);
    }
    return envelope.data ?? [];
  }

  /**
   * Record an explicit analyst decision in the backend ledger.
   * Returns the persisted, signed ledger event. Throws when the backend cannot
   * persist it — the caller must NOT treat an unconfirmed decision as recorded.
   */
  async recordAnalystDecision(
    entityId: string,
    decision: AnalystDecision,
    actor: string,
    opts: { scanId?: string; reason?: string } = {},
  ): Promise<LedgerEventRecord> {
    const qs = new URLSearchParams();
    qs.set('entity_id', entityId);
    qs.set('decision', decision);
    qs.set('actor', actor);
    if (opts.scanId) qs.set('scan_id', opts.scanId);
    if (opts.reason) qs.set('reason', opts.reason);

    const response = await fetch(`${this.baseUrl}/ledger/decision?${qs.toString()}`, { method: 'POST' });
    const envelope: ApiResponse<LedgerEventRecord> = await response.json();
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error || `Analyst decision was not recorded (HTTP ${response.status})`);
    }
    return envelope.data;
  }

  // ── Connectivity ────────────────────────────────────────────────────────────

  /** Probe the backend. Returns true if the FastAPI server is reachable. */
  async isBackendAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/system/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Dashboard ───────────────────────────────────────────────────────────────

  /** Retrieve real-time system health metrics and asset inventory. */
  async fetchOverview(): Promise<SystemHealthOverview | null> {
    try {
      const res = await fetch(`${this.baseUrl}/dashboard/overview`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope: ApiResponse<SystemHealthOverview> = await res.json();
      return envelope.data ?? null;
    } catch (e) {
      console.warn('[TRUST-CV Service] Dashboard overview using air-gapped cache:', e);
      return null;
    }
  }

  /** Retrieve chronologically ordered activity events. */
  async fetchDashboardTimeline(limit = 20): Promise<ActivityTimelineItem[]> {
    try {
      const res = await fetch(`${this.baseUrl}/dashboard/timeline?limit=${limit}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope: ApiResponse<ActivityTimelineItem[]> = await res.json();
      return envelope.data ?? [];
    } catch (e) {
      console.warn('[TRUST-CV Service] Timeline using air-gapped cache:', e);
      return [];
    }
  }

  /** Retrieve dynamic contributor risk leaderboard. */
  async fetchContributors(): Promise<ContributorLeaderboardItem[]> {
    try {
      const res = await fetch(`${this.baseUrl}/dashboard/contributors`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope: ApiResponse<ContributorLeaderboardItem[]> = await res.json();
      return envelope.data ?? [];
    } catch (e) {
      console.warn('[TRUST-CV Service] Contributors using air-gapped cache:', e);
      return [];
    }
  }

  // ── Evidence Graph ──────────────────────────────────────────────────────────

  /** Export the directed property graph from the backend (optionally scoped to batchId). */
  async fetchGraphExport(batchId?: string): Promise<BackendGraphExport | null> {
    try {
      const url = batchId
        ? `${this.baseUrl}/graph/export?batch_id=${encodeURIComponent(batchId)}`
        : `${this.baseUrl}/graph/export`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope: ApiResponse<BackendGraphExport> = await res.json();
      return envelope.data ?? null;
    } catch (e) {
      console.warn('[TRUST-CV Service] Graph export error:', e);
      return null;
    }
  }

  /** Trace upstream/downstream lineage for an entity. */
  async traceEntityLineage(entityId: string): Promise<any> {
    try {
      const res = await fetch(`${this.baseUrl}/graph/trace/${encodeURIComponent(entityId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope = await res.json();
      return envelope.data !== undefined ? envelope.data : envelope;
    } catch (e) {
      console.warn('[TRUST-CV Service] Lineage trace using air-gapped cache:', e);
      return null;
    }
  }

  // ── Hardening & Audit ───────────────────────────────────────────────────────

  /**
   * Audit the sequential hash chain from genesis to current tip.
   *
   * Returns null when the backend is unreachable. A null result MUST be rendered
   * as UNAVAILABLE — the client never asserts an affirmative cryptographic
   * result it did not receive from the backend.
   */
  async auditCryptographicChain(): Promise<any> {
    try {
      const res = await fetch(`${this.baseUrl}/hardening/audit/chain`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope = await res.json();
      return envelope.data ?? null;
    } catch (e) {
      console.warn('[TRUST-CV Service] Chain audit UNAVAILABLE (backend unreachable):', e);
      return null;
    }
  }

  /** Verify system operates in air-gapped mode. */
  async fetchOfflineReadiness(): Promise<any> {
    try {
      const res = await fetch(`${this.baseUrl}/hardening/audit/offline`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope = await res.json();
      return envelope.data ?? null;
    } catch (e) {
      console.warn('[TRUST-CV Service] Offline readiness using local status:', e);
      return null;
    }
  }

  /** Execute on-demand cryptographic performance benchmarks. */
  async fetchBenchmarks(): Promise<any> {
    try {
      const res = await fetch(`${this.baseUrl}/hardening/benchmark`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope = await res.json();
      return envelope.data ?? null;
    } catch (e) {
      console.warn('[TRUST-CV Service] Benchmarks unavailable:', e);
      return null;
    }
  }

  // ── Inference DNA ───────────────────────────────────────────────────────────

  /** Retrieve the current audit hash chain tip and sequence history. */
  async fetchInferenceChain(): Promise<InferenceChainState | null> {
    try {
      const res = await fetch(`${this.baseUrl}/inference/chain`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope: ApiResponse<InferenceChainState> = await res.json();
      return envelope.data ?? null;
    } catch (e) {
      console.warn('[TRUST-CV Service] Inference chain using air-gapped cache:', e);
      return null;
    }
  }

  // ── Evidence Fusion ─────────────────────────────────────────────────────────

  /**
   * Fuse multi-source verification evidence and calculate holistic threat assessment.
   * Called after a scan completes to persist results to the backend.
   */
  async runFusionEvaluate(
    targetEntityId: string,
    evidenceItems: any[] = [],
  ): Promise<FusedAssessment | null> {
    try {
      const res = await fetch(`${this.baseUrl}/fusion/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_entity_id: targetEntityId,
          evidence_items: evidenceItems,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope: ApiResponse<FusedAssessment> = await res.json();
      return envelope.data ?? null;
    } catch (e) {
      console.warn('[TRUST-CV Service] Fusion evaluate failed (air-gapped mode):', e);
      return null;
    }
  }

  /** Retrieve an existing fused assessment. */
  async getFusedAssessment(assessmentId: string): Promise<FusedAssessment | null> {
    try {
      const res = await fetch(`${this.baseUrl}/fusion/assessment/${encodeURIComponent(assessmentId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope: ApiResponse<FusedAssessment> = await res.json();
      return envelope.data ?? null;
    } catch (e) {
      console.warn('[TRUST-CV Service] Get assessment failed:', e);
      return null;
    }
  }

  // ── Assurance Reports ───────────────────────────────────────────────────────

  /**
   * Generate and cryptographically seal an assurance report from a fused assessment.
   * Called in parallel with the local JSON download when exporting.
   */
  async generateReport(
    assessmentId: string,
    targetAssetId: string,
    targetAssetType: string = 'DATASET',
  ): Promise<AssuranceReport | null> {
    try {
      const res = await fetch(`${this.baseUrl}/reports/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessment_id: assessmentId,
          target_asset_id: targetAssetId,
          target_asset_type: targetAssetType,
          include_limitations: true,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const envelope: ApiResponse<AssuranceReport> = await res.json();
      return envelope.data ?? null;
    } catch (e) {
      console.warn('[TRUST-CV Service] Report generation failed (air-gapped mode):', e);
      return null;
    }
  }
}

export const apiService = new ApiService();
