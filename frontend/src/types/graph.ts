export type NodeType =
  | 'CONTRIBUTOR'
  | 'DATASET_BATCH'
  | 'SAMPLE'
  | 'SAMPLE_CLUSTER'
  | 'MODEL'
  | 'INFERENCE_RECORD'
  | 'FINDING'
  // Extended types from the backend graph engine (NodeType enum)
  | 'DATASET'
  | 'DATASET_VERSION'
  | 'MODEL_VERSION'
  | 'TRAINING_RUN'
  | 'PREPROCESSING_CONFIG'
  | 'INFERENCE'
  | 'OUTPUT'
  | 'EVIDENCE'
  | 'DRIFT_ASSESSMENT'
  | 'CONTRIBUTOR_ASSESSMENT'
  | 'FUSION_ASSESSMENT'
  | 'QUARANTINE_RECORD'
  | 'ANALYST_DECISION'
  | 'AUDIT_EVENT'
  | 'REPORT';

export type EdgeType =
  | 'AUTHORED_BY'
  | 'CONTAINS_SAMPLE'
  | 'TRAINED_ON'
  | 'GENERATED_BY'
  | 'FLAGGED_WITH'
  // Extended edge types from the backend graph engine (EdgeType enum)
  | 'PROVIDED'
  | 'PRODUCED'
  | 'USED_PREPROCESSING'
  | 'EVALUATED_BY'
  | 'DECIDES_ON'
  | 'QUARANTINES'
  | 'RESULTED_FROM'
  | 'VERSION_OF'
  | 'HAS_OUTPUT'
  | 'ASSESSED_IN'
  | 'REFERENCES'
  | 'ATTACHED_TO'
  | 'ABOUT';

export interface GraphNode {
  id: string;
  nodeType: NodeType;
  label: string;
  subLabel?: string;
  status: 'normal' | 'warning' | 'critical' | 'unknown';
  properties: {
    hash?: string;
    contributorId?: string;
    confidence?: number;
    severity?: string;
    details?: string;
    [key: string]: any;
  };
  /** Cryptographic digest or canonical identity from the backend. */
  digest?: string;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  edgeType: EdgeType;
  label?: string;
}

export interface LineageTrace {
  targetId: string;
  upstreamIds: string[];
  downstreamIds: string[];
  findingIds: string[];
  blastRadiusCount: number;
}
