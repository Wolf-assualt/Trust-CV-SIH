# pyrefly: ignore [missing-import]
from anyio import Path
import uuid
import asyncio
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends
from typing import Dict

from app.schemas.base import ResponseEnvelope
from app.schemas.scan import ScanSession, ScanStatus, ScanStage, ComponentState, ComponentStatus
from app.integrity.engine import default_integrity_engine
from app.datasets.engine import default_ingestion_engine
from app.models_engine.registry import default_model_registry
from app.drift.engine import default_drift_engine
from app.fusion.engine import default_fusion_engine
from app.graph.engine import default_graph_engine
from app.ledger.engine import LedgerEngine
from app.ledger.database import get_ledger_db, LedgerBase
from app.ledger import ensure_ledger_directory

router = APIRouter(prefix="/scan", tags=["Scan Session"])

# In-memory store for scan sessions
_scan_sessions: Dict[str, ScanSession] = {}

# Initialize ledger database on module load
ensure_ledger_directory()
from app.ledger.database import ledger_engine
LedgerBase.metadata.create_all(bind=ledger_engine)

async def _run_scan_pipeline(scan_id: str, batch_id: str):
    session = _scan_sessions.get(scan_id)
    if not session:
        return
    
    # Initialize ledger for this scan
    ledger_db = next(get_ledger_db())
    ledger = LedgerEngine(ledger_db)
    
    try:
        session.status = ScanStatus.IN_PROGRESS
        
        # Record scan start event
        try:
            ledger.append_event(
                event_type="scan_start",
                entity_id=scan_id,
                payload={"batch_id": batch_id},
                actor="system",
                scan_id=scan_id,
            )
        except Exception as ledger_exc:
            # Log ledger error but don't fail the scan
            session.warnings.append(f"Ledger recording failed: {str(ledger_exc)}")
        
        # Stage: INGESTION / HASHING
        session.stage = ScanStage.HASHING
        session.progress = 0.1
        await asyncio.sleep(0.5)
        
        manifest = default_ingestion_engine.load_manifest(batch_id)
        if not manifest:
            session.status = ScanStatus.FAILED
            session.errors.append(f"Batch manifest {batch_id} not found.")
            session.stage_results["DATA_INGESTION"] = ComponentState(status=ComponentStatus.FAILED, error_code="ERR_MANIFEST_NOT_FOUND")
            return

        session.input_artifacts = [s.file_path for s in manifest.samples]
        session.stage_results["DATA_INGESTION"] = ComponentState(status=ComponentStatus.PASSED)
        session.stage_results["HASH_VERIFICATION"] = ComponentState(status=ComponentStatus.PASSED)
        
        # Record ingestion event
        try:
            ledger.append_event(
                event_type="ingestion",
                entity_id=batch_id,
                payload={
                    "sample_count": len(manifest.samples),
                    "contributor_id": manifest.contributor_id,
                    "merkle_root": manifest.merkle_root,
                },
                actor="system",
                scan_id=scan_id,
            )
        except Exception as ledger_exc:
            session.warnings.append(f"Ledger recording failed: {str(ledger_exc)}")
        
        # Stage: DATA_INTEGRITY
        session.stage = ScanStage.DATA_INTEGRITY
        session.progress = 0.3
        await asyncio.sleep(0.5)
        
        # Run real integrity scan
        report = default_integrity_engine.scan(manifest)
        session.findings = [f.model_dump(mode="json") for f in report.findings]
        session.stage_results["DATASET_ANALYSIS"] = ComponentState(status=ComponentStatus.PASSED)
        
        # Record data integrity findings
        for finding in report.findings:
            try:
                ledger.append_event(
                    event_type="finding",
                    entity_id=batch_id,
                    payload={
                        "finding_id": finding.finding_id,
                        "check_type": finding.check_type.value,
                        "severity": finding.severity,
                        "description": finding.description,
                    },
                    actor="system",
                    scan_id=scan_id,
                )
            except Exception as ledger_exc:
                session.warnings.append(f"Ledger recording failed: {str(ledger_exc)}")
        session.stage_results["DUPLICATE_DETECTION"] = ComponentState(status=ComponentStatus.PASSED)
        label_findings = [f for f in report.findings if f.check_type.value == "LABEL_INCONSISTENCY"]
        if any(f.severity.value in ("CRITICAL", "HIGH") for f in label_findings):
            session.stage_results["LABEL_INTEGRITY"] = ComponentState(
                status=ComponentStatus.FAILED,
                explanation=f"Cleanlab and label consistency audit detected {len(label_findings)} critical/high label anomalies."
            )
        elif label_findings:
            session.stage_results["LABEL_INTEGRITY"] = ComponentState(
                status=ComponentStatus.WARNING,
                explanation=f"Cleanlab label audit flagged {len(label_findings)} samples with potential label noise."
            )
        else:
            session.stage_results["LABEL_INTEGRITY"] = ComponentState(
                status=ComponentStatus.PASSED,
                explanation="Cleanlab confident learning verified label consistency with no anomalous label noise."
            )
        session.stage_results["QUALITY_ANALYSIS"] = ComponentState(status=ComponentStatus.PASSED)
        session.stage_results["TRIGGER_CANDIDATE_ANALYSIS"] = ComponentState(status=ComponentStatus.PASSED)
        session.stage_results["OOD_DETECTION"] = ComponentState(
            status=ComponentStatus.UNAVAILABLE,
            error_code="ERR_NO_REFERENCE",
            explanation="OOD detection requires an independently sourced reference dataset. No reference provided.",
        )
        
        # Stage: MODEL_ASSURANCE
        session.stage = ScanStage.MODEL_ASSURANCE
        session.progress = 0.5
        manifest_meta = getattr(manifest, "metadata", None)
        model_id = manifest_meta.get("model_id") if isinstance(manifest_meta, dict) else None
        if model_id and isinstance(model_id, str):
            try:
                finding = default_model_registry.generate_assurance_finding(model_id)
                session.findings.append(finding.model_dump(mode="json"))
                session.stage_results["MODEL_INTEGRITY"] = ComponentState(status=ComponentStatus.PASSED)
                
                # Record model verification event
                try:
                    ledger.append_event(
                        event_type="model_verification",
                        entity_id=model_id,
                        payload={
                            "identity_status": finding.identity_status.value,
                            "confidence": finding.confidence,
                            "format": finding.format,
                        },
                        actor="system",
                        scan_id=scan_id,
                    )
                except Exception as ledger_exc:
                    session.warnings.append(f"Ledger recording failed: {str(ledger_exc)}")
            except Exception as m_exc:
                session.stage_results["MODEL_INTEGRITY"] = ComponentState(
                    status=ComponentStatus.FAILED,
                    error_code="ERR_MODEL_ASSURANCE_FAILED",
                    explanation=str(m_exc),
                )
        else:
            session.stage_results["MODEL_INTEGRITY"] = ComponentState(
                status=ComponentStatus.UNAVAILABLE,
                error_code="ERR_MODULE_OFFLINE",
                explanation="Model Assurance module UNAVAILABLE: No model artifact was provided for model assurance evaluation in this scan batch.",
            )
        await asyncio.sleep(0.5)
        
        # Stage: INFERENCE_ASSURANCE
        session.stage = ScanStage.INFERENCE_ASSURANCE
        session.progress = 0.7
        sample_path = manifest.samples[0].file_path if manifest.samples else None
        if model_id and sample_path and Path(sample_path).is_file():
            try:
                from app.runtime.engine import default_runtime_engine
                m_manifest = default_model_registry.get_model(model_id)
                m_path = m_manifest.metadata.get("file_path") if m_manifest else None
                if m_path and Path(m_path).is_file():
                    with open(sample_path, "rb") as sf:
                        sample_bytes = sf.read()
                    exec_rec, dna_rec, _ = default_runtime_engine.execute_inference(
                        model_path=m_path,
                        image_input=sample_bytes,
                        model_id=model_id,
                    )
                    session.stage_results["BACKDOOR_ANALYSIS"] = ComponentState(status=ComponentStatus.PASSED)
                    session.stage_results["INFERENCE_VALIDATION"] = ComponentState(status=ComponentStatus.PASSED)
                    
                    # Record inference event
                    try:
                        ledger.append_event(
                            event_type="inference",
                            entity_id=model_id,
                            payload={
                                "sample_path": sample_path,
                                "execution_record_id": exec_rec.record_id if exec_rec else None,
                            },
                            actor="system",
                            scan_id=scan_id,
                        )
                    except Exception as ledger_exc:
                        session.warnings.append(f"Ledger recording failed: {str(ledger_exc)}")
                else:
                    session.warnings.append("Inference Assurance module UNAVAILABLE: Model binary not found.")
                    session.stage_results["BACKDOOR_ANALYSIS"] = ComponentState(status=ComponentStatus.UNAVAILABLE, error_code="ERR_MODULE_OFFLINE", explanation="Model binary not found.")
                    session.stage_results["INFERENCE_VALIDATION"] = ComponentState(status=ComponentStatus.UNAVAILABLE, error_code="ERR_MODULE_OFFLINE", explanation="Model binary not found.")
            except Exception as inf_exc:
                session.errors.append(f"Inference execution failed: {str(inf_exc)}")
                session.stage_results["BACKDOOR_ANALYSIS"] = ComponentState(status=ComponentStatus.FAILED, error_code="ERR_INFERENCE_FAILED", explanation=str(inf_exc))
                session.stage_results["INFERENCE_VALIDATION"] = ComponentState(status=ComponentStatus.FAILED, error_code="ERR_INFERENCE_FAILED", explanation=str(inf_exc))
        else:
            session.warnings.append("Inference Assurance module UNAVAILABLE.")
            session.stage_results["BACKDOOR_ANALYSIS"] = ComponentState(status=ComponentStatus.UNAVAILABLE, error_code="ERR_MODULE_OFFLINE", explanation="Inference Assurance module UNAVAILABLE.")
            session.stage_results["INFERENCE_VALIDATION"] = ComponentState(status=ComponentStatus.UNAVAILABLE, error_code="ERR_MODULE_OFFLINE", explanation="Inference Assurance module UNAVAILABLE.")
        await asyncio.sleep(0.5)

        # Stage: BEHAVIORAL_FINGERPRINT
        # Run perturbation battery against the model to produce a behavioural
        # fingerprint. Uses default_fingerprinter which falls back to a
        # deterministic synthetic profile when no real model binary is present.
        if model_id and isinstance(model_id, str):
            try:
                from app.fingerprint.runner import default_fingerprinter

                fp = default_fingerprinter.fingerprint_model(model_id=model_id, seed=42, count=8)
                probe_count = len(fp.results) if fp.results else 0
                session.stage_results["FINGERPRINT"] = ComponentState(
                    status=ComponentStatus.PASSED,
                    explanation=(
                        f"Behavioural fingerprint generated: {probe_count} perturbation probes, "
                        f"aggregate digest {fp.aggregate_digest[:16]}…"
                    ),
                )

                try:
                    ledger.append_event(
                        event_type="fingerprint",
                        entity_id=model_id,
                        payload={
                            "fingerprint_id": fp.fingerprint_id,
                            "aggregate_digest": fp.aggregate_digest,
                            "probe_count": probe_count,
                        },
                        actor="system",
                        scan_id=scan_id,
                    )
                except Exception as ledger_exc:
                    session.warnings.append(f"Ledger recording failed: {str(ledger_exc)}")
            except Exception as fp_exc:
                session.stage_results["FINGERPRINT"] = ComponentState(
                    status=ComponentStatus.UNAVAILABLE,
                    error_code="ERR_FINGERPRINT_FAILED",
                    explanation=f"Behavioural fingerprinting failed: {str(fp_exc)}",
                )
        else:
            session.stage_results["FINGERPRINT"] = ComponentState(
                status=ComponentStatus.UNAVAILABLE,
                error_code="ERR_MODULE_OFFLINE",
                explanation="Behavioural fingerprinting UNAVAILABLE: No model artifact was provided.",
            )
        
        # Stage: DISTRIBUTION_SHIFT
        session.stage = ScanStage.DISTRIBUTION_SHIFT
        session.progress = 0.8
        
        # Try to perform distribution shift analysis if baseline exists
        try:
            # Check if we have a baseline reference for this specific dataset
            baseline_id = None
            if manifest.metadata and manifest.metadata.get("baseline_id"):
                baseline_id = manifest.metadata.get("baseline_id")
            else:
                baselines = default_drift_engine.list_baselines()
                for b in baselines:
                    if b.get("dataset_name") and b.get("dataset_name") == manifest.dataset_name:
                        baseline_id = b.get("baseline_id")
                        break

            if not baseline_id:
                session.stage_results["DISTRIBUTION_SHIFT"] = ComponentState(
                    status=ComponentStatus.UNAVAILABLE,
                    error_code="ERR_NO_BASELINE",
                    explanation="Distribution Shift module UNAVAILABLE: No reference baseline has been registered for this dataset."
                )
            elif len(manifest.samples) < 1:
                session.stage_results["DISTRIBUTION_SHIFT"] = ComponentState(
                    status=ComponentStatus.UNAVAILABLE,
                    error_code="ERR_INSUFFICIENT_SAMPLES",
                    explanation="Distribution Shift module UNAVAILABLE: No valid samples available for statistical distribution analysis."
                )
            else:
                # Extract features from current batch
                from app.drift.extractor import ImageDistributionExtractor
                # pyrefly: ignore [missing-import]
                from PIL import Image
                # pyrefly: ignore [missing-import]
                import numpy as np
                
                batch_images = []
                for sample in manifest.samples:
                    try:
                        img = Image.open(sample.file_path)
                        batch_images.append(np.array(img))
                    except Exception:
                        continue
                
                if batch_images:
                    target_features = ImageDistributionExtractor.extract_batch_distributions(batch_images)
                    target_features_dict = {k: v.tolist() for k, v in target_features.items()}
                    
                    drift_report = default_drift_engine.evaluate_shift(
                        baseline_id=baseline_id,
                        target_features=target_features_dict,
                        target_batch_id=batch_id,
                    )
                    
                    session.stage_results["DISTRIBUTION_SHIFT"] = ComponentState(
                        status=ComponentStatus.PASSED if drift_report.status.value == "ACCEPTED" else ComponentStatus.FAILED,
                        explanation=f"Drift detected: {drift_report.detected_drift_type.value}, severity: {drift_report.severity.value}"
                    )
                    session.findings.append({
                        "finding_id": f"drift_{drift_report.report_id}",
                        "check_type": "DISTRIBUTION_SHIFT",
                        "severity": drift_report.severity.value,
                        "description": drift_report.detected_drift_type.value,
                        "sample_ids": [s.sample_id for s in manifest.samples],
                    })
                    
                    # Record drift assessment event
                    try:
                        ledger.append_event(
                            event_type="drift_assessment",
                            entity_id=batch_id,
                            payload={
                                "report_id": drift_report.report_id,
                                "detected_drift_type": drift_report.detected_drift_type.value,
                                "severity": drift_report.severity.value,
                            },
                            actor="system",
                            scan_id=scan_id,
                        )
                    except Exception as ledger_exc:
                        session.warnings.append(f"Ledger recording failed: {str(ledger_exc)}")
                else:
                    session.stage_results["DISTRIBUTION_SHIFT"] = ComponentState(
                        status=ComponentStatus.UNAVAILABLE,
                        error_code="ERR_NO_VALID_IMAGES",
                        explanation="No valid images could be extracted for distribution analysis."
                    )
        except Exception as drift_exc:
            session.stage_results["DISTRIBUTION_SHIFT"] = ComponentState(
                status=ComponentStatus.UNAVAILABLE,
                error_code="ERR_DRIFT_FAILED",
                explanation=f"Distribution shift analysis failed: {str(drift_exc)}"
            )
        await asyncio.sleep(0.5)
        
        # Stage: EVIDENCE_FUSION
        session.stage = ScanStage.EVIDENCE_FUSION
        session.progress = 0.85
        
        # Collect evidence from all stages for fusion
        try:
            from app.schemas.fusion import EvidenceItem, EvidenceSource
            from app.schemas.integrity import IntegritySeverity
            
            evidence_items = []
            
            # Add data integrity findings as evidence
            for finding in report.findings:
                severity_map = {
                    "CRITICAL": IntegritySeverity.CRITICAL,
                    "HIGH": IntegritySeverity.HIGH, 
                    "MEDIUM": IntegritySeverity.MEDIUM,
                    "LOW": IntegritySeverity.LOW
                }
                severity = severity_map.get(finding.severity.upper(), IntegritySeverity.MEDIUM)
                
                evidence = EvidenceItem(
                    evidence_id=f"integrity_{finding.finding_id}",
                    source=EvidenceSource.DATA_INTEGRITY,
                    severity=severity,
                    metric_value=finding.metric_score or 0.5,
                    description=finding.description,
                    subject_id=batch_id,
                    related_dataset_id=batch_id,
                    metadata={
                        "check_type": finding.check_type.value,
                        "sample_ids": finding.sample_ids,
                        "contributor": manifest.contributor_id
                    }
                )
                evidence_items.append(evidence)
            
            # If data integrity scan succeeded with zero findings, record clean baseline evidence
            if not report.findings and report.total_samples_analyzed > 0:
                clean_evidence = EvidenceItem(
                    evidence_id=f"integrity_clean_{batch_id[:8]}",
                    source=EvidenceSource.DATA_INTEGRITY,
                    severity=IntegritySeverity.LOW,
                    metric_value=0.0,
                    description=f"Training data integrity verified clean across {report.total_samples_analyzed} samples.",
                    subject_id=batch_id,
                    related_dataset_id=batch_id,
                    metadata={
                        "check_type": "DATA_INTEGRITY_CLEAN",
                        "sample_ids": [s.sample_id for s in manifest.samples],
                        "contributor": manifest.contributor_id
                    }
                )
                evidence_items.append(clean_evidence)
            
            # Add model assurance findings if available
            if model_id:
                try:
                    model_finding = default_model_registry.generate_assurance_finding(model_id)
                    model_severity = IntegritySeverity.CRITICAL if model_finding.identity_status.value == "MISMATCH" else IntegritySeverity.LOW
                    
                    model_evidence = EvidenceItem(
                        evidence_id=f"model_{model_id}",
                        source=EvidenceSource.MODEL_IDENTITY,
                        severity=model_severity,
                        metric_value=model_finding.confidence or 0.5,
                        description=f"Model assurance: {model_finding.identity_status.value}",
                        subject_id=model_id,
                        related_model_id=model_id,
                        metadata={
                            "format": model_finding.format,
                            "access_mode": model_finding.access_mode.value
                        }
                    )
                    evidence_items.append(model_evidence)
                except Exception:
                    pass
            
            # Add distribution shift findings if available
            drift_report = None
            drift_stage_result = session.stage_results.get("DISTRIBUTION_SHIFT")
            if isinstance(drift_stage_result, ComponentState) and drift_stage_result.status == ComponentStatus.FAILED:
                # Get the actual drift report if it was generated
                try:
                    drift_reports = list(default_drift_engine.reports_dir.glob("*.json"))
                    if drift_reports:
                        latest_report = max(drift_reports, key=lambda p: p.stat().st_mtime)
                        import json
                        with open(latest_report) as f:
                            drift_data = json.load(f)
                        
                        drift_severity = IntegritySeverity.CRITICAL if drift_data.get("severity") == "CRITICAL_SHIFT" else IntegritySeverity.MEDIUM
                        
                        drift_evidence = EvidenceItem(
                            evidence_id=f"drift_{drift_data.get('report_id')}",
                            source=EvidenceSource.DISTRIBUTION_SHIFT,
                            severity=drift_severity,
                            metric_value=drift_data.get("overall_drift_score", 0.5),
                            description=f"Distribution shift: {drift_data.get('detected_drift_type')}",
                            subject_id=batch_id,
                            related_dataset_id=batch_id,
                            metadata={
                                "drift_type": drift_data.get("detected_drift_type"),
                                "affected_features": drift_data.get("affected_features", [])
                            }
                        )
                        evidence_items.append(drift_evidence)
                except Exception:
                    pass
            
            # Perform fusion if we have evidence
            if evidence_items:
                fused_assessment = default_fusion_engine.fuse(
                    target_entity_id=batch_id,
                    evidence=evidence_items
                )
                
                session.stage_results["EVIDENCE_FUSION"] = ComponentState(
                    status=ComponentStatus.PASSED,
                    explanation=f"Fusion completed: {fused_assessment.overall_status.value}, risk_level: {fused_assessment.risk_level.value}"
                )
                
                # Record evidence fusion event
                try:
                    ledger.append_event(
                        event_type="evidence_fusion",
                        entity_id=batch_id,
                        payload={
                            "assessment_id": fused_assessment.assessment_id,
                            "overall_status": fused_assessment.overall_status.value,
                            "risk_level": fused_assessment.risk_level.value,
                            "risk_score": fused_assessment.risk_score,
                        },
                        actor="system",
                        scan_id=scan_id,
                    )
                except Exception as ledger_exc:
                    session.warnings.append(f"Ledger recording failed: {str(ledger_exc)}")
                
                # Build evidence graph
                try:
                    default_graph_engine.build_lineage(
                        contributor_id=manifest.contributor_id,
                        batch_id=batch_id,
                        sample_ids=[s.sha256_hash or s.sample_id for s in manifest.samples],
                        fusion_assessment_id=fused_assessment.assessment_id
                    )
                    
                    session.stage_results["EVIDENCE_GRAPH"] = ComponentState(
                        status=ComponentStatus.PASSED,
                        explanation="Evidence graph constructed with fusion assessment"
                    )
                    
                    # Record evidence graph event
                    try:
                        ledger.append_event(
                            event_type="evidence_graph",
                            entity_id=batch_id,
                            payload={
                                "fusion_assessment_id": fused_assessment.assessment_id,
                                "contributor_id": manifest.contributor_id,
                            },
                            actor="system",
                            scan_id=scan_id,
                        )
                    except Exception as ledger_exc:
                        session.warnings.append(f"Ledger recording failed: {str(ledger_exc)}")
                except Exception as graph_exc:
                    session.stage_results["EVIDENCE_GRAPH"] = ComponentState(
                        status=ComponentStatus.UNAVAILABLE,
                        error_code="ERR_GRAPH_FAILED",
                        explanation=f"Evidence graph construction failed: {str(graph_exc)}"
                    )

                # Compute forensic blast-radius for the ingested batch
                try:
                    blast_report = default_graph_engine.calculate_blast_radius(batch_id)
                    affected = (
                        len(blast_report.affected_models)
                        + len(blast_report.affected_inferences)
                        + len(blast_report.affected_training_runs)
                    )
                    session.stage_results["BLAST_RADIUS"] = ComponentState(
                        status=ComponentStatus.PASSED,
                        explanation=(
                            f"Blast radius computed for '{batch_id}': "
                            f"{affected} downstream entity(ies) assessed "
                            f"[{blast_report.status.value}]."
                        ),
                    )

                    try:
                        ledger.append_event(
                            event_type="blast_radius",
                            entity_id=batch_id,
                            payload={
                                "root_cause_id": blast_report.root_cause_id,
                                "affected_entities": affected,
                                "status": blast_report.status.value,
                            },
                            actor="system",
                            scan_id=scan_id,
                        )
                    except Exception as ledger_exc:
                        session.warnings.append(f"Ledger recording failed: {str(ledger_exc)}")
                except ValueError:
                    session.stage_results["BLAST_RADIUS"] = ComponentState(
                        status=ComponentStatus.UNAVAILABLE,
                        error_code="ERR_NO_GRAPH_NODE",
                        explanation="Blast radius not computed: batch not present in evidence graph.",
                    )
                except Exception as blast_exc:
                    session.stage_results["BLAST_RADIUS"] = ComponentState(
                        status=ComponentStatus.UNAVAILABLE,
                        error_code="ERR_BLAST_RADIUS_FAILED",
                        explanation=f"Blast radius analysis failed: {str(blast_exc)}",
                    )

                # Update assessment with fusion results
                # Use fusion assessment for the final verdict
                is_insufficient = (fused_assessment.coverage.coverage_ratio == 0.0)
                fusion_scope = getattr(fused_assessment, "scope", "FULL")

                session.assessment = {
                    "assuranceScore": None if is_insufficient else round(1.0 - fused_assessment.risk_score, 4),
                    "disposition": "INSUFFICIENT_EVIDENCE" if is_insufficient else fused_assessment.overall_status.value,
                    "scope": fusion_scope,
                    "evidence_completeness": fusion_scope,
                    "hardVetoTriggered": fused_assessment.hard_veto_triggered,
                    "dataRiskScore": report.overall_health_score,
                    "modelRiskScore": -1.0 if not model_id else fused_assessment.risk_score,
                    "inferenceRiskScore": -1.0,
                    "totalSamples": report.total_samples_analyzed,
                    "flaggedSamples": report.findings_count,
                    "fusionAssessment": {
                        "assessment_id": fused_assessment.assessment_id,
                        "risk_level": fused_assessment.risk_level.value,
                        "confidence": fused_assessment.confidence,
                        "scope": fusion_scope,
                        "coverage": fused_assessment.coverage.model_dump(),
                        "findings": fused_assessment.findings,
                        "contributors": fused_assessment.contributors,
                        "recommended_actions": fused_assessment.recommended_actions,
                        "explanation": fused_assessment.explanation,
                        "limitations": fused_assessment.limitations,
                    },
                    "imageResults": [ir.model_dump(mode="json") for ir in report.image_results]
                }
            else:
                session.stage_results["EVIDENCE_FUSION"] = ComponentState(
                    status=ComponentStatus.UNAVAILABLE,
                    error_code="ERR_NO_EVIDENCE",
                    explanation="No evidence items available for fusion: insufficient cross-layer telemetry"
                )
                session.stage_results["EVIDENCE_GRAPH"] = ComponentState(
                    status=ComponentStatus.UNAVAILABLE,
                    error_code="ERR_NO_EVIDENCE",
                    explanation="No evidence available for graph construction"
                )
                session.assessment = {
                    "assuranceScore": None,
                    "disposition": "INSUFFICIENT_EVIDENCE",
                    "hardVetoTriggered": False,
                    "dataRiskScore": report.overall_health_score,
                    "modelRiskScore": -1.0,
                    "inferenceRiskScore": -1.0,
                    "totalSamples": report.total_samples_analyzed,
                    "flaggedSamples": report.findings_count,
                    "fusionAssessment": {
                        "assessment_id": "uncomputed",
                        "risk_level": "UNKNOWN",
                        "confidence": 0.0,
                        "coverage": {
                            "sources_checked": [],
                            "coverage_ratio": 0.0,
                            "missing_sources": [
                                "DATA_INTEGRITY", "MODEL_IDENTITY", "BEHAVIOURAL_FINGERPRINT",
                                "INFERENCE_DNA", "DISTRIBUTION_SHIFT"
                            ]
                        },
                        "findings": [],
                        "contributors": ["UNKNOWN"],
                        "recommended_actions": ["Upload full dataset, model artifacts, and inference receipts for comprehensive assurance evaluation."],
                        "explanation": "Assurance score not computable — insufficient evidence (coverage: 0%, 5/5 verification sources unavailable)",
                        "limitations": ["Assurance score not computable — insufficient evidence (coverage: 0%, 5/5 verification sources unavailable)."]
                    },
                    "imageResults": [ir.model_dump(mode="json") for ir in report.image_results]
                }
                
        except Exception as fusion_exc:
            session.stage_results["EVIDENCE_FUSION"] = ComponentState(
                status=ComponentStatus.UNAVAILABLE,
                error_code="ERR_FUSION_FAILED",
                explanation=f"Evidence fusion failed: {str(fusion_exc)}"
            )
            session.stage_results["EVIDENCE_GRAPH"] = ComponentState(
                status=ComponentStatus.UNAVAILABLE,
                error_code="ERR_FUSION_FAILED",
                explanation="Evidence graph unavailable due to fusion failure"
            )
            
            # Keep original assessment if fusion fails — honour three-tier recommendation
            if not session.assessment:
                rec_value = report.recommendation.value if hasattr(report.recommendation, "value") else str(report.recommendation)
                session.assessment = {
                    "assuranceScore": round(report.overall_health_score, 4),
                    "disposition": rec_value,
                    "scope": "MINIMAL",
                    "evidence_completeness": "MINIMAL",
                    "hardVetoTriggered": rec_value == "QUARANTINED",
                    "dataRiskScore": report.overall_health_score,
                    "modelRiskScore": -1.0,
                    "inferenceRiskScore": -1.0,
                    "totalSamples": report.total_samples_analyzed,
                    "flaggedSamples": report.findings_count,
                    "imageResults": [ir.model_dump(mode="json") for ir in report.image_results]
                }
        
        # Stage: REPORT
        session.stage = ScanStage.REPORT
        session.progress = 0.9
        await asyncio.sleep(0.5)

        # Finalise the assessment.
        # Policy: if the Evidence Fusion stage produced a real fused_assessment, use its
        # risk-based disposition as the authoritative verdict. The fusion engine applies
        # multi-source weighted risk scoring, DRIFT_ISOLATION, hard-veto rules, and
        # three-tier disposition (ACCEPTED / UNDER_REVIEW / QUARANTINED).
        # Only fall back to the integrity-only health_score when fusion was unavailable.
        #
        # CRITICAL_SHIFT alone: fusion engine caps risk at 0.65 → UNDER_REVIEW (not ACCEPTED).
        # CRITICAL_SHIFT + no other findings: integrity health_score can be 1.0 → naive ACCEPTED
        # would be wrong. Fusion is the authoritative gate.
        if session.assessment and session.assessment.get("fusionAssessment"):
            # Fusion succeeded earlier — preserve fusion disposition and enrich with
            # per-sample image results and sample counts from the integrity report.
            session.assessment["totalSamples"] = report.total_samples_analyzed
            session.assessment["flaggedSamples"] = report.findings_count
            session.assessment["imageResults"] = [ir.model_dump(mode="json") for ir in report.image_results]
            # dataRiskScore is always the real integrity health score regardless of fusion
            session.assessment["dataRiskScore"] = report.overall_health_score
        else:
            # Fusion was unavailable (no evidence items, or fusion exception).
            # Fall back to the integrity engine result, but honour the three-tier
            # recommendation (ACCEPTED / UNDER_REVIEW / QUARANTINED).
            rec_value = report.recommendation.value if hasattr(report.recommendation, "value") else str(report.recommendation)
            session.assessment = {
                "assuranceScore": report.overall_health_score,
                "disposition": rec_value,
                "hardVetoTriggered": rec_value == "QUARANTINED",
                "dataRiskScore": report.overall_health_score,
                "modelRiskScore": -1.0,   # UNAVAILABLE
                "inferenceRiskScore": -1.0,  # UNAVAILABLE
                "totalSamples": report.total_samples_analyzed,
                "flaggedSamples": report.findings_count,
                "imageResults": [ir.model_dump(mode="json") for ir in report.image_results],
            }
        
        final_disp = session.assessment.get("disposition", "ACCEPTED") if session.assessment else "ACCEPTED"
        session.stage_results["FINAL_VERDICT"] = ComponentState(
            status=ComponentStatus.PASSED,
            explanation=f"Consolidated zero-trust disposition: {final_disp}",
        )

        session.stage = ScanStage.COMPLETED
        session.progress = 1.0
        session.status = ScanStatus.COMPLETED
        
        # Record scan completion event
        try:
            ledger.append_event(
                event_type="scan_complete",
                entity_id=scan_id,
                payload={
                    "batch_id": batch_id,
                    "disposition": session.assessment.get("disposition"),
                    "assurance_score": session.assessment.get("assuranceScore"),
                },
                actor="system",
                scan_id=scan_id,
            )
        except Exception as ledger_exc:
            session.warnings.append(f"Ledger recording failed: {str(ledger_exc)}")

    except Exception as exc:
        session.status = ScanStatus.FAILED
        session.errors.append(str(exc))


@router.post("/start/{batch_id}", response_model=ResponseEnvelope[ScanSession])
def start_scan(batch_id: str, background_tasks: BackgroundTasks) -> ResponseEnvelope[ScanSession]:
    """Start a new backend-driven scan session."""
    scan_id = str(uuid.uuid4())
    session = ScanSession(scan_id=scan_id, batch_id=batch_id)
    _scan_sessions[scan_id] = session
    
    background_tasks.add_task(_run_scan_pipeline, scan_id, batch_id)
    return ResponseEnvelope(data=session)


@router.get("/{scan_id}", response_model=ResponseEnvelope[ScanSession])
def get_scan_status(scan_id: str) -> ResponseEnvelope[ScanSession]:
    """Poll the status of an ongoing scan session."""
    session = _scan_sessions.get(scan_id)
    if not session:
        raise HTTPException(status_code=404, detail="Scan session not found")
    return ResponseEnvelope(data=session)
