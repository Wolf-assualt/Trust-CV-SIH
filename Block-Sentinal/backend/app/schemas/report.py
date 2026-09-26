"""Pydantic schemas for Defense-Grade Security Assurance Reports."""
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List
# pyrefly: ignore [missing-import]
from pydantic import BaseModel, Field

from app.schemas.base import AssetStatus
from app.schemas.fusion import AssuranceAction, AssuranceRiskLevel


class ReportFormat(str, Enum):
    """Output formats for assurance reports."""
    JSON_MANIFEST = "JSON_MANIFEST"
    MARKDOWN = "MARKDOWN"
    EXECUTIVE_SUMMARY = "EXECUTIVE_SUMMARY"
    HTML = "HTML"
    PDF = "PDF"


class CryptographicProofs(BaseModel):
    """Cryptographic proof references attached to an assurance report."""
    canonical_report_digest: str
    ed25519_signature: str

    @property
    def ecdsa_signature(self) -> str:
        return self.ed25519_signature


class AssuranceReport(BaseModel):
    """Cryptographically sealed defense security assurance report."""
    report_id: str
    target_asset_id: str
    target_asset_type: str  # "MODEL", "DATASET_BATCH", "INFERENCE_PIPELINE"
    assessment_id: str
    overall_verdict: AssetStatus
    risk_score: float = Field(..., ge=0.0, le=1.0)
    confidence_score: float = Field(..., ge=0.0, le=1.0)
    coverage_ratio: float = Field(..., ge=0.0, le=1.0)
    findings_summary: Dict[str, int] = Field(default_factory=dict)
    threat_narratives: List[str] = Field(default_factory=list)
    limitations_and_disclaimers: List[str] = Field(default_factory=list)
    report_digest: str = Field(..., min_length=64, max_length=64)
    signature: str
    signer_public_key_pem: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    # Extended forensic fields
    gatekeeper_action: AssuranceAction = Field(default_factory=lambda: AssuranceAction.ALLOW)
    risk_level: AssuranceRiskLevel = Field(default_factory=lambda: AssuranceRiskLevel.LOW)
    hard_veto_triggered: bool = False
    section_overviews: List[Any] = Field(default_factory=list)
    upstream_lineage: List[Any] = Field(default_factory=list)
    downstream_blast_radius: Any = Field(default_factory=dict)
    dataset_findings: List[Dict[str, Any]] = Field(default_factory=list)
    model_findings: List[Dict[str, Any]] = Field(default_factory=list)
    behavioral_findings: List[Dict[str, Any]] = Field(default_factory=list)
    inference_findings: List[Dict[str, Any]] = Field(default_factory=list)
    drift_findings: List[Dict[str, Any]] = Field(default_factory=list)
    quarantine_records: List[Dict[str, Any]] = Field(default_factory=list)
    cryptographic_proofs: CryptographicProofs = Field(default_factory=lambda: CryptographicProofs(canonical_report_digest="", ed25519_signature=""))


class GenerateReportRequest(BaseModel):
    """Request payload to generate a signed assurance report from a fused assessment."""
    target_asset_id: str = Field(..., min_length=1)
    target_asset_type: str = Field("MODEL", min_length=1)
    assessment_id: str = Field(..., min_length=1)
    include_limitations: bool = True


class VerifyReportRequest(BaseModel):
    """Request payload to cryptographically audit an assurance report."""
    report: AssuranceReport


class VerifyReportResponse(BaseModel):
    """Audit verdict on report authenticity and tamper status."""
    is_valid: bool
    digest_match: bool
    signature_valid: bool
    discrepancies: List[str] = Field(default_factory=list)


class ExportResult(BaseModel):
    """Result of exporting an assurance report to a file."""
    report_id: str
    format: ReportFormat
    export_path: str
    file_size_bytes: int
    export_digest: str
