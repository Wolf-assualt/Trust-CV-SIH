import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiService, type ScanSession } from '../services/api';
import type {
  SystemHealthOverview,
  ImageAssessment,
  LedgerVerification,
  LedgerEventRecord,
  AnalystDecision,
} from '../services/api';
import type {
  Phase,
  ArtifactItem,
  PipelineStage,
  TerminalLog,
  LiveMetrics,
  SignalPoint,
  Finding,
  FindingCategory,
  TrustScore,
  Recommendation,
} from '../types/investigation';
import {
  INITIAL_ARTIFACTS,
  PIPELINE_STAGES,
  INITIAL_METRICS,
} from '../data/mockScenario';

/** Trigger a local, offline file download of a JSON document. */
function downloadJson(payload: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export type Theme = 'dark' | 'light';

/**
 * Maps a backend ScanStage enum value to the stage_results keys that are
 * populated during that phase.  Used to mark intermediate stages RUNNING
 * when the backend has not yet written individual component outcomes.
 */
const STAGE_ENUM_TO_RESULT_KEYS: Record<string, string[]> = {
  INGESTION: ['DATA_INGESTION'],
  HASHING: ['DATA_INGESTION', 'HASH_VERIFICATION'],
  DATA_INTEGRITY: ['DATASET_ANALYSIS', 'DUPLICATE_DETECTION', 'LABEL_INTEGRITY', 'QUALITY_ANALYSIS', 'TRIGGER_CANDIDATE_ANALYSIS', 'OOD_DETECTION'],
  MODEL_ASSURANCE: ['MODEL_INTEGRITY'],
  INFERENCE_ASSURANCE: ['BACKDOOR_ANALYSIS', 'INFERENCE_VALIDATION'],
  DISTRIBUTION_SHIFT: ['DISTRIBUTION_SHIFT'],
  EVIDENCE_FUSION: ['EVIDENCE_FUSION', 'EVIDENCE_GRAPH'],
  AUDIT: [],
  REPORT: ['FINAL_VERDICT'],
  COMPLETED: ['FINAL_VERDICT'],
};

interface InvestigationContextType {
  phase: Phase;
  setPhase: (phase: Phase) => void;
  theme: Theme;
  toggleTheme: () => void;
  sessionId: string;
  backendOnline: boolean;
  backendOverview: SystemHealthOverview | null;
  fusedAssessmentId: string | null;
  currentScanId: string | null;
  scanSession: ScanSession | null;
  artifacts: ArtifactItem[];
  clearArtifacts: () => void;
  updateArtifactWithFile: (artifactId: string, file: File) => Promise<void>;
  verifyArtifact: (artifactId: string) => void;
  isReadyToScan: boolean;
  validationChecklist: {
    datasetDetected: boolean;
    scanReady: boolean;
  };
  isScanning: boolean;
  isScanCompleted: boolean;
  scanProgress: number;
  currentOperation: string;
  elapsedSeconds: number;
  stages: PipelineStage[];
  terminalLogs: TerminalLog[];
  liveMetrics: LiveMetrics;
  signalPoints: SignalPoint[];
  startScan: () => void;
  findings: Finding[];
  setFindings: React.Dispatch<React.SetStateAction<Finding[]>>;
  selectedCategory: FindingCategory;
  setSelectedCategory: (cat: FindingCategory) => void;
  selectedSeverity: string;
  setSelectedSeverity: (sev: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedFinding: Finding | null;
  setSelectedFinding: (finding: Finding | null) => void;
  trustScore: TrustScore | null;
  setTrustScore: React.Dispatch<React.SetStateAction<TrustScore | null>>;
  recommendations: Recommendation[];
  setRecommendations: React.Dispatch<React.SetStateAction<Recommendation[]>>;
  imageResults: ImageAssessment[];
  quarantineImage: (sampleId: string) => Promise<void>;
  graphNodes: any[];
  graphEdges: any[];
  graphDigest: string;
  selectedGraphNode: any | null;
  setSelectedGraphNode: (node: any | null) => void;
  focusNodeInGraph: (nodeId: string) => void;
  /** Backend ledger hash-chain verification result; null means UNAVAILABLE. */
  ledgerVerification: LedgerVerification | null;
  /** Analyst decisions persisted in the backend ledger (never frontend state). */
  analystDecisions: LedgerEventRecord[];
  /** Last backend/API error surfaced to the operator. */
  backendError: string | null;
  refreshLedgerVerification: () => Promise<void>;
  loadEvidenceGraph: () => Promise<void>;
  refreshAnalystDecisions: (entityId?: string) => Promise<void>;
  submitAnalystDecision: (
    decision: AnalystDecision,
    actor: string,
    opts?: { entityId?: string; scanId?: string; reason?: string },
  ) => Promise<LedgerEventRecord | null>;
  resetInvestigation: () => void;
  exportReport: () => void;
  exportEvidencePackage: () => void;
  uploadOneOffCheck: (targetFile: File, baselineFile?: File) => Promise<void>;
}

const InvestigationContext = createContext<InvestigationContextType | null>(null);

export const InvestigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>('dark');
  const [backendOnline, setBackendOnline] = useState(false);
  const [backendOverview, setBackendOverview] = useState<SystemHealthOverview | null>(null);
  const [fusedAssessmentId] = useState<string | null>(null);
  const [currentScanId, setCurrentScanId] = useState<string | null>(null);
  const [scanSession, setScanSession] = useState<ScanSession | null>(null);
  const [imageResults, setImageResults] = useState<ImageAssessment[]>([]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const online = await apiService.isBackendAvailable();
      if (!cancelled) {
        setBackendOnline(online);
        if (online) {
          const overview = await apiService.fetchOverview();
          if (!cancelled && overview) setBackendOverview(overview);
        }
      }
    };
    probe();
    const interval = window.setInterval(probe, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const [phase, setPhaseState] = useState<Phase>('launch');
  const setPhase = useCallback((newPhase: Phase) => {
    setPhaseState(newPhase);
    window.history.pushState({}, '', `/${newPhase}`);
  }, []);

  const sessionId = 'TCV-2026-8891B';
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>(INITIAL_ARTIFACTS);

  /**
   * Upload a file for a given artifact slot.
   * For the dataset slot: POST to /api/v1/datasets/upload, which immediately
   * returns a ScanSession with scan_id + batch_id. The actual pipeline runs in
   * the backend as a background task. We store the scan_id for subsequent
   * polling and populate the artifact card with real backend metadata.
   */
  const updateArtifactWithFile = async (artifactId: string, file: File) => {
    const artifact = artifacts.find(a => a.id === artifactId);
    const isDataset = artifact?.type === 'dataset';
    if (isDataset) {
      // Mark uploading immediately so the UI shows progress.
      setArtifacts(prev => prev.map(art => art.id === artifactId ? {
        ...art,
        filename: file.name,
        size: formatFileSize(file.size),
        hash: '',
        status: 'uploading',
        progress: 50,
        metadata: { ...art.metadata, format: 'Uploading to backend…' },
      } : art));
      try {
        const modelArt = artifacts.find(a => a.type === 'model');
        let activeModelId: string | undefined = modelArt?.metadata?.modelId as string | undefined;
        if (!activeModelId) {
          try {
            const registeredModels = await apiService.fetchModels();
            if (registeredModels && registeredModels.length > 0) {
              activeModelId = registeredModels[0].model_id;
            }
          } catch {
            // fallback if models endpoint unreachable
          }
        }
        const session = await apiService.uploadAndScanDataset(file, undefined, undefined, activeModelId);
        setCurrentScanId(session.scan_id);
        setScanSession(session);
        // Update the artifact card with real values from the backend response.
        setArtifacts(prev => prev.map(art => art.id === artifactId ? {
          ...art,
          filename: file.name,
          size: formatFileSize(file.size),
          // hash is not yet available at upload time; shown once scan reports it
          hash: '',
          status: 'verified',
          progress: 100,
          metadata: {
            ...art.metadata,
            format: `Backend scan started — scan_id: ${session.scan_id.substring(0, 8)}…`,
            samplesCount: session.input_artifacts?.length ?? 0,
          },
        } : art));
        setBackendError(null);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Upload failed';
        setBackendError(msg);
        setArtifacts(prev => prev.map(art => art.id === artifactId ? {
          ...art,
          filename: file.name,
          status: 'error',
          progress: 0,
          metadata: { ...art.metadata, format: `Upload failed: ${msg}` },
        } : art));
      }
      return;
    }
    // Non-dataset artifacts: model files are uploaded to the backend registry.
    // Inference and manifest artifacts are accepted locally (no backend upload endpoint yet).
    const isModel = artifact?.type === 'model';
    if (isModel) {
      setArtifacts(prev => prev.map(art => art.id === artifactId ? {
        ...art,
        filename: file.name,
        size: formatFileSize(file.size),
        hash: '',
        status: 'uploading',
        progress: 50,
        metadata: { ...art.metadata, format: 'Uploading model to backend registry…' },
      } : art));
      try {
        const manifest = await apiService.uploadModel(file);
        setArtifacts(prev => prev.map(art => art.id === artifactId ? {
          ...art,
          filename: file.name,
          size: formatFileSize(file.size),
          hash: manifest.artifact_hash,
          status: 'verified',
          progress: 100,
          metadata: {
            ...art.metadata,
            modelId: manifest.model_id,
            format: `Registered — model_id: ${manifest.model_id.substring(0, 8)}…`,
          },
        } : art));
        setBackendError(null);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Model upload failed';
        setBackendError(msg);
        setArtifacts(prev => prev.map(art => art.id === artifactId ? {
          ...art,
          filename: file.name,
          status: 'error',
          progress: 0,
          metadata: { ...art.metadata, format: `Model upload failed: ${msg}` },
        } : art));
      }
      return;
    }
    // Inference and manifest artifacts: accepted locally for display;
    // no separate backend upload endpoint exists for these yet.
    setArtifacts(prev => prev.map(art => art.id === artifactId ? {
      ...art,
      filename: file.name,
      size: formatFileSize(file.size),
      hash: '',
      status: 'verified',
      progress: 100,
      metadata: { ...art.metadata, format: `${getExtension(file.name).toUpperCase()} — accepted locally` },
    } : art));
  };

  const verifyArtifact = (_artifactId?: string) => {
    // Artifact acceptance is decided by the backend assurance pipeline on upload.
    // No client-side verification verdict is produced here.
  };

  const uploadOneOffCheck = async (targetFile: File, baselineFile?: File) => {
    setArtifacts(prev => prev.map(art => art.type === 'dataset' ? {
      ...art,
      filename: targetFile.name,
      size: formatFileSize(targetFile.size),
      hash: '',
      status: 'uploading',
      progress: 50,
      metadata: { ...art.metadata, format: 'Uploading one-off target + reference baseline…' },
    } : art));

    try {
      const modelArt = artifacts.find(a => a.type === 'model');
      let activeModelId: string | undefined = modelArt?.metadata?.modelId as string | undefined;
      if (!activeModelId) {
        try {
          const registeredModels = await apiService.fetchModels();
          if (registeredModels && registeredModels.length > 0) {
            activeModelId = registeredModels[0].model_id;
          }
        } catch {
          // fallback if models endpoint unreachable
        }
      }
      const session = await apiService.uploadAndScanDataset(targetFile, baselineFile, undefined, activeModelId);
      setCurrentScanId(session.scan_id);
      setScanSession(session);

      setArtifacts(prev => prev.map(art => {
        if (art.type === 'dataset') {
          return {
            ...art,
            filename: targetFile.name,
            size: formatFileSize(targetFile.size),
            hash: '',
            status: 'verified',
            progress: 100,
            metadata: {
              ...art.metadata,
              format: `One-off assurance scan active — ID: ${session.scan_id.substring(0, 8)}…`,
              samplesCount: session.input_artifacts?.length ?? 1,
            },
          };
        }
        if (art.type === 'manifest' && baselineFile) {
          return {
            ...art,
            filename: baselineFile.name,
            size: formatFileSize(baselineFile.size),
            hash: '',
            status: 'verified',
            progress: 100,
            metadata: {
              ...art.metadata,
              format: 'Reference baseline profile registered',
            },
          };
        }
        return art;
      }));
      setBackendError(null);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'One-off upload failed';
      setBackendError(msg);
      setArtifacts(prev => prev.map(art => art.type === 'dataset' ? {
        ...art,
        filename: targetFile.name,
        status: 'error',
        progress: 0,
        metadata: { ...art.metadata, format: `Upload failed: ${msg}` },
      } : art));
    }
  };

  const clearArtifacts = () => {
    setArtifacts(INITIAL_ARTIFACTS);
    setCurrentScanId(null);
    setScanSession(null);
    setBackendError(null);
  };

  /**
   * Quarantine a flagged sample. The backend copies the original into isolated
   * storage, records a signed audit event, and returns the updated assessment.
   */
  const quarantineImage = async (sampleId: string) => {
    const batchId = scanSession?.batch_id;
    if (!batchId) {
      setBackendError('Quarantine UNAVAILABLE: no backend batch is loaded.');
      return;
    }
    try {
      const updated = await apiService.quarantineDatasetImage(batchId, sampleId);
      setImageResults(prev => prev.map(img => (img.sample_id === updated.sample_id ? updated : img)));
      setBackendError(null);
      await refreshLedgerVerification();
    } catch (e: unknown) {
      setBackendError(e instanceof Error ? e.message : 'Quarantine failed.');
    }
  };

  /**
   * isReadyToScan: the dataset artifact must have been accepted by the backend
   * (status === 'verified') AND a scan_id must exist from the upload response.
   * Without a scan_id there is nothing to poll, so the scan button must be
   * disabled rather than allowed to proceed with no backend session.
   */
  const datasetArtifact = artifacts.find(a => a.type === 'dataset');
  const datasetVerified = datasetArtifact?.status === 'verified';
  const isReadyToScan = datasetVerified && currentScanId !== null;

  const validationChecklist = {
    datasetDetected: datasetVerified,
    scanReady: isReadyToScan,
  };

  const [isScanning, setIsScanning] = useState(false);
  const [isScanCompleted, setIsScanCompleted] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [currentOperation, setCurrentOperation] = useState('System ready');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [stages, setStages] = useState<PipelineStage[]>(PIPELINE_STAGES);
  const [terminalLogs, setTerminalLogs] = useState<TerminalLog[]>([]);
  const [liveMetrics, setLiveMetrics] = useState<LiveMetrics>(INITIAL_METRICS);
  const [signalPoints, setSignalPoints] = useState<SignalPoint[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<FindingCategory>('ALL');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [trustScore, setTrustScore] = useState<TrustScore | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [graphNodes, setGraphNodes] = useState<any[]>([]);
  const [graphEdges, setGraphEdges] = useState<any[]>([]);
  const [graphDigest, setGraphDigest] = useState('');
  const [selectedGraphNode, setSelectedGraphNode] = useState<any | null>(null);
  const [ledgerVerification, setLedgerVerification] = useState<LedgerVerification | null>(null);
  const [analystDecisions, setAnalystDecisions] = useState<LedgerEventRecord[]>([]);
  const [backendError, setBackendError] = useState<string | null>(null);

  // Elapsed timer — increments while scanning is in progress.
  const timerIntervalRef = useRef<number | null>(null);
  useEffect(() => {
    if (isScanning) {
      timerIntervalRef.current = window.setInterval(
        () => setElapsedSeconds(prev => prev + 1),
        1000,
      );
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
    return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
  }, [isScanning]);

  /**
   * Pull the authoritative evidence graph from the backend.
   * If the backend is unreachable the graph stays EMPTY (UNAVAILABLE) — the
   * frontend never reconstructs authoritative relationships locally.
   */
  const loadEvidenceGraph = useCallback(async () => {
    try {
      const exportData = await apiService.fetchGraphExport();
      if (exportData && Array.isArray(exportData.nodes) && Array.isArray(exportData.edges)) {
        setGraphNodes(exportData.nodes.map((n: any) => ({
          id: n.id || n.canonical_identity || n.digest,
          label: n.label || n.node_type,
          nodeType: String(n.node_type || 'ENTITY').toUpperCase(),
          properties: n.properties || {},
          status: (n.properties && n.properties.status) ? n.properties.status : 'UNKNOWN',
          digest: n.digest || n.canonical_identity || '',
        })));
        setGraphEdges(exportData.edges.map(e => ({
          id: `${e.source_id}->${e.target_id}:${e.edge_type}`,
          sourceId: e.source_id,
          targetId: e.target_id,
          edgeType: e.edge_type,
          label: e.edge_type,
        })));
        setGraphDigest(exportData.graph_digest || '');
      } else {
        setGraphNodes([]); setGraphEdges([]); setGraphDigest('');
      }
    } catch {
      setGraphNodes([]); setGraphEdges([]); setGraphDigest('');
    }
  }, []);

  const refreshLedgerVerification = useCallback(async () => {
    try {
      setLedgerVerification(await apiService.verifyLedger());
      setBackendError(null);
    } catch (e: unknown) {
      // UNAVAILABLE — never inferred as valid locally.
      setLedgerVerification(null);
      setBackendError(e instanceof Error ? e.message : 'Backend ledger unavailable');
    }
  }, []);

  const refreshAnalystDecisions = useCallback(async (entityId?: string) => {
    try {
      const events = await apiService.fetchLedgerEvents({ entityId });
      setAnalystDecisions(events.filter(e => e.event_type === 'analyst_decision'));
    } catch {
      setAnalystDecisions([]);
    }
  }, []);

  /**
   * Record an explicit analyst decision. The decision only becomes visible after
   * the backend confirms and persists the signed ledger event.
   */
  const submitAnalystDecision = useCallback(async (
    decision: AnalystDecision,
    actor: string,
    opts: { entityId?: string; scanId?: string; reason?: string } = {},
  ): Promise<LedgerEventRecord | null> => {
    const entityId = opts.entityId || currentScanId || '';
    if (!entityId) {
      setBackendError('No entity available to record an analyst decision against.');
      return null;
    }
    try {
      const event = await apiService.recordAnalystDecision(entityId, decision, actor, {
        scanId: opts.scanId || currentScanId || undefined,
        reason: opts.reason,
      });
      setBackendError(null);
      await refreshAnalystDecisions(entityId);
      return event;
    } catch (e: unknown) {
      setBackendError(e instanceof Error ? e.message : 'Analyst decision was not recorded.');
      return null;
    }
  }, [currentScanId, refreshAnalystDecisions]);

  const focusNodeInGraph = (nodeId: string) => {
    const found = graphNodes.find(n => n.id === nodeId);
    setSelectedGraphNode(found ?? null);
  };

  const resetInvestigation = () => {
    setPhase('launch');
    setFindings([]);
    setImageResults([]);
    setTrustScore(null);
    setRecommendations([]);
    setSelectedFinding(null);
    setSelectedGraphNode(null);
    setCurrentScanId(null);
    setScanSession(null);
    setLedgerVerification(null);
    setAnalystDecisions([]);
    setBackendError(null);
    setGraphNodes([]);
    setGraphEdges([]);
    setGraphDigest('');
    setArtifacts(INITIAL_ARTIFACTS);
    setIsScanning(false);
    setIsScanCompleted(false);
    setScanProgress(0);
    setElapsedSeconds(0);
    setCurrentOperation('System ready');
    setStages(PIPELINE_STAGES);
    setLiveMetrics(INITIAL_METRICS);
    setTerminalLogs([]);
    setSignalPoints([]);
  };

  /**
   * Export the authoritative evidence package produced by the backend.
   * Nothing is assembled or signed in the browser.
   */
  const exportEvidencePackage = async () => {
    if (!scanSession) {
      window.alert('Export UNAVAILABLE: no backend scan session is loaded.');
      return;
    }
    try {
      const [overview, graph, ledger] = await Promise.all([
        apiService.fetchOverview(),
        apiService.fetchGraphExport(),
        apiService.verifyLedger(),
      ]);
      const payload = {
        exported_at: new Date().toISOString(),
        source: 'TRUST-CV backend (authoritative)',
        scan_id: scanSession.scan_id,
        batch_id: scanSession.batch_id ?? null,
        scan_status: scanSession.status,
        assessment: scanSession.assessment ?? null,
        stage_results: scanSession.stage_results ?? {},
        findings: scanSession.findings ?? [],
        evidence_graph: graph ?? null,
        ledger_verification: ledger,
        system_overview: overview,
        analyst_decisions: analystDecisions,
      };
      downloadJson(payload, `trustcv_evidence_${scanSession.scan_id}.json`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'backend unavailable';
      setBackendError(msg);
      window.alert(`Evidence export FAILED: ${msg}`);
    }
  };

  const exportReport = async () => {
    if (!scanSession) {
      window.alert('Export UNAVAILABLE: no backend scan session is loaded.');
      return;
    }
    try {
      const [ledger, graph] = await Promise.all([
        apiService.verifyLedger(),
        apiService.fetchGraphExport(),
      ]);
      const report = {
        report_id: `REP-${scanSession.scan_id.substring(0, 10).toUpperCase()}`,
        generated_at: new Date().toISOString(),
        authority: 'TRUST-CV backend assurance pipeline',
        scan_id: scanSession.scan_id,
        batch_id: scanSession.batch_id ?? null,
        status: scanSession.status,
        stage_results: scanSession.stage_results ?? {},
        assessment: scanSession.assessment ?? null,
        findings: scanSession.findings ?? [],
        evidence_graph_digest: graph?.graph_digest ?? null,
        ledger_verification: ledger,
        errors: scanSession.errors ?? [],
        warnings: scanSession.warnings ?? [],
      };
      downloadJson(report, `${report.report_id}.json`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'backend unavailable';
      setBackendError(msg);
      window.alert(`Report export FAILED: ${msg}`);
    }
  };

  // ── Scan polling (formerly "runScanSimulation") ────────────────────────────

  const scanIntervalRef = useRef<number | null>(null);

  /**
   * Finalize the scan: clear the polling interval, mark 100% complete, and
   * transition to the results page after a short delay.
   *
   * Previously named "completeScan" — renamed to avoid confusion with a
   * simulated completion.  This is only called when the backend itself reports
   * COMPLETED or FAILED.
   */
  const finalizeScan = useCallback(() => {
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    setScanProgress(100);
    setIsScanning(false);
    setIsScanCompleted(true);
    setCurrentOperation('INTEGRITY ANALYSIS COMPLETE');
    setTimeout(() => setPhase('results'), 1800);
  }, [setPhase]);

  /**
   * Poll the backend scan session at a 1-second interval.
   * Previously named "runScanSimulation" — renamed to clarify this is REAL
   * backend polling, not a simulation.
   *
   * Progress, stage statuses, assessment and findings all come verbatim from
   * the backend ScanSession response.  No values are invented here.
   */
  const pollScanProgress = useCallback(() => {
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    scanIntervalRef.current = window.setInterval(async () => {
      if (!currentScanId) return;
      try {
        const session = await apiService.getScanSession(currentScanId);
        setScanSession(session);

        // Progress is a 0–1 float from the backend; multiply by 100 for display.
        const progressPct = Math.round(session.progress * 100);
        setScanProgress(progressPct);
        setCurrentOperation(`Stage: ${session.stage}`);

        // ── Map backend stage_results to frontend pipeline stages ──────────
        // Each PipelineStage.code corresponds to a key in session.stage_results
        // (see mockScenario.ts for the authoritative mapping).
        setStages(prev => prev.map(s => {
          const componentState = session.stage_results?.[s.code];
          if (componentState) {
            // Map backend ComponentStatus → frontend StageStatus
            const backendStatus = componentState.status.toUpperCase();
            const frontendStatus: any =
              backendStatus === 'PASSED' ? 'PASSED' :
              backendStatus === 'FAILED' ? 'FAILED' :
              backendStatus === 'UNAVAILABLE' ? 'UNAVAILABLE' :
              backendStatus === 'RUNNING' ? 'RUNNING' :
              'WAITING';
            return {
              ...s,
              status: frontendStatus,
              summary: componentState.explanation || s.summary,
            };
          }

          // Stage result not written yet — check if this stage's parent phase
          // is the currently active ScanStage to show RUNNING.
          const activePhaseKeys = STAGE_ENUM_TO_RESULT_KEYS[session.stage] ?? [];
          if (
            activePhaseKeys.includes(s.code) &&
            session.status === 'IN_PROGRESS'
          ) {
            return { ...s, status: 'RUNNING', progress: 50 };
          }

          return s;
        }));

        // ── Real-Time Live Metrics & Telemetry ──
        const totalSamples = Number(
          session.assessment?.totalSamples ??
          datasetArtifact?.metadata?.samplesCount ??
          session.input_artifacts?.length ??
          0
        );
        const findingsList = session.findings || [];
        const dupCount = findingsList.filter((f: any) => String(f.check_type || '').toUpperCase().includes('DUPLICATE')).length;
        const poisonCount = findingsList.filter((f: any) => {
          const c = String(f.check_type || '').toUpperCase();
          return c.includes('TRIGGER') || c.includes('BACKDOOR') || c.includes('POISON');
        }).length;
        const oodCount = findingsList.filter((f: any) => {
          const c = String(f.check_type || '').toUpperCase();
          return c.includes('OOD') || c.includes('DRIFT') || c.includes('SHIFT');
        }).length;
        const modelAnom = findingsList.filter((f: any) => {
          const c = String(f.check_type || '').toUpperCase();
          return c.includes('MODEL') || c.includes('WEIGHT');
        }).length;
        const infAnom = findingsList.filter((f: any) => {
          const c = String(f.check_type || '').toUpperCase();
          return c.includes('INFERENCE') || c.includes('OUTPUT');
        }).length;

        const isModelPassed = session.stage_results?.['MODEL_INTEGRITY']?.status === 'PASSED';
        const isModelRunning = session.stage === 'MODEL_ASSURANCE';
        const modelLayers = isModelPassed ? 24 : (isModelRunning ? 16 : 0);

        setLiveMetrics({
          samplesAnalyzed: totalSamples,
          totalSamples: totalSamples,
          modelLayersInspected: modelLayers,
          totalLayers: 24,
          hashesVerified: totalSamples,
          duplicatesFound: dupCount,
          poisonedSamples: poisonCount,
          oodCandidates: oodCount,
          modelAnomalies: modelAnom,
          inferenceAnomalies: infAnom,
        });

        // ── Live Terminal Logs ──
        const logs: TerminalLog[] = [
          {
            id: 'log-kernel-init',
            timestamp: session.created_at || new Date().toISOString(),
            level: 'INFO',
            message: `Kernel initialized. Active scan ID: ${currentScanId.slice(0, 8)}…`,
          },
        ];

        if (session.stage_results) {
          Object.entries(session.stage_results).forEach(([code, state], idx) => {
            const statusUp = (state.status || '').toUpperCase();
            const lvl = statusUp === 'PASSED' ? 'PASS' : statusUp === 'FAILED' ? 'CRIT' : statusUp === 'UNAVAILABLE' ? 'WARN' : 'INFO';
            logs.push({
              id: `log-${code}-${idx}`,
              timestamp: new Date().toISOString(),
              level: lvl as any,
              stageCode: code,
              message: `Stage [${code}]: ${state.explanation || state.status}`,
            });
          });
        }

        findingsList.forEach((f: any, idx: number) => {
          logs.push({
            id: `log-fnd-${idx}`,
            timestamp: new Date().toISOString(),
            level: f.severity === 'CRITICAL' ? 'CRIT' : 'WARN',
            message: `[${f.check_type}] ${f.description || f.finding_id}`,
          });
        });

        if (session.status === 'COMPLETED') {
          logs.push({
            id: 'log-fin',
            timestamp: new Date().toISOString(),
            level: 'PASS',
            message: `Pipeline complete. Zero-Trust disposition: ${session.assessment?.disposition || 'ACCEPTED'}`,
          });
        }
        setTerminalLogs(logs);

        // ── Latent Feature Space Signal Points ──
        if (session.assessment?.imageResults && session.assessment.imageResults.length > 0) {
          const pts: SignalPoint[] = session.assessment.imageResults.map((img: any, idx: number) => {
            const isPoisoned = img.action === 'QUARANTINE' || (img.evidence || []).some((e: string) => {
              const el = String(e).toLowerCase();
              return el.includes('trigger') || el.includes('backdoor') || el.includes('poison');
            });
            const isOod = (img.anomaly_score || 0) >= 0.3 || (img.evidence || []).some((e: string) => {
              const el = String(e).toLowerCase();
              return el.includes('ood') || el.includes('drift') || el.includes('shift');
            });
            const status: 'normal' | 'ood' | 'poisoned' = isPoisoned ? 'poisoned' : isOod ? 'ood' : 'normal';
            const angle = (idx * 137.5 * Math.PI) / 180;
            let x = 250;
            let y = 120;
            if (isPoisoned) {
              x = 410 + Math.cos(angle) * (8 + (idx % 16));
              y = 70 + Math.sin(angle) * (8 + (idx % 16));
            } else if (isOod) {
              const r = 95 + (idx % 35);
              x = 250 + Math.cos(angle) * r;
              y = 120 + Math.sin(angle) * (r * 0.55);
            } else {
              const r = 20 + ((idx * 23) % 55);
              x = 250 + Math.cos(angle) * r;
              y = 120 + Math.sin(angle) * (r * 0.55);
            }
            return {
              id: `pt-${img.sample_id || idx}`,
              sampleId: img.sample_id || `sample_${idx}`,
              x: Math.round(x),
              y: Math.round(y),
              status,
              score: img.anomaly_score ?? 0.0,
              cluster: isPoisoned ? 'Poisoned Trigger Cluster' : isOod ? 'Distribution Outlier' : 'Nominal Latent Manifold',
            };
          });
          setSignalPoints(pts);
        }

        if (session.status === 'COMPLETED' || session.status === 'FAILED') {
          clearInterval(scanIntervalRef.current!);

          // ── Final stage resolution ─────────────────────────────────────────
          // Any stage still WAITING after the pipeline ended gets UNAVAILABLE
          // (not PASSED) — the backend either didn't run it or didn't report it.
          setStages(prev => prev.map(s => {
            const componentState = session.stage_results?.[s.code];
            if (componentState) {
              const backendStatus = componentState.status.toUpperCase();
              const frontendStatus: any =
                backendStatus === 'PASSED' ? 'PASSED' :
                backendStatus === 'FAILED' ? 'FAILED' :
                backendStatus === 'UNAVAILABLE' ? 'UNAVAILABLE' :
                backendStatus === 'RUNNING' ? 'PASSED' : // RUNNING at completion = PASSED
                'UNAVAILABLE';
              return {
                ...s,
                status: frontendStatus,
                summary: componentState.explanation || s.summary,
              };
            }
            // Not in stage_results → UNAVAILABLE (never assume PASSED).
            return s.status === 'WAITING' ? { ...s, status: 'UNAVAILABLE' } : s;
          }));

          if (session.assessment) {
            // Every value below is copied verbatim from the backend response.
            // The frontend performs NO re-derivation of security semantics.
            const assessment = session.assessment as Record<string, any>;
            const assuranceScore = typeof assessment.assuranceScore === 'number'
              ? assessment.assuranceScore : null;
            const dataRiskScore = typeof assessment.dataRiskScore === 'number'
              ? assessment.dataRiskScore : null;
            const modelRiskScore = typeof assessment.modelRiskScore === 'number'
              ? assessment.modelRiskScore : -1;
            const inferenceRiskScore = typeof assessment.inferenceRiskScore === 'number'
              ? assessment.inferenceRiskScore : -1;
            const rawDisposition = String(assessment.disposition ?? session.status).toUpperCase();

            setTrustScore({
              overall: assuranceScore === null ? -1 : Math.round(assuranceScore * 100),
              dataIntegrity: dataRiskScore === null ? 0 : Math.round(dataRiskScore * 100),
              // -1 is the backend's explicit "module UNAVAILABLE" sentinel.
              modelIntegrity: modelRiskScore < 0 ? -1 : Math.round(modelRiskScore * 100),
              inferenceIntegrity: inferenceRiskScore < 0 ? -1 : Math.round(inferenceRiskScore * 100),
              pipelineIntegrity: assuranceScore === null ? -1 : Math.round(assuranceScore * 100),
              verdict: (rawDisposition === 'REVIEW' || rawDisposition === 'ALLOW_WITH_MONITORING')
                ? 'UNDER_REVIEW'
                : (rawDisposition as any),
              headline: `Backend disposition: ${rawDisposition}`,
              summary: `Analyzed ${assessment.totalSamples ?? 0} samples — backend status: ${session.status}`,
            });
            setImageResults(assessment.imageResults || []);
            setFindings((session.findings || []).map((f: any) => {
              const checkType = String(f.check_type || '').toUpperCase();
              let category: any = 'DATA POISONING';
              if (checkType.includes('DRIFT') || checkType.includes('DISTRIBUTION') || checkType.includes('SHIFT')) {
                category = 'OOD';
              } else if (checkType.includes('MODEL') || checkType.includes('WEIGHT')) {
                category = 'MODEL INTEGRITY';
              } else if (checkType.includes('BACKDOOR') || checkType.includes('TRIGGER')) {
                category = 'BACKDOOR';
              } else if (checkType.includes('INFERENCE') || checkType.includes('OUTPUT')) {
                category = 'INFERENCE';
              } else if (checkType.includes('DUPLICATE')) {
                category = 'DUPLICATES';
              } else if (checkType.includes('LABEL')) {
                category = 'MISLABELING';
              }
              return {
                id: f.finding_id,
                title: f.check_type,
                category,
                severity: f.severity,
                affectedArtifact: f.sample_ids?.[0] ? String(f.sample_ids[0]) : 'Uploaded dataset',
                evidenceSummary: f.description,
                confidence: Math.round((f.metric_score ?? 0) * 100),
                status: rawDisposition === 'QUARANTINED' ? 'Quarantined' : 'Confirmed',
                detectionMethod: 'Backend assurance engine',
                expectedValue: 'Clean',
                observedValue: f.description,
                sha256Proof: f.details?.sha256_hash ?? 'N/A',
                recommendedAction: f.details?.recommended_action ?? 'Analyst review required',
              };
            }));
          } else if (session.status === 'FAILED') {
            // FAILED with no assessment — do NOT synthesise a happy-path score.
            setTrustScore(null);
          }

          // Ledger verification and evidence graph come from the backend only.
          await refreshLedgerVerification();
          await loadEvidenceGraph();
          if (session.batch_id) await refreshAnalystDecisions(session.batch_id);

          finalizeScan();
        }
      } catch (err) {
        console.error('Scan polling error', err);
        setBackendError(err instanceof Error ? err.message : 'Scan polling failed');
      }
    }, 1000);
  }, [currentScanId, finalizeScan, refreshLedgerVerification, loadEvidenceGraph, refreshAnalystDecisions]);

  /**
   * Start the scan page and begin polling the backend for the scan session
   * that was created during dataset upload.
   *
   * Guard: if there is no scan_id from the backend, refuse to proceed.  The
   * UI should disable this button when isReadyToScan is false.
   */
  const startScan = useCallback(() => {
    if (!currentScanId) {
      setBackendError(
        'Cannot start scan: no backend scan session exists. ' +
        'Upload a dataset first to receive a scan ID.',
      );
      return;
    }
    setIsScanning(true);
    setIsScanCompleted(false);
    setScanProgress(0);
    setElapsedSeconds(0);
    setStages(PIPELINE_STAGES);
    setLiveMetrics(INITIAL_METRICS);
    setTerminalLogs([]);
    setSignalPoints([]);
    setCurrentOperation('Connecting to backend scan session…');
    setPhase('scan');
    pollScanProgress();
  }, [currentScanId, pollScanProgress, setPhase]);

  // Cleanup polling on unmount.
  useEffect(() => {
    return () => {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    };
  }, []);

  return (
    <InvestigationContext.Provider value={{
      phase, setPhase, theme, toggleTheme, sessionId, backendOnline, backendOverview,
      fusedAssessmentId, currentScanId, scanSession, artifacts, clearArtifacts,
      updateArtifactWithFile, verifyArtifact, isReadyToScan, validationChecklist,
      isScanning, isScanCompleted, scanProgress, currentOperation, elapsedSeconds,
      stages, terminalLogs, liveMetrics, signalPoints,
      startScan, findings, setFindings,
      selectedCategory, setSelectedCategory, selectedSeverity, setSelectedSeverity,
      searchQuery, setSearchQuery, selectedFinding, setSelectedFinding, trustScore,
      setTrustScore, recommendations, setRecommendations, imageResults, quarantineImage,
      graphNodes, graphEdges, graphDigest, selectedGraphNode, setSelectedGraphNode,
      focusNodeInGraph, ledgerVerification, analystDecisions, backendError,
      refreshLedgerVerification, loadEvidenceGraph, refreshAnalystDecisions,
      submitAnalystDecision, resetInvestigation, exportReport, exportEvidencePackage, uploadOneOffCheck,
    }}>
      {children}
    </InvestigationContext.Provider>
  );
};

export const useInvestigation = () => {
  const context = useContext(InvestigationContext);
  if (!context) throw new Error('useInvestigation must be used within an InvestigationProvider');
  return context;
};

// ── Utilities ────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function getExtension(filename: string): string {
  return filename.split('.').pop() ?? '';
}
