"""Pydantic schemas for Training-Data Integrity Engine."""
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
# pyrefly: ignore [missing-import]
from pydantic import BaseModel, Field

from app.schemas.base import AssetStatus


class IntegrityCheckType(str, Enum):
    EXACT_DUPLICATE = "EXACT_DUPLICATE"
    NEAR_DUPLICATE = "NEAR_DUPLICATE"
    LABEL_INCONSISTENCY = "LABEL_INCONSISTENCY"
    MISSING_LABEL = "MISSING_LABEL"
    MALFORMED_ANNOTATION = "MALFORMED_ANNOTATION"
    QUALITY_ANOMALY = "QUALITY_ANOMALY"
    CORRUPT_OR_OOD = "CORRUPT_OR_OOD"          # kept for backwards compat
    OOD_ANOMALY = "OOD_ANOMALY"
    TRIGGER_CANDIDATE = "TRIGGER_CANDIDATE"
    TRIGGER_BACKDOOR = "TRIGGER_BACKDOOR"       # kept for backwards compat


class TriggerTag(str, Enum):
    STATIC_PATCH = "STATIC_PATCH"
    HEURISTIC_SALIENCY_ANOMALY = "HEURISTIC_SALIENCY_ANOMALY"


class IntegritySeverity(str, Enum):
    """Severity indicates potential impact, NOT probability or certainty.

    Rules:
      CRITICAL — Confirmed evidence of data manipulation that could compromise
                 model training (e.g. trigger pattern across multiple samples
                 sharing a target label).
      HIGH     — Strong evidence of data quality failure that could affect model
                 integrity (e.g. zero-variance image, label conflict on
                 near-identical images, corrupt file).
      MEDIUM   — Moderate evidence requiring human review (e.g. exact duplicate
                 group, extreme aspect ratio anomaly).
      LOW      — Informational finding (e.g. near-duplicate cluster, minor
                 quality anomaly).
    """
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class IntegrityFinding(BaseModel):
    """Standardized finding produced by any integrity detector.

    Confidence basis (per detector):
      Exact duplicate:           1.0 — SHA-256 byte-identity is deterministic.
      Near-duplicate:            1.0 - (hamming / 64) — normalized hamming over
                                 64-bit dHash space.
      Label conflict:            1.0 - (hamming / 64) — visual similarity of
                                 the conflicting pair.
      Missing label:             1.0 — deterministic: annotation list is empty.
      Malformed annotation:      1.0 — deterministic: bbox coordinates invalid.
      Quality (zero variance):   1.0 — deterministic pixel analysis.
      Quality (aspect ratio):    null — heuristic threshold, no statistical basis.
      Quality (corrupt file):    1.0 — deterministic: PIL cannot decode.
      Trigger (repeated patch):  affected_count / group_size — proportion of
                                 samples with matching patch signature.
      Trigger (isolated):        null — heuristic thresholds, no ground truth.
      OOD (no reference):        N/A — UNAVAILABLE, no findings produced.
    """
    finding_id: str
    check_type: IntegrityCheckType
    severity: IntegritySeverity
    sample_ids: List[str]
    description: str
    metric_score: float  # e.g. hamming distance, similarity ratio
    details: Dict[str, Any] = Field(default_factory=dict)

    # ── Finding provenance (Phase 3) ─────────────────────────────────────────
    detector_id: str = "UNKNOWN"
    detector_version: str = "1.0.0"
    detector_parameters: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # ── Justified confidence (Phase 3) ───────────────────────────────────────
    confidence: Optional[float] = None       # null when not calculable
    confidence_basis: Optional[str] = None   # documented justification

    # ── Trigger classification tag (Phase 3 extension) ────────────────────────
    trigger_tag: Optional[str] = Field(
        default=None,
        description="Tag indicating trigger mechanism: 'STATIC_PATCH' vs 'HEURISTIC_SALIENCY_ANOMALY'",
    )

    # ── Extended evidence (Phase 3) ──────────────────────────────────────────
    limitations: Optional[str] = None
    recommended_action: Optional[str] = None


class ImageAssessment(BaseModel):
    sample_id: str
    file_name: str
    sha256_hash: str
    result: str
    integrity_status: str
    trust_status: str
    anomaly_score: Optional[float] = None
    evidence: List[str] = Field(default_factory=list)
    action: str
    preview_data_url: Optional[str] = None
    quarantined: bool = False


class AuditEvent(BaseModel):
    timestamp: datetime
    artifact_id: str
    sha256_hash: str
    detection_result: str
    integrity_status: str
    reason: str
    action: str
    scan_id: Optional[str] = None
    finding_ids: List[str] = Field(default_factory=list)
    contributor_id: Optional[str] = None


class ContributorRisk(BaseModel):
    """Aggregated risk profile for a known contributor."""
    contributor_id: str
    sample_count: int
    finding_count: int
    finding_types: List[str] = Field(default_factory=list)
    severity_distribution: Dict[str, int] = Field(default_factory=dict)
    risk_indicators: List[str] = Field(default_factory=list)


class DatasetIntegrityReport(BaseModel):
    batch_id: str
    total_samples_analyzed: int
    findings_count: int
    findings: List[IntegrityFinding]
    overall_health_score: float  # 0.0 (severely compromised) to 1.0 (clean)
    recommendation: AssetStatus  # ACCEPTED, UNDER_REVIEW, or QUARANTINED
    report_digest: str  # SHA-256 canonical hash of this report
    image_results: List[ImageAssessment] = Field(default_factory=list)
    audit_events: List[AuditEvent] = Field(default_factory=list)
    contributor_risks: List[ContributorRisk] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class IntegrityScanRequest(BaseModel):
    batch_id: str
    duplicate_threshold: int = 4  # Max Hamming distance for near duplicates
    trigger_detection_enabled: bool = True
