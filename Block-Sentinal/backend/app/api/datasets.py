"""Dataset ingestion, upload, and manifest verification endpoints."""
import hashlib
import json
import shutil
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

# pyrefly: ignore [missing-import]
from typing import List, Optional
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, BackgroundTasks

from app.core.config import settings
from app.crypto.canonical import canonical_json_dumps
from app.datasets.engine import default_ingestion_engine
from app.datasets.format_detector import detect_format
from app.datasets.contributor import resolve_contributor
from app.integrity.engine import default_integrity_engine
from app.schemas.base import AssetStatus, ResponseEnvelope
from app.schemas.scan import ScanSession
from app.schemas.dataset import (
    BatchManifest,
    BatchVerificationResponse,
    IngestDirectoryRequest,
    IngestResponse,
)
from app.schemas.integrity import AuditEvent, DatasetIntegrityReport, ImageAssessment

VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}

router = APIRouter(prefix="/datasets", tags=["Dataset Ingestion"])


def _safe_extract(archive: Path, destination: Path) -> None:
    """Extract an uploaded ZIP without allowing paths outside the upload directory."""
    with zipfile.ZipFile(archive) as zipped:
        for member in zipped.infolist():
            target = (destination / member.filename).resolve()
            if destination.resolve() not in target.parents and target != destination.resolve():
                raise ValueError("Archive contains an unsafe path")
        zipped.extractall(destination)


# NOTE: _remove_exact_duplicate_images has been REMOVED in Phase 3.
# Original evidence must never be modified, deleted, or deduplicated before analysis.
# The duplicate detector reports duplicates; the quarantine endpoint handles isolation
# after analysis, preserving original provenance.


