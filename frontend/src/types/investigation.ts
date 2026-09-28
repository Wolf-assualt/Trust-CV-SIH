export type Phase = 'launch' | 'scan' | 'results';

export type ArtifactType = 'dataset' | 'model' | 'inference' | 'manifest' | 'baseline';

export interface ArtifactItem {
  id: string;
  type: ArtifactType;
  title: string;
  filename: string;
  size: string;
  hash: string;
  status: 'empty' | 'uploading' | 'verified' | 'error';
  progress: number;
  metadata?: {
    samplesCount?: number;
    layersCount?: number;
    recordsCount?: number;
    format?: string;
    signature?: string;
    modelId?: string;
  };
}

export type StageStatus = 'WAITING' | 'RUNNING' | 'PASSED' | 'WARNING' | 'FAILED' | 'UNAVAILABLE';

export interface PipelineStage {
  id: number;
  code: string;
  title: string;
  status: StageStatus;
  progress: number;
  summary?: string;
  durationMs?: number;
}

export interface TerminalLog {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'CRIT' | 'PASS';
  message: string;
  stageCode?: string;
}

export interface LiveMetrics {
  samplesAnalyzed: number;
  totalSamples: number;
  modelLayersInspected: number;
  totalLayers: number;
  hashesVerified: number;
  duplicatesFound: number;
  poisonedSamples: number;
  oodCandidates: number;
  modelAnomalies: number;
  inferenceAnomalies: number;
}

export interface SignalPoint {
  id: string;
  sampleId: string;
  x: number;
  y: number;
  status: 'normal' | 'ood' | 'poisoned';
  score: number;
  cluster: string;
}

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'WARNING' | 'HIGH' | 'CRITICAL';

export type FindingCategory =
  | 'ALL'
  | 'DATA POISONING'
  | 'DUPLICATES'
  | 'MISLABELING'
  | 'OOD'
  | 'MODEL INTEGRITY'
  | 'BACKDOOR'
  | 'INFERENCE'
  | 'METADATA'
  | 'HASH'
  | 'PIPELINE';

export interface Finding {
  id: string;
  title: string;
  category: FindingCategory;
  severity: Severity;
  affectedArtifact: string;
  evidenceSummary: string;
  confidence: number;
  status: 'Confirmed' | 'Review' | 'Quarantined';
  detectionMethod: string;
  expectedValue: string;
  observedValue: string;
  sha256Proof: string;
  recommendedAction: string;
  relatedNodeId?: string;
}

export type VerdictStatus =
  | 'TRUSTED'
  | 'ACCEPTED'
  | 'CAUTION'
  | 'UNDER_REVIEW'
  | 'COMPROMISED'
  | 'CRITICAL'
  | 'QUARANTINED'
  | 'INSUFFICIENT_EVIDENCE';

export interface TrustScore {
  overall: number;
  dataIntegrity: number;
  modelIntegrity: number;
  inferenceIntegrity: number;
  pipelineIntegrity: number;
  verdict: VerdictStatus;
  headline: string;
  summary: string;
}

export interface Recommendation {
  id: string;
  priority: 'IMMEDIATE' | 'HIGH' | 'MEDIUM';
  title: string;
  description: string;
  actionLabel: string;
  actionType: 'quarantine' | 'revalidate' | 'rollback' | 'export';
}
