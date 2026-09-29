"""Training-Data Integrity Engine orchestrating duplicate, quality, label, OOD, and trigger analysis."""
import json
import base64
from collections import defaultdict
from io import BytesIO
from pathlib import Path
from typing import Optional

from app.core.config import settings
from app.crypto.canonical import canonical_json_dumps, canonical_json_hash
from app.integrity.detectors import (
    DuplicateDetector,
    LabelInconsistencyDetector,
    QualityDetector,
    OODDetector,
    TriggerCandidateDetector,
    CleanlabLabelQualityDetector,
)
from app.schemas.base import AssetStatus
from app.schemas.dataset import BatchManifest
from app.schemas.integrity import (
    ContributorRisk,
    DatasetIntegrityReport,
    AuditEvent,
    ImageAssessment,
    IntegrityFinding,
    IntegritySeverity,
    TriggerPatchLocation,
)

PENALTY_WEIGHTS = {
    IntegritySeverity.CRITICAL: 0.30,
    IntegritySeverity.HIGH: 0.15,
    IntegritySeverity.MEDIUM: 0.05,
    IntegritySeverity.LOW: 0.02,
}


def _deduplicate_evidence(lines: list[str]) -> list[str]:
    """Remove exact duplicate sentences and merge overlapping patch window descriptions."""
    seen: set[str] = set()
    result: list[str] = []
    spatial_count = 0
    spatial_sample = None
    for line in lines:
        normalized = " ".join(line.split())
        if normalized in seen:
            continue
        seen.add(normalized)
        if "spatial_window_" in line or "sliding window" in line.lower():
            spatial_count += 1
            if spatial_sample is None:
                spatial_sample = line
        else:
            result.append(line)
    if spatial_count == 1 and spatial_sample:
        result.append(spatial_sample)
    elif spatial_count > 1:
        result.append(f"Suspicious repeated static localized patch patterns detected across {spatial_count} spatial windows.")
    return result