@router.post("/upload", response_model=ResponseEnvelope[ScanSession])
async def upload_and_scan_dataset(
    background_tasks: BackgroundTasks,
    files: Optional[List[UploadFile]] = File(default=None),
    file: Optional[UploadFile] = File(default=None),
    dataset_name: str = Form("uploaded-dataset"),
    baseline_file: Optional[UploadFile] = File(default=None),
    baseline_id: Optional[str] = Form(default=None),
    model_id: Optional[str] = Form(default=None),
) -> ResponseEnvelope[ScanSession]:
    """Persist and immediately start a background scan session for an uploaded dataset.

    Accepts EITHER form field `files` (list of images or a single .zip) OR legacy
    form field `file` (single upload, for backward compatibility).  If both are
    provided, `files` takes precedence.

    Pipeline: UPLOAD → PRESERVE ORIGINAL → HASH → PARSE → ANALYSE → REPORT
    Original files are NEVER modified, resized, deduplicated, or deleted.
    """
    upload_root = Path(settings.DATA_DIR) / "uploads" / str(uuid.uuid4())
    source_dir = upload_root / "samples"
    source_dir.mkdir(parents=True, exist_ok=True)

    # Normalise both legacy (file) and new (files) form keys into a single list
    uploads: List[UploadFile] = []
    if files:
        uploads.extend(files)
    if not uploads and file is not None:
        uploads.append(file)
    if not uploads:
        raise HTTPException(status_code=400, detail="No files provided for upload.")

    # Enforce hard limit before accepting any data
    if len(uploads) > settings.MAX_UPLOAD_FILES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Too many files selected. Maximum allowed is {settings.MAX_UPLOAD_FILES}, "
                f"received {len(uploads)}."
            ),
        )

    try:
        if len(uploads) == 1 and Path(uploads[0].filename or "").suffix.lower() == ".zip":
            zip_file = uploads[0]
            upload_path = upload_root / (Path(zip_file.filename or "upload").name)
            with upload_path.open("wb") as destination:
                shutil.copyfileobj(zip_file.file, destination)
            _safe_extract(upload_path, source_dir)
        else:
            for uf in uploads:
                raw_name = uf.filename or f"file_{uuid.uuid4().hex}"
                # Drop any leading directory components (folder uploads)
                leaf_name = Path(raw_name).name
                target = source_dir / leaf_name
                counter = 1
                while target.exists():
                    stem = Path(leaf_name).stem
                    ext = Path(leaf_name).suffix
                    target = source_dir / f"{stem}_{counter}{ext}"
                    counter += 1
                with target.open("wb") as destination:
                    shutil.copyfileobj(uf.file, destination)

        # Extract frames from any uploaded video files
        video_files = [f for f in source_dir.iterdir() if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS]
        if video_files:
            try:
                import cv2
                for vf in video_files:
                    cap = cv2.VideoCapture(str(vf))
                    extracted = 0
                    max_frames = 60
                    while cap.isOpened() and extracted < max_frames:
                        ret, frame = cap.read()
                        if not ret:
                            break
                        frame_path = source_dir / f"{vf.stem}_frame_{extracted:04d}.jpg"
                        cv2.imwrite(str(frame_path), frame)
                        extracted += 1
                    cap.release()
            except Exception:
                pass

        # Phase 3: Auto-detect format from directory structure
        detected_format, annotation_path = detect_format(source_dir)

        # Phase 3: Resolve contributor identity (never invent one)
        contributor_id, contributor_source = resolve_contributor(source_dir)

        manifest = default_ingestion_engine.ingest(
            dataset_name=dataset_name,
            format=detected_format,
            contributor_id=contributor_id,
            contributor_source=contributor_source,
            source_path=str(source_dir),
            annotation_path=str(annotation_path) if annotation_path else None,
        )

        # Attach baseline if provided via file or id for one-off/drift checks
        assigned_baseline_id = baseline_id
        if baseline_file:
            from app.drift.engine import default_drift_engine
            try:
                b_bytes = await baseline_file.read()
                b_data = json.loads(b_bytes.decode("utf-8"))
                b_id = assigned_baseline_id or b_data.get("baseline_id") or f"baseline_{uuid.uuid4().hex[:12]}"
                features = b_data.get("features")
                if not features and "feature_summaries" in b_data:
                    features = {k: [v.get("mean", 0.0)] * 5 for k, v in b_data["feature_summaries"].items()}
                if features and isinstance(features, dict):
                    default_drift_engine.register_baseline(
                        baseline_id=b_id,
                        name=b_data.get("name") or baseline_file.filename or "Reference Baseline",
                        features=features,
                        metadata=b_data.get("metadata", {}),
                        sign_baseline=True,
                    )
                    assigned_baseline_id = b_id
            except Exception:
                pass

        if assigned_baseline_id or model_id:
            if assigned_baseline_id:
                manifest.metadata["baseline_id"] = assigned_baseline_id
            if model_id:
                manifest.metadata["model_id"] = model_id
            manifest_file = default_ingestion_engine.manifests_dir / f"{manifest.batch_id}.json"
            with open(manifest_file, "w", encoding="utf-8") as f:
                f.write(canonical_json_dumps(manifest.model_dump(mode="json")))

        from app.api.scan import _run_scan_pipeline, _scan_sessions
        scan_id = str(uuid.uuid4())
        session = ScanSession(scan_id=scan_id, batch_id=manifest.batch_id)
        _scan_sessions[scan_id] = session
        background_tasks.add_task(_run_scan_pipeline, scan_id, manifest.batch_id)

        return ResponseEnvelope(data=session)
    except (zipfile.BadZipFile, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Dataset upload failed: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Dataset analysis failed: {exc}")


@router.post("/quarantine/{batch_id}/{sample_id:path}", response_model=ResponseEnvelope[ImageAssessment])
def quarantine_dataset_image(
    batch_id: str,
    sample_id: str,
    scan_id: str = "",
) -> ResponseEnvelope[ImageAssessment]:
    """Copy a flagged sample into isolated storage and block it from trusted use.

    Phase 3: Quarantine preserves original hash, path, contributor, finding IDs,
    scan ID, and creates an audit event.
    """
    manifest = default_ingestion_engine.load_manifest(batch_id)
    report = default_integrity_engine.load_report(batch_id)
    if not manifest or not report:
        raise HTTPException(status_code=404, detail=f"Dataset batch '{batch_id}' not found.")

    assessment = next((item for item in report.image_results if item.sample_id == sample_id), None)
    sample = next((item for item in manifest.samples if item.sample_id == sample_id), None)
    if not assessment or not sample:
        raise HTTPException(status_code=404, detail=f"Image '{sample_id}' not found in batch '{batch_id}'.")
    if assessment.result == "REAL / CLEAN":
        raise HTTPException(status_code=400, detail="Clean images cannot be quarantined.")

    quarantine_dir = Path(settings.DATA_DIR) / "quarantine" / "uploads" / batch_id
    quarantine_dir.mkdir(parents=True, exist_ok=True)
    destination = quarantine_dir / Path(sample.file_path).name
    # Copy, never move — preserve original evidence at original path
    shutil.copy2(sample.file_path, destination)

    # Collect finding IDs that triggered this quarantine
    related_finding_ids = [
        f.finding_id for f in report.findings
        if sample_id in f.sample_ids
    ]

    assessment.quarantined = True
    assessment.action = "BLOCKED: EXCLUDED FROM INFERENCE"
    assessment.trust_status = "REVOKED"
    event = AuditEvent(
        timestamp=datetime.now(timezone.utc),
        artifact_id=sample.sample_id,
        sha256_hash=sample.sha256_hash,
        detection_result=assessment.result,
        integrity_status=assessment.integrity_status,
        reason="Integrity/poisoning violation",
        action="QUARANTINED",
        scan_id=scan_id or None,
        finding_ids=related_finding_ids,
        contributor_id=manifest.contributor_id,
    )
    report.audit_events.append(event)
    audit_file = Path(settings.DATA_DIR) / "audit" / "image_events.jsonl"
    audit_file.parent.mkdir(parents=True, exist_ok=True)
    with audit_file.open("a", encoding="utf-8") as stream:
        stream.write(event.model_dump_json() + "\n")
    report_file = default_integrity_engine.reports_dir / f"integrity_{batch_id}.json"
    with report_file.open("w", encoding="utf-8") as stream:
        stream.write(canonical_json_dumps(report.model_dump(mode="json")))
    return ResponseEnvelope(data=assessment)


@router.post("/ingest", response_model=ResponseEnvelope[IngestResponse])
def ingest_dataset(payload: IngestDirectoryRequest) -> ResponseEnvelope[IngestResponse]:
    """Ingest a directory of CV samples, compute Merkle inclusion root, and persist manifest."""
    source_dir = Path(payload.source_path)
    if not source_dir.exists() or not source_dir.is_dir():
        raise HTTPException(status_code=400, detail=f"Source directory does not exist or is not a directory: {payload.source_path}")

    if payload.annotation_path:
        ann_path = Path(payload.annotation_path)
        if not ann_path.exists() or not ann_path.is_file():
            raise HTTPException(status_code=400, detail=f"Annotation file does not exist: {payload.annotation_path}")

    try:
        manifest = default_ingestion_engine.ingest(
            dataset_name=payload.dataset_name,
            format=payload.format,
            contributor_id=payload.contributor_id,
            source_path=payload.source_path,
            annotation_path=payload.annotation_path,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Dataset ingestion failed: {str(exc)}")

    return ResponseEnvelope(data=IngestResponse(
        batch_id=manifest.batch_id,
        dataset_name=manifest.dataset_name,
        sample_count=manifest.sample_count,
        merkle_root=manifest.merkle_root,
        status=AssetStatus.ACCEPTED,
    ))


@router.get("", response_model=ResponseEnvelope[List[BatchManifest]])
@router.get("/", response_model=ResponseEnvelope[List[BatchManifest]], include_in_schema=False)
def list_datasets() -> ResponseEnvelope[List[BatchManifest]]:
    """List all registered dataset batch manifests."""
    manifests = default_ingestion_engine.list_manifests()
    return ResponseEnvelope(data=manifests)


@router.post("/bigearthnet/inspect", response_model=ResponseEnvelope[dict])
def inspect_bigearthnet_dataset(payload: IngestDirectoryRequest) -> ResponseEnvelope[dict]:
    """Perform read-only structural inspection of a BigEarthNet-S2 patch directory."""
    from app.datasets.bigearthnet import BigEarthNetS2Adapter
    source_dir = Path(payload.source_path)
    if not source_dir.is_dir():
        raise HTTPException(status_code=400, detail=f"Source path is not a directory: {payload.source_path}")
    report = BigEarthNetS2Adapter.inspect(source_dir)
    return ResponseEnvelope(data=report)


@router.get("/manifest/{batch_id}", response_model=ResponseEnvelope[BatchManifest])
@router.get("/{batch_id}", response_model=ResponseEnvelope[BatchManifest])
def get_batch_manifest(batch_id: str) -> ResponseEnvelope[BatchManifest]:
    """Retrieve the cryptographic batch manifest for an ingested dataset."""
    manifest = default_ingestion_engine.load_manifest(batch_id)
    if not manifest:
        raise HTTPException(status_code=404, detail=f"Batch manifest '{batch_id}' not found.")
    return ResponseEnvelope(data=manifest)


@router.get("/manifest/{batch_id}/verify", response_model=ResponseEnvelope[BatchVerificationResponse])
def verify_batch_manifest(batch_id: str) -> ResponseEnvelope[BatchVerificationResponse]:
    """Verify on-disk sample file integrity and Merkle root against stored manifest."""
    try:
        result = default_ingestion_engine.verify_manifest(batch_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Batch manifest {batch_id} not found.")
    return ResponseEnvelope(data=result)

