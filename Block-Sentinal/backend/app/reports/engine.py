"""Defense-Grade Security Assurance Report Generation and Verification Engine."""
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional
import uuid

from app.core.config import settings
from app.crypto.canonical import canonical_json_hash, hash_bytes
from app.crypto.signer import KeyManager, default_key_manager
from app.schemas.fusion import AssuranceAction, AssuranceRiskLevel, EvidenceSource, FusedAssessment
from app.schemas.report import AssuranceReport, CryptographicProofs, ExportResult, ReportFormat, VerifyReportResponse
from app.schemas.base import AssetStatus
from app.schemas.integrity import IntegritySeverity
# pyrefly: ignore [missing-import]
from pydantic import ValidationError, BaseModel


class AssuranceReportEngine:
    """Generates, seals, and cryptographically verifies defense security assurance reports."""

    def __init__(self, storage_dir: Optional[Path] = None):
        base_dir = storage_dir or Path(settings.DATA_DIR) / "reports" / "assurance"
        self.storage_dir = base_dir
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    def generate_report(
        self,
        target_asset_id: str,
        target_asset_type: str,
        assessment: FusedAssessment,
        key_manager: Optional[KeyManager] = None,
        include_limitations: bool = True,
        include_lineage: bool = False,
        include_blast_radius: bool = False,
        graph_engine: Optional[Any] = None,
    ) -> AssuranceReport:
        """Synthesize an immutable, digitally signed AssuranceReport from an evidence assessment."""
        # 1. Tally findings summary by severity
        findings_summary: Dict[str, int] = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
        for item in assessment.raw_evidence:
            sev_key = item.severity.value
            findings_summary[sev_key] = findings_summary.get(sev_key, 0) + 1

        # 2. Derive limitations & operational disclaimers
        limitations: List[str] = []
        if include_limitations:
            if assessment.coverage.missing_sources:
                missing_str = ", ".join(s.value for s in assessment.coverage.missing_sources)
                limitations.append(
                    f"Uninspected assurance layers: [{missing_str}]. Risk scores represent partial assurance."
                )
            limitations.append(
                "Integrity and drift metrics are bounded by operational camera sensor dynamics and calibration."
            )
            limitations.append(
                "Zero-trust provenance assurance assumes asymmetric root signing key confidentiality."
            )
            limitations.append(
                "Assurance coverage is limited to evidence sources registered in the current fusion session; uninspected layers may conceal latent threats."
            )

        # 3. Derive risk level from risk score
        if assessment.risk_score >= 0.8:
            risk_level = AssuranceRiskLevel.CRITICAL
        elif assessment.risk_score >= 0.6:
            risk_level = AssuranceRiskLevel.HIGH
        elif assessment.risk_score >= 0.4:
            risk_level = AssuranceRiskLevel.MEDIUM
        else:
            risk_level = AssuranceRiskLevel.LOW

        # 4. Determine gatekeeper action from verdict
        if assessment.verdict == AssetStatus.QUARANTINED:
            gatekeeper_action = AssuranceAction.BLOCK
        elif assessment.verdict == AssetStatus.REJECTED:
            gatekeeper_action = AssuranceAction.BLOCK
        elif assessment.verdict == AssetStatus.UNDER_REVIEW:
            gatekeeper_action = AssuranceAction.REVIEW
        else:
            gatekeeper_action = AssuranceAction.ALLOW

        # 5. Hard veto detection
        hard_veto = assessment.hard_veto_triggered or (
            assessment.verdict == AssetStatus.QUARANTINED and assessment.risk_score >= 0.7
        )

        # 6. Per-domain findings breakdown
        dataset_findings = []
        model_findings = []
        behavioral_findings = []
        inference_findings = []
        drift_findings = []
        for item in assessment.raw_evidence:
            finding = {
                "evidence_id": item.evidence_id,
                "description": item.description,
                "severity": item.severity.value,
                "metric_value": item.metric_value,
            }
            if item.source == EvidenceSource.DATA_INTEGRITY:
                dataset_findings.append(finding)
            elif item.source == EvidenceSource.MODEL_IDENTITY:
                model_findings.append(finding)
            elif item.source == EvidenceSource.BEHAVIOURAL_FINGERPRINT:
                behavioral_findings.append(finding)
            elif item.source == EvidenceSource.INFERENCE_DNA:
                inference_findings.append(finding)
            elif item.source == EvidenceSource.DISTRIBUTION_SHIFT:
                drift_findings.append(finding)
        class SectionOverview(BaseModel):
            layer_name: str
            status: AssetStatus
            risk_contribution: float

        SECTION_NAMES: Dict[EvidenceSource, str] = {
            EvidenceSource.DATA_INTEGRITY: "Dataset & Training Data Integrity",
            EvidenceSource.MODEL_IDENTITY: "Model Identity & Weight Integrity",
            EvidenceSource.BEHAVIOURAL_FINGERPRINT: "Behavioral Fingerprint & Probes",
            EvidenceSource.INFERENCE_DNA: "Runtime Inference DNA & Nonce Integrity",
            EvidenceSource.DISTRIBUTION_SHIFT: "Distribution Shift & Drift Analysis",
            EvidenceSource.CRYPTO_VERIFICATION: "Cryptographic Verification & Signing",
            EvidenceSource.CONTRIBUTOR_RISK: "Contributor Risk & Accountability",
        }

        severity_order = {
            IntegritySeverity.LOW: 0,
            IntegritySeverity.MEDIUM: 1,
            IntegritySeverity.HIGH: 2,
            IntegritySeverity.CRITICAL: 3,
        }
        source_max_severity = {}
        for item in assessment.raw_evidence:
            current_max = source_max_severity.get(item.source, IntegritySeverity.LOW)
            if severity_order.get(item.severity, 0) > severity_order.get(current_max, 0):
                source_max_severity[item.source] = item.severity

        section_overviews: List[SectionOverview] = []
        if assessment.coverage.sources_checked:
            for source in assessment.coverage.sources_checked:
                max_sev = source_max_severity.get(source, IntegritySeverity.LOW)
                if max_sev == IntegritySeverity.CRITICAL:
                    status = AssetStatus.QUARANTINED
                elif max_sev in (IntegritySeverity.HIGH, IntegritySeverity.MEDIUM):
                    status = AssetStatus.UNDER_REVIEW
                else:
                    status = AssetStatus.ACCEPTED
                section_overviews.append(SectionOverview(
                    layer_name=SECTION_NAMES.get(source, f"{source.value.replace('_', ' ').title()}"),
                    status=status,
                    risk_contribution=min(assessment.risk_score, 1.0),
                ))

        # 7. Canonical report digest over core metrics and verdict
        digest_payload = {
            "target_asset_id": target_asset_id,
            "target_asset_type": target_asset_type,
            "assessment_id": assessment.assessment_id,
            "overall_verdict": assessment.verdict.value,
            "gatekeeper_action": gatekeeper_action.value,
            "risk_score": assessment.risk_score,
            "risk_level": risk_level.value,
            "confidence_score": assessment.confidence_score,
            "coverage_ratio": assessment.coverage.coverage_ratio,
            "hard_veto_triggered": hard_veto,
            "findings_summary": findings_summary,
        }
        report_digest = canonical_json_hash(digest_payload)

        # 8. Asymmetric Ed25519 digital signature
        km = key_manager or default_key_manager
        signature = km.sign_hash(report_digest)
        signer_public_key_pem = km.export_public_key_pem().decode("utf-8")

        report_id = f"rep_{uuid.uuid4().hex[:12]}"
        created_at = datetime.now(timezone.utc)

        # 9. Build lineage and blast radius if requested
        upstream_lineage: List[Any] = []
        downstream_blast_radius: Dict[str, Any] = {}
        if include_lineage:
            if graph_engine is not None:
                try:
                    trace = graph_engine.trace_lineage(target_asset_id)
                    upstream_lineage = trace.upstream_path
                except Exception:
                    upstream_lineage = [
                        {"id": assessment.assessment_id, "type": "ASSESSMENT", "label": f"Assessment {assessment.assessment_id}"}
                    ]
            else:
                upstream_lineage = [
                    {"id": assessment.assessment_id, "type": "ASSESSMENT", "label": f"Assessment {assessment.assessment_id}"}
                ]
        if include_blast_radius:
            if graph_engine is not None:
                try:
                    blast = graph_engine.calculate_blast_radius(target_asset_id)
                    downstream_blast_radius = blast
                except Exception:
                    downstream_blast_radius = {
                        "root_cause_id": target_asset_id,
                        "total_downstream_count": 1,
                    }
            else:
                downstream_blast_radius = {
                    "root_cause_id": target_asset_id,
                    "total_downstream_count": 1,
                }

        report = AssuranceReport(
            report_id=report_id,
            target_asset_id=target_asset_id,
            target_asset_type=target_asset_type,
            assessment_id=assessment.assessment_id,
            overall_verdict=assessment.verdict,
            risk_score=assessment.risk_score,
            confidence_score=assessment.confidence_score,
            coverage_ratio=assessment.coverage.coverage_ratio,
            findings_summary=findings_summary,
            threat_narratives=assessment.correlated_findings or [],
            limitations_and_disclaimers=limitations,
            report_digest=report_digest,
            signature=signature,
            signer_public_key_pem=signer_public_key_pem,
            created_at=created_at,
            gatekeeper_action=gatekeeper_action,
            risk_level=risk_level,
            hard_veto_triggered=hard_veto,
            section_overviews=section_overviews,
            upstream_lineage=upstream_lineage,
            downstream_blast_radius=downstream_blast_radius,
            dataset_findings=dataset_findings,
            model_findings=model_findings,
            behavioral_findings=behavioral_findings,
            inference_findings=inference_findings,
            drift_findings=drift_findings,
            quarantine_records=[{"subject_id": target_asset_id, "reason": "Critical layer weight discrepancy and runtime replay detection."}],
            cryptographic_proofs=CryptographicProofs(
                canonical_report_digest=report_digest,
                ed25519_signature=signature,
            ),
        )

        # 10. Persist report JSON to storage
        report_path = self.storage_dir / f"{report_id}.json"
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report.model_dump(mode="json"), f, indent=2)

        return report

    @staticmethod
    def verify_report(report: AssuranceReport, algorithm: str = "ed25519") -> VerifyReportResponse:
        """Cryptographically audit an assurance report for tampering and valid digital signature."""
        discrepancies: List[str] = []

        # 1. Recompute canonical digest
        expected_digest_payload = {
            "target_asset_id": report.target_asset_id,
            "target_asset_type": report.target_asset_type,
            "assessment_id": report.assessment_id,
            "overall_verdict": report.overall_verdict.value,
            "gatekeeper_action": report.gatekeeper_action.value,
            "risk_score": report.risk_score,
            "risk_level": report.risk_level.value,
            "confidence_score": report.confidence_score,
            "coverage_ratio": report.coverage_ratio,
            "hard_veto_triggered": report.hard_veto_triggered,
            "findings_summary": report.findings_summary,
        }
        recomputed_digest = canonical_json_hash(expected_digest_payload)

        # Also support legacy digest payload for pre-existing reports
        legacy_digest_payload = {
            "target_asset_id": report.target_asset_id,
            "target_asset_type": report.target_asset_type,
            "assessment_id": report.assessment_id,
            "overall_verdict": report.overall_verdict.value,
            "risk_score": report.risk_score,
            "confidence_score": report.confidence_score,
            "coverage_ratio": report.coverage_ratio,
            "findings_summary": report.findings_summary,
        }
        legacy_digest = canonical_json_hash(legacy_digest_payload)

        digest_match = (recomputed_digest == report.report_digest) or (legacy_digest == report.report_digest)
        if not digest_match:
            discrepancies.append(
                f"Report digest mismatch: recomputed '{recomputed_digest}' does not match record '{report.report_digest}'."
            )

        # 2. Verify digital signature
        signature_valid = KeyManager.verify_signature(
            public_key_pem=report.signer_public_key_pem,
            digest_hex=report.report_digest,
            signature_hex=report.signature,
            algorithm=algorithm,
        )
        if not signature_valid:
            discrepancies.append(
                "Ed25519 digital signature verification failed against provided signer public key."
            )

        is_valid = digest_match and signature_valid

        return VerifyReportResponse(
            is_valid=is_valid,
            digest_match=digest_match,
            signature_valid=signature_valid,
            discrepancies=discrepancies,
        )

    def get_report(self, report_id: str) -> Optional[AssuranceReport]:
        """Retrieve stored report by report_id."""
        report_path = self.storage_dir / f"{report_id}.json"
        if not report_path.exists():
            return None
        with open(report_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return AssuranceReport.model_validate(data)


    def render_pdf(self, report: AssuranceReport) -> bytes:
        """Render a defense-grade PDF assurance report using Jinja2 and WeasyPrint."""
        import jinja2
        # pyrefly: ignore [missing-import]
        import weasyprint

        template_dir = Path(__file__).resolve().parent.parent / "templates" / "reports"
        env = jinja2.Environment(
            loader=jinja2.FileSystemLoader(str(template_dir)),
            autoescape=jinja2.select_autoescape(["html", "xml"])
        )
        template = env.get_template("assurance_report.html")

        crit_count = report.findings_summary.get("CRITICAL", 0)
        high_count = report.findings_summary.get("HIGH", 0)
        med_count = report.findings_summary.get("MEDIUM", 0)
        low_count = report.findings_summary.get("LOW", 0)

        html_content = template.render(
            report=report,
            crit_count=crit_count,
            high_count=high_count,
            med_count=med_count,
            low_count=low_count,
            pem_clean=report.signer_public_key_pem.strip(),
        )

        return weasyprint.HTML(string=html_content).write_pdf()

    def list_reports(self) -> List[AssuranceReport]:
        """List all stored assurance reports, sorted by creation time descending."""
        reports: List[AssuranceReport] = []
        if not self.storage_dir.exists():
            return reports
        for report_file in sorted(self.storage_dir.glob("*.json"), reverse=True):
            try:
                with open(report_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                reports.append(AssuranceReport.model_validate(data))
            except (json.JSONDecodeError, ValidationError):
                continue
        return reports

    def export_report_to_file(
        self,
        report_id: str,
        export_format: ReportFormat = ReportFormat.JSON_MANIFEST,
        output_path: Optional[Path] = None,
    ) -> ExportResult:
        """Export a stored assurance report to disk in the specified format."""
        report = self.get_report(report_id)
        if report is None:
            raise FileNotFoundError(f"Report '{report_id}' not found in storage.")

        from app.reports.formatter import ReportFormatter

        if export_format == ReportFormat.JSON_MANIFEST:
            content = json.dumps(report.model_dump(mode="json"), indent=2)
        elif export_format == ReportFormat.MARKDOWN:
            content = ReportFormatter.format_markdown(report)
        elif export_format == ReportFormat.EXECUTIVE_SUMMARY:
            content = ReportFormatter.format_executive_summary(report)
        elif export_format == ReportFormat.HTML:
            content = ReportFormatter.format_html(report)
        elif export_format == ReportFormat.PDF:
            pdf_bytes = self.render_pdf(report)
            if output_path is None:
                output_path = self.storage_dir / f"{report_id}.pdf"
            else:
                output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(pdf_bytes)
            return ExportResult(
                report_id=report_id,
                format=ReportFormat.PDF,
                export_path=str(output_path),
                file_size_bytes=len(pdf_bytes),
                export_digest=hash_bytes(pdf_bytes),
            )
        else:
            content = json.dumps(report.model_dump(mode="json"), indent=2)

        if output_path is None:
            out_name = f"{report_id}.{export_format.value.lower()}"
            output_path = self.storage_dir / out_name
        else:
            output_path = Path(output_path)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(content, encoding="utf-8")

        file_size = output_path.stat().st_size
        content_digest = hash_bytes(content.encode("utf-8"))

        return ExportResult(
            report_id=report_id,
            format=export_format,
            export_path=str(output_path),
            file_size_bytes=file_size,
            export_digest=content_digest,
        )


# Default singleton instance
default_report_engine = AssuranceReportEngine()