class DataIntegrityEngine:
    """Executes multi-dimensional integrity scans over ingested dataset batch manifests."""

    def __init__(self, reports_dir: Optional[Path] = None):
        if reports_dir:
            self.reports_dir = Path(reports_dir)
        else:
            self.reports_dir = Path(settings.DATA_DIR) / "reports"
        self.reports_dir.mkdir(parents=True, exist_ok=True)

        self.duplicate_detector = DuplicateDetector()
        self.label_detector = LabelInconsistencyDetector()
        self.quality_detector = QualityDetector()
        self.ood_detector = OODDetector()
        self.trigger_detector = TriggerCandidateDetector()
        self.cleanlab_detector = CleanlabLabelQualityDetector()

    def _preview_data_url(self, file_path: Path) -> Optional[str]:
        try:
            # pyrefly: ignore [missing-import]
            from PIL import Image

            with Image.open(file_path) as image:
                image.thumbnail((240, 180))
                output = BytesIO()
                image.convert("RGB").save(output, format="JPEG", quality=78)
            encoded = base64.b64encode(output.getvalue()).decode("ascii")
            return f"data:image/jpeg;base64,{encoded}"
        except Exception:
            return None

    @staticmethod
    def _corner_to_coords(corner: str, patch_size: int, file_path: str) -> tuple[list[int] | None, int]:
        """Convert a corner name to [x, y, w, h] coordinates using actual image dimensions and detected patch extent."""
        try:
            from PIL import Image as PILImage
            import numpy as np
            with PILImage.open(file_path) as img:
                w, h = img.size
                arr = np.array(img.convert("RGB"))
        except Exception:
            return None, patch_size

        measured_w, measured_h = patch_size, patch_size
        try:
            if "top" in corner and "left" in corner:
                p0 = arr[0, 0].astype(int)
                x_end = 0
                while x_end < min(w, 64) and np.all(np.abs(arr[0, x_end].astype(int) - p0) < 30):
                    x_end += 1
                y_end = 0
                while y_end < min(h, 64) and np.all(np.abs(arr[y_end, 0].astype(int) - p0) < 30):
                    y_end += 1
                if x_end >= 8 and y_end >= 8:
                    measured_w, measured_h = x_end, y_end
            elif "top" in corner and "right" in corner:
                p0 = arr[0, w - 1].astype(int)
                x_start = w - 1
                while x_start >= max(0, w - 64) and np.all(np.abs(arr[0, x_start].astype(int) - p0) < 30):
                    x_start -= 1
                y_end = 0
                while y_end < min(h, 64) and np.all(np.abs(arr[y_end, w - 1].astype(int) - p0) < 30):
                    y_end += 1
                pw, ph = (w - 1 - x_start), y_end
                if pw >= 8 and ph >= 8:
                    measured_w, measured_h = pw, ph
        except Exception:
            pass

        final_sz = max(patch_size, measured_w)
        if "top" in corner and "left" in corner:
            return [0, 0, measured_w, measured_h], final_sz
        elif "top" in corner and "right" in corner:
            return [w - measured_w, 0, measured_w, measured_h], final_sz
        elif "bottom" in corner and "left" in corner:
            return [0, h - measured_h, measured_w, measured_h], final_sz
        elif "bottom" in corner and "right" in corner:
            return [w - measured_w, h - measured_h, measured_w, measured_h], final_sz
        return None, patch_size

    def _append_audit_events(self, events: list[AuditEvent]) -> None:
        audit_file = Path(settings.DATA_DIR) / "audit" / "image_events.jsonl"
        audit_file.parent.mkdir(parents=True, exist_ok=True)
        with audit_file.open("a", encoding="utf-8") as stream:
            for event in events:
                stream.write(canonical_json_dumps(event.model_dump(mode="json")) + "\n")

    def _previous_hashes(self) -> dict[str, set[str]]:
        audit_file = Path(settings.DATA_DIR) / "audit" / "image_events.jsonl"
        previous: dict[str, set[str]] = {}
        if not audit_file.is_file():
            return previous
        with audit_file.open("r", encoding="utf-8") as stream:
            for line in stream:
                try:
                    event = AuditEvent(**json.loads(line))
                except Exception:
                    continue
                previous.setdefault(event.artifact_id, set()).add(event.sha256_hash)
        return previous

    def _aggregate_contributor_risk(
        self,
        manifest: BatchManifest,
        findings: list[IntegrityFinding],
    ) -> list[ContributorRisk]:
        """Aggregate findings by contributor. Only when contributor identity exists."""
        contributor_id = manifest.contributor_id
        if not contributor_id or contributor_id == "UNKNOWN":
            # Do not produce risk score from fabricated identity
            return []

        severity_dist: dict[str, int] = defaultdict(int)
        finding_types: set[str] = set()
        risk_indicators: list[str] = []

        for f in findings:
            severity_dist[f.severity.value] += 1
            finding_types.add(f.check_type.value)

        if severity_dist.get("CRITICAL", 0) > 0:
            risk_indicators.append("CRITICAL_FINDINGS_PRESENT")
        if severity_dist.get("HIGH", 0) > 3:
            risk_indicators.append("HIGH_FINDING_CONCENTRATION")

        return [ContributorRisk(
            contributor_id=contributor_id,
            sample_count=len(manifest.samples),
            finding_count=len(findings),
            finding_types=sorted(finding_types),
            severity_distribution=dict(severity_dist),
            risk_indicators=risk_indicators,
        )]

    def scan(
        self,
        manifest: BatchManifest,
        duplicate_threshold: int = 4,
        trigger_detection_enabled: bool = True,
        ood_reference_stats: Optional[dict] = None,
    ) -> DatasetIntegrityReport:
        """Run all integrity checks and synthesize an actionable integrity report."""
        findings: list[IntegrityFinding] = []

        # 1. Exact & Near Duplicate Detection
        findings.extend(self.duplicate_detector.detect(manifest.samples, duplicate_threshold))

        # 2. Label Inconsistency + Missing Labels + Malformed Annotations
        findings.extend(self.label_detector.detect(manifest.samples))
        # Cleanlab Confident Learning Label Quality & Noise Detection
        findings.extend(self.cleanlab_detector.detect(manifest.samples))

        # 3. Quality Detection (variance, aspect ratio, corruption)
        findings.extend(self.quality_detector.detect(manifest.samples))

        # 4. OOD Detection (reference-based only; UNAVAILABLE without reference)
        # The OOD detector returns empty findings when reference_stats is None.
        # The scan pipeline (scan.py) reports UNAVAILABLE for this component.
        findings.extend(self.ood_detector.detect(manifest.samples, ood_reference_stats))

        # 5. Trigger Candidate Detection
        if trigger_detection_enabled:
            findings.extend(self.trigger_detector.detect(manifest.samples))

        findings_by_sample: dict[str, list[IntegrityFinding]] = {sample.sample_id: [] for sample in manifest.samples}
        for finding in findings:
            for sample_id in finding.sample_ids:
                findings_by_sample.setdefault(sample_id, []).append(finding)

        # Precompute perceptual dhashes and mirrored dhashes for near-duplicate cross-referencing
        sample_dhashes: dict[str, str] = {}
        sample_flip_dhashes: dict[str, str] = {}
        for s in manifest.samples:
            try:
                from PIL import Image as PILImage, ImageOps
                from app.integrity.detectors import compute_dhash
                with PILImage.open(s.file_path) as im:
                    sample_dhashes[s.sample_id] = compute_dhash(im)
                    sample_flip_dhashes[s.sample_id] = compute_dhash(ImageOps.mirror(im))
            except Exception:
                pass

        def are_near_duplicates(sid1: str, sid2: str) -> bool:
            if sid1 == sid2:
                return True
            for f in findings:
                if f.check_type.value in ("NEAR_DUPLICATE", "EXACT_DUPLICATE"):
                    if sid1 in f.sample_ids and sid2 in f.sample_ids:
                        return True
            dh1 = sample_dhashes.get(sid1)
            dh2 = sample_dhashes.get(sid2)
            dh2_flip = sample_flip_dhashes.get(sid2)
            if dh1 and dh2:
                try:
                    from app.integrity.detectors import hamming_distance
                    if hamming_distance(dh1, dh2) <= 10:
                        return True
                    if dh2_flip and hamming_distance(dh1, dh2_flip) <= 10:
                        return True
                except Exception:
                    pass
            return False

        image_results: list[ImageAssessment] = []
        audit_events: list[AuditEvent] = []
        previous_hashes = self._previous_hashes()
        for sample in manifest.samples:
            sample_findings = findings_by_sample.get(sample.sample_id, [])
            changed_fingerprint = bool(previous_hashes.get(sample.sample_id) and sample.sha256_hash not in previous_hashes[sample.sample_id])

            # ── Classify trigger findings: only count a trigger against THIS image
            # if it is confirmed on this specific image (isolated patch detection)
            # or if it matches across non-near-duplicate images.
            # Requirement 6: "Do not count shared content across near-duplicates as a trigger."
            has_own_trigger = False
            trigger_findings_on_self = []
            for finding in sample_findings:
                if finding.check_type.value not in ("TRIGGER_CANDIDATE", "TRIGGER_BACKDOOR"):
                    continue

                other_samples = [sid for sid in finding.sample_ids if sid != sample.sample_id]
                if other_samples:
                    # If EVERY other sample matching this patch is a near-duplicate of this image,
                    # this is shared image content between near-duplicates, NOT an injected trigger.
                    if all(are_near_duplicates(sample.sample_id, other_sid) for other_sid in other_samples):
                        continue

                has_own_trigger = True
                trigger_findings_on_self.append(finding)

            # Filter effective findings for this sample (exclude trigger candidates that are only shared near-dup content)
            effective_findings = [
                f for f in sample_findings
                if f.check_type.value not in ("TRIGGER_CANDIDATE", "TRIGGER_BACKDOOR")
            ] + trigger_findings_on_self

            critical = [
                finding for finding in effective_findings
                if finding.severity in (IntegritySeverity.CRITICAL, IntegritySeverity.HIGH)
            ]
            medium = [finding for finding in effective_findings if finding.severity == IntegritySeverity.MEDIUM]
            non_dup_findings = [
                f for f in effective_findings
                if f.check_type.value not in ("NEAR_DUPLICATE", "EXACT_DUPLICATE")
            ]
            dup_only_findings = [
                f for f in effective_findings
                if f.check_type.value in ("NEAR_DUPLICATE", "EXACT_DUPLICATE")
            ]

            if critical:
                result = "POISONED / ALTERED"
                integrity_status = "FAIL"
                trust_status = "UNTRUSTED"
                action = "QUARANTINE"
            elif changed_fingerprint or medium or non_dup_findings:
                result = "SUSPICIOUS"
                integrity_status = "REVIEW REQUIRED"
                trust_status = "UNTRUSTED"
                action = "QUARANTINE"
            elif dup_only_findings:
                # Clean original that only has near-duplicate copies
                result = "NEAR-DUPLICATE"
                integrity_status = "PASS"
                trust_status = "VERIFIED"
                action = "ALLOW"
            else:
                result = "REAL / CLEAN"
                integrity_status = "PASS"
                trust_status = "VERIFIED"
                action = "ALLOW"

            # ── Build per-image trigger patch locations ──
            trigger_patches: list[TriggerPatchLocation] = []
            seen_patch_keys: set[str] = set()
            for tf in trigger_findings_on_self:
                det = tf.details
                corner = det.get("corner")
                region = det.get("region")
                coords = det.get("spatial_coordinates")
                patch_sz = det.get("patch_size") or 4
                method = det.get("detection_method", "corner_patch")
                t_tag = det.get("trigger_tag")
                # For corner detections, synthesize coordinates and measure actual extent
                if corner and not coords:
                    coords, measured_sz = self._corner_to_coords(corner, patch_sz, sample.file_path)
                    if measured_sz:
                        patch_sz = measured_sz

                key = f"{corner}:{region}:{coords}"
                if key in seen_patch_keys:
                    continue
                seen_patch_keys.add(key)

                trigger_patches.append(TriggerPatchLocation(
                    corner=corner,
                    region=region,
                    coordinates=coords,
                    patch_size=patch_sz,
                    detection_method=method,
                    trigger_tag=t_tag,
                ))

            # ── Merge overlapping patch windows and deduplicate evidence ──
            raw_evidence = (
                (["SHA-256 fingerprint changed since a previous upload."] if changed_fingerprint else [])
                + [finding.description for finding in effective_findings]
            )
            evidence_all = _deduplicate_evidence(raw_evidence)
            evidence_top3 = evidence_all[:3]

            # ── Build summary line ──
            summary_parts = []
            dup_count = sum(
                len(f.sample_ids) - 1 for f in effective_findings
                if f.check_type.value in ("NEAR_DUPLICATE", "EXACT_DUPLICATE")
            )
            if dup_count > 0:
                summary_parts.append(f"Near-duplicate of {dup_count} image{'s' if dup_count > 1 else ''}")
            if trigger_patches:
                locs = []
                for tp in trigger_patches:
                    if tp.corner:
                        locs.append(tp.corner.replace("_", "-"))
                    elif tp.region:
                        locs.append(tp.region)
                    else:
                        locs.append("interior")
                loc_str = ", ".join(dict.fromkeys(locs))  # deduplicate
                summary_parts.append(f"{len(trigger_patches)} suspicious patch{'es' if len(trigger_patches) > 1 else ''} ({loc_str})")
            non_trigger_non_dup = [
                f for f in effective_findings
                if f.check_type.value not in ("NEAR_DUPLICATE", "EXACT_DUPLICATE", "TRIGGER_CANDIDATE", "TRIGGER_BACKDOOR")
            ]
            if non_trigger_non_dup:
                summary_parts.append(f"{len(non_trigger_non_dup)} other finding{'s' if len(non_trigger_non_dup) > 1 else ''}")
            if not summary_parts:
                evidence_summary = "No integrity anomaly detected."
            else:
                evidence_summary = "; ".join(summary_parts) + "."

            score = max((finding.metric_score for finding in sample_findings), default=None)
            image_results.append(ImageAssessment(
                sample_id=sample.sample_id,
                file_name=Path(sample.file_path).name,
                sha256_hash=sample.sha256_hash,
                result=result,
                integrity_status=integrity_status,
                trust_status=trust_status,
                anomaly_score=score,
                evidence_summary=evidence_summary,
                evidence=evidence_top3,
                evidence_full=evidence_all,
                trigger_patches=trigger_patches,
                action=action,
                preview_data_url=self._preview_data_url(Path(sample.file_path)),
            ))
            audit_events.extend([
                AuditEvent(
                    timestamp=manifest.created_at,
                    artifact_id=sample.sample_id,
                    sha256_hash=sample.sha256_hash,
                    detection_result=result,
                    integrity_status=integrity_status,
                    reason="; ".join(image_results[-1].evidence) or "Uploaded artifact verified by integrity pipeline.",
                    action="UPLOADED",
                    contributor_id=manifest.contributor_id,
                ),
                AuditEvent(
                    timestamp=manifest.created_at,
                    artifact_id=sample.sample_id,
                    sha256_hash=sample.sha256_hash,
                    detection_result=result,
                    integrity_status=integrity_status,
                    reason="; ".join(image_results[-1].evidence) or "No integrity findings detected.",
                    action="VERIFIED",
                    contributor_id=manifest.contributor_id,
                ),
            ])
        self._append_audit_events(audit_events)

        # Compute Health Score
        health_score = 1.0
        for f in findings:
            penalty = PENALTY_WEIGHTS.get(f.severity, 0.05)
            health_score -= penalty

        health_score = round(max(0.0, min(1.0, health_score)), 4)

        # Disposition Recommendation
        if health_score >= 0.85:
            recommendation = AssetStatus.ACCEPTED
        elif health_score >= 0.60:
            recommendation = AssetStatus.UNDER_REVIEW
        else:
            recommendation = AssetStatus.QUARANTINED

        # Phase 3: Contributor Risk Aggregation
        contributor_risks = self._aggregate_contributor_risk(manifest, findings)

        # Construct Report
        report_data = {
            "batch_id": manifest.batch_id,
            "total_samples_analyzed": len(manifest.samples),
            "findings_count": len(findings),
            "findings": [f.model_dump(mode="json") for f in findings],
            "overall_health_score": health_score,
            "recommendation": recommendation.value,
            "image_results": [image.model_dump(mode="json") for image in image_results],
        }
        report_digest = canonical_json_hash(report_data)

        report = DatasetIntegrityReport(
            batch_id=manifest.batch_id,
            total_samples_analyzed=len(manifest.samples),
            findings_count=len(findings),
            findings=findings,
            overall_health_score=health_score,
            recommendation=recommendation,
            report_digest=report_digest,
            image_results=image_results,
            audit_events=audit_events,
            contributor_risks=contributor_risks,
        )

        # Persist report canonically to disk
        report_file = self.reports_dir / f"integrity_{manifest.batch_id}.json"
        with open(report_file, "w", encoding="utf-8") as f:
            f.write(canonical_json_dumps(report.model_dump(mode="json")))

        return report

    def load_report(self, batch_id: str) -> Optional[DatasetIntegrityReport]:
        """Load an existing integrity report from disk by batch_id."""
        report_file = self.reports_dir / f"integrity_{batch_id}.json"
        if not report_file.is_file():
            return None

        with open(report_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        return DatasetIntegrityReport(**data)


default_integrity_engine = DataIntegrityEngine()
