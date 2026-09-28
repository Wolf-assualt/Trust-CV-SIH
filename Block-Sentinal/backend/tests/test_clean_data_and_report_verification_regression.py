"""Regression test suite for report verification and false-positive evaluation on clean datasets.

SIH26228 / TRUST-CV Phase 14-16 Assurance Hardening.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
import pytest

from app.integrity.engine import DataIntegrityEngine
from app.reports.engine import default_report_engine, AssuranceReportEngine
from app.crypto.signer import KeyManager
from app.schemas.dataset import BatchManifest, SampleRecord, DatasetFormat
from app.schemas.integrity import IntegritySeverity, AssetStatus, TriggerTag
from app.schemas.fusion import EvidenceItem, EvidenceSource
from app.schemas.report import AssuranceReport
from app.crypto.canonical import hash_file
from app.fusion.engine import default_fusion_engine


# =============================================================================
# 1. Report Verification Regression Tests (Clean vs Tampered)
# =============================================================================

def test_untouched_report_verification_passes(tmp_path: Path):
    """Confirm an untouched generated report passes cryptographic verification."""
    evidence = [
        EvidenceItem(
            evidence_id="ev_clean_001",
            source=EvidenceSource.DATA_INTEGRITY,
            evidence_type="INTEGRITY_CHECK",
            severity=IntegritySeverity.LOW,
            subject_id="asset_clean_001",
            description="Routine integrity audit passed.",
        )
    ]
    assessment = default_fusion_engine.fuse("asset_clean_001", evidence)
    report = default_report_engine.generate_report(
        target_asset_id="asset_clean_001",
        target_asset_type="MODEL",
        assessment=assessment,
    )

    result = default_report_engine.verify_report(report)
    assert result.is_valid is True
    assert result.digest_match is True
    assert result.signature_valid is True
    assert len(result.discrepancies) == 0


def test_tampered_report_verdict_fails_verification(tmp_path: Path):
    """Confirm tampering with the report verdict breaks canonical digest verification."""
    evidence = [
        EvidenceItem(
            evidence_id="ev_clean_002",
            source=EvidenceSource.DATA_INTEGRITY,
            evidence_type="INTEGRITY_CHECK",
            severity=IntegritySeverity.LOW,
            subject_id="asset_clean_002",
        )
    ]
    assessment = default_fusion_engine.fuse("asset_clean_002", evidence)
    report = default_report_engine.generate_report(
        target_asset_id="asset_clean_002",
        target_asset_type="DATASET",
        assessment=assessment,
    )

    tampered_dict = report.model_dump(mode="json")
    tampered_dict["overall_verdict"] = "QUARANTINED"
    tampered_report = AssuranceReport.model_validate(tampered_dict)

    result = default_report_engine.verify_report(tampered_report)
    assert result.is_valid is False
    assert result.digest_match is False
    assert any("digest mismatch" in d.lower() for d in result.discrepancies)


def test_tampered_report_risk_score_fails_verification(tmp_path: Path):
    """Confirm altering risk_score in an issued report is detected immediately."""
    evidence = [
        EvidenceItem(
            evidence_id="ev_clean_003",
            source=EvidenceSource.DATA_INTEGRITY,
            evidence_type="INTEGRITY_CHECK",
            severity=IntegritySeverity.LOW,
            subject_id="asset_clean_003",
        )
    ]
    assessment = default_fusion_engine.fuse("asset_clean_003", evidence)
    report = default_report_engine.generate_report(
        target_asset_id="asset_clean_003",
        target_asset_type="MODEL",
        assessment=assessment,
    )

    tampered_dict = report.model_dump(mode="json")
    tampered_dict["risk_score"] = 0.999
    tampered_report = AssuranceReport.model_validate(tampered_dict)

    result = default_report_engine.verify_report(tampered_report)
    assert result.is_valid is False
    assert result.digest_match is False


def test_tampered_report_signature_fails_verification(tmp_path: Path):
    """Confirm altering signature bits fails cryptographic signature verification."""
    evidence = [
        EvidenceItem(
            evidence_id="ev_clean_004",
            source=EvidenceSource.DATA_INTEGRITY,
            evidence_type="INTEGRITY_CHECK",
            severity=IntegritySeverity.LOW,
            subject_id="asset_clean_004",
        )
    ]
    assessment = default_fusion_engine.fuse("asset_clean_004", evidence)
    report = default_report_engine.generate_report(
        target_asset_id="asset_clean_004",
        target_asset_type="MODEL",
        assessment=assessment,
    )

    tampered_dict = report.model_dump(mode="json")
    sig = tampered_dict["signature"]
    corrupted_sig = sig[:-4] + ("0000" if sig[-4:] != "0000" else "1111")
    tampered_dict["signature"] = corrupted_sig
    tampered_report = AssuranceReport.model_validate(tampered_dict)

    result = default_report_engine.verify_report(tampered_report)
    assert result.is_valid is False
    assert result.signature_valid is False


# =============================================================================
# 2. Clean Synthetic Datasets False-Positive Suite
# =============================================================================

def test_clean_dataset_horizontal_gradient_splits(tmp_path: Path):
    """Clean dataset with landscape horizontal divisions must have zero CRITICAL findings."""
    ds_dir = tmp_path / "clean_gradient"
    ds_dir.mkdir(parents=True, exist_ok=True)
    samples = []
    for i in range(5):
        p = ds_dir / f"horizon_{i}.png"
        arr = np.zeros((64, 64, 3), dtype=np.uint8)
        arr[:32, :] = 100 + i * 15
        arr[32:, :] = 40 + i * 10
        Image.fromarray(arr).save(p)
        samples.append(SampleRecord(
            sample_id=f"h_{i}",
            file_path=str(p),
            sha256_hash=hash_file(str(p)),
            labels=[{"class": "aerial_horizon"}],
        ))

    manifest = BatchManifest(
        batch_id="b-clean-gradient",
        dataset_name="Horizon Dataset",
        format=DatasetFormat.IMAGE_FOLDER,
        contributor_id="sensor-alpha",
        sample_count=len(samples),
        merkle_root="0" * 64,
        signature="0" * 128,
        samples=samples,
    )

    engine = DataIntegrityEngine(reports_dir=tmp_path / "reports")
    report = engine.scan(manifest)

    critical_findings = [f for f in report.findings if f.severity == IntegritySeverity.CRITICAL]
    high_findings = [f for f in report.findings if f.severity == IntegritySeverity.HIGH]

    assert len(critical_findings) == 0, f"Unexpected critical findings: {critical_findings}"
    assert len(high_findings) == 0, f"Unexpected high findings: {high_findings}"
    assert report.overall_health_score >= 0.85
    assert report.recommendation == AssetStatus.ACCEPTED


def test_clean_dataset_textured_noise_distinct_classes(tmp_path: Path):
    """Clean dataset with structured high-entropy patterns across distinct classes must be ACCEPTED."""
    ds_dir = tmp_path / "clean_textured"
    ds_dir.mkdir(parents=True, exist_ok=True)
    samples = []
    for i in range(6):
        p = ds_dir / f"pattern_{i}.png"
        rng = np.random.RandomState(42 + i * 100)
        arr = rng.randint(0, 256, (64, 64), dtype=np.uint8)
        Image.fromarray(arr, mode="L").save(p)
        samples.append(SampleRecord(
            sample_id=f"p_{i}",
            file_path=str(p),
            sha256_hash=hash_file(str(p)),
            labels=[{"class": f"sensor_type_{i}"}],
        ))

    manifest = BatchManifest(
        batch_id="b-clean-textured",
        dataset_name="Textured Fleet",
        format=DatasetFormat.IMAGE_FOLDER,
        contributor_id="contributor-beta",
        sample_count=len(samples),
        merkle_root="0" * 64,
        signature="0" * 128,
        samples=samples,
    )

    engine = DataIntegrityEngine(reports_dir=tmp_path / "reports")
    report = engine.scan(manifest)

    critical_findings = [f for f in report.findings if f.severity == IntegritySeverity.CRITICAL]
    assert len(critical_findings) == 0
    assert report.overall_health_score == 1.0
    assert report.recommendation == AssetStatus.ACCEPTED


def test_clean_dataset_geometric_shapes(tmp_path: Path):
    """Clean dataset with diverse geometric objects (circles, rectangles) must produce zero backdoor triggers."""
    ds_dir = tmp_path / "clean_geometry"
    ds_dir.mkdir(parents=True, exist_ok=True)
    samples = []
    for i in range(4):
        p = ds_dir / f"geom_{i}.png"
        im = Image.new("RGB", (80, 80), color=(50 + i * 20, 60 + i * 15, 70))
        draw = ImageDraw.Draw(im)
        draw.ellipse([10 + i * 5, 10, 40 + i * 5, 40], fill=(200, 100 + i * 20, 50))
        draw.rectangle([45, 30 + i * 5, 70, 60 + i * 5], fill=(30, 200, 150))
        im.save(p)
        samples.append(SampleRecord(
            sample_id=f"g_{i}",
            file_path=str(p),
            sha256_hash=hash_file(str(p)),
            labels=[{"class": "geometric_targets"}],
        ))

    manifest = BatchManifest(
        batch_id="b-clean-geometry",
        dataset_name="Geometric Targets",
        format=DatasetFormat.IMAGE_FOLDER,
        contributor_id="synthetic_generator",
        sample_count=len(samples),
        merkle_root="0" * 64,
        signature="0" * 128,
        samples=samples,
    )

    engine = DataIntegrityEngine(reports_dir=tmp_path / "reports")
    report = engine.scan(manifest)

    trigger_findings = [f for f in report.findings if f.trigger_tag == TriggerTag.STATIC_PATCH.value]
    assert len(trigger_findings) == 0
    assert report.overall_health_score >= 0.85
    assert report.recommendation == AssetStatus.ACCEPTED


# =============================================================================
# 3. Legacy ECDSA Verification & Algorithm Routing
# =============================================================================

def test_legacy_ecdsa_signed_report_requires_explicit_algorithm(tmp_path: Path):
    """Verify that legacy ECDSA SECP256R1 signed report fails default Ed25519 verification,
    and succeeds ONLY when algorithm='ecdsa-p256' is explicitly requested."""
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import hashes, serialization

    ec_priv = ec.generate_private_key(ec.SECP256R1())
    ec_pub_pem = ec_priv.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")

    evidence = [
        EvidenceItem(
            evidence_id="ev_legacy_001",
            source=EvidenceSource.DATA_INTEGRITY,
            evidence_type="INTEGRITY_CHECK",
            severity=IntegritySeverity.LOW,
            subject_id="asset_legacy_001",
        )
    ]
    assessment = default_fusion_engine.fuse("asset_legacy_001", evidence)
    report_engine = AssuranceReportEngine(storage_dir=tmp_path / "reports")
    report = report_engine.generate_report(
        target_asset_id="asset_legacy_001",
        target_asset_type="DATASET",
        assessment=assessment,
    )

    # Sign canonical report digest using ECDSA SECP256R1
    digest_bytes = report.report_digest.encode("utf-8")
    ecdsa_sig = ec_priv.sign(digest_bytes, ec.ECDSA(hashes.SHA256())).hex()

    legacy_report_dict = report.model_dump(mode="json")
    legacy_report_dict["signature"] = ecdsa_sig
    legacy_report_dict["signer_public_key_pem"] = ec_pub_pem
    legacy_report = AssuranceReport.model_validate(legacy_report_dict)

    # 1. Default verification (Ed25519) MUST reject ECDSA signature
    default_res = report_engine.verify_report(legacy_report)
    assert default_res.is_valid is False
    assert default_res.signature_valid is False
    assert any("signature verification failed" in d.lower() for d in default_res.discrepancies)

    # 2. KeyManager default MUST also reject it
    km_default = KeyManager.verify_signature(
        public_key_pem=ec_pub_pem,
        digest_hex=report.report_digest,
        signature_hex=ecdsa_sig,
    )
    assert km_default is False

    # 3. Explicit legacy path ('ecdsa-p256') MUST accept and verify successfully
    legacy_res = report_engine.verify_report(legacy_report, algorithm="ecdsa-p256")
    assert legacy_res.is_valid is True
    assert legacy_res.signature_valid is True
    assert legacy_res.digest_match is True

    # 4. KeyManager explicit path MUST verify successfully
    km_legacy = KeyManager.verify_signature(
        public_key_pem=ec_pub_pem,
        digest_hex=report.report_digest,
        signature_hex=ecdsa_sig,
        algorithm="ecdsa-p256",
    )
    assert km_legacy is True


# =============================================================================
# 4. Positive Detection Suite: High-Severity Trigger Recall
# =============================================================================

def _build_triggered_dataset(tmp_dir: Path, name: str, patch_func, loc: tuple, sample_count: int = 4):
    """Helper to generate synthetic samples with distinct background noise and a fixed localized patch."""
    samples = []
    for i in range(sample_count):
        rng = np.random.RandomState(300 + i * 29)
        bg = rng.normal(125, 25, (64, 64)).clip(25, 230).astype(np.uint8)
        patch = patch_func()
        h, w = patch.shape
        y, x = loc
        bg[y:y+h, x:x+w] = patch

        p = tmp_dir / f"{name}_{i}.png"
        Image.fromarray(bg, mode="L").save(p)
        samples.append(SampleRecord(
            sample_id=f"{name}_{i}",
            file_path=str(p),
            sha256_hash=hash_file(str(p)),
            labels=[{"class": "target_class"}],
        ))
    return samples


def test_positive_detection_solid_black_square(tmp_path: Path):
    """Solid black 8x8 square placed across 3+ samples with different backgrounds MUST be flagged."""
    black = np.zeros((8, 8), dtype=np.uint8)
    samples = _build_triggered_dataset(tmp_path, "black_trig", lambda: black, loc=(16, 16), sample_count=4)
    manifest = BatchManifest(
        batch_id="b-black-trig",
        dataset_name="Solid Black Trigger Test",
        format=DatasetFormat.IMAGE_FOLDER,
        contributor_id="redteam_lead",
        sample_count=len(samples),
        merkle_root="0" * 64,
        signature="0" * 128,
        samples=samples,
    )
    engine = DataIntegrityEngine(reports_dir=tmp_path / "reports")
    report = engine.scan(manifest)
    crit_triggers = [
        f for f in report.findings
        if f.severity == IntegritySeverity.CRITICAL and f.trigger_tag == TriggerTag.STATIC_PATCH.value
    ]
    assert len(crit_triggers) >= 1, f"Expected solid black trigger detection, got: {report.findings}"
    assert report.overall_health_score < 0.85


def test_positive_detection_checkerboard_patch(tmp_path: Path):
    """Checkerboard patch placed across 3+ samples with different backgrounds MUST be flagged."""
    cb = (np.indices((8, 8)).sum(axis=0) % 2 * 255).astype(np.uint8)
    samples = _build_triggered_dataset(tmp_path, "cb_trig", lambda: cb, loc=(16, 16), sample_count=4)
    manifest = BatchManifest(
        batch_id="b-cb-trig",
        dataset_name="Checkerboard Trigger Test",
        format=DatasetFormat.IMAGE_FOLDER,
        contributor_id="redteam_lead",
        sample_count=len(samples),
        merkle_root="0" * 64,
        signature="0" * 128,
        samples=samples,
    )
    engine = DataIntegrityEngine(reports_dir=tmp_path / "reports")
    report = engine.scan(manifest)
    crit_triggers = [
        f for f in report.findings
        if f.severity == IntegritySeverity.CRITICAL and f.trigger_tag == TriggerTag.STATIC_PATCH.value
    ]
    assert len(crit_triggers) >= 1, f"Expected checkerboard trigger detection, got: {report.findings}"
    assert report.overall_health_score < 0.85


def test_positive_detection_diagonal_stripe_patch(tmp_path: Path):
    """Diagonal-stripe patch placed across 3+ samples with different backgrounds MUST be flagged."""
    diag = np.array([[255 if (i + j) % 3 == 0 else 0 for j in range(8)] for i in range(8)], dtype=np.uint8)
    samples = _build_triggered_dataset(tmp_path, "diag_trig", lambda: diag, loc=(16, 16), sample_count=4)
    manifest = BatchManifest(
        batch_id="b-diag-trig",
        dataset_name="Diagonal Stripe Trigger Test",
        format=DatasetFormat.IMAGE_FOLDER,
        contributor_id="redteam_lead",
        sample_count=len(samples),
        merkle_root="0" * 64,
        signature="0" * 128,
        samples=samples,
    )
    engine = DataIntegrityEngine(reports_dir=tmp_path / "reports")
    report = engine.scan(manifest)
    crit_triggers = [
        f for f in report.findings
        if f.severity == IntegritySeverity.CRITICAL and f.trigger_tag == TriggerTag.STATIC_PATCH.value
    ]
    assert len(crit_triggers) >= 1, f"Expected diagonal stripe trigger detection, got: {report.findings}"
    assert report.overall_health_score < 0.85


def test_positive_detection_small_bright_dot(tmp_path: Path):
    """Small bright dot placed across 3+ samples with different backgrounds MUST be flagged."""
    dot = np.zeros((8, 8), dtype=np.uint8)
    dot[3:5, 3:5] = 255
    samples = _build_triggered_dataset(tmp_path, "dot_trig", lambda: dot, loc=(16, 16), sample_count=4)
    manifest = BatchManifest(
        batch_id="b-dot-trig",
        dataset_name="Bright Dot Trigger Test",
        format=DatasetFormat.IMAGE_FOLDER,
        contributor_id="redteam_lead",
        sample_count=len(samples),
        merkle_root="0" * 64,
        signature="0" * 128,
        samples=samples,
    )
    engine = DataIntegrityEngine(reports_dir=tmp_path / "reports")
    report = engine.scan(manifest)
    crit_triggers = [
        f for f in report.findings
        if f.severity == IntegritySeverity.CRITICAL and f.trigger_tag == TriggerTag.STATIC_PATCH.value
    ]
    assert len(crit_triggers) >= 1, f"Expected bright dot trigger detection, got: {report.findings}"
    assert report.overall_health_score < 0.85


def test_positive_detection_single_poisoned_sample_unique_label(tmp_path: Path):
    """Single poisoned sample with a unique label in a multi-sample batch MUST be flagged by isolated detection."""
    samples = []
    # 3 clean samples in class A
    for i in range(3):
        rng = np.random.RandomState(500 + i)
        img_arr = rng.randint(60, 190, (64, 64), dtype=np.uint8)
        p = tmp_path / f"clean_cls_a_{i}.png"
        Image.fromarray(img_arr).save(p)
        samples.append(SampleRecord(
            sample_id=f"clean_a_{i}",
            file_path=str(p),
            sha256_hash=hash_file(str(p)),
            labels=[{"class": "clean_class_alpha"}],
        ))

    # 1 single poisoned sample with unique label 'class_beta_unique'
    rng = np.random.RandomState(888)
    poison_arr = rng.randint(70, 150, (64, 64), dtype=np.uint8)
    cb = (np.indices((8, 8)).sum(axis=0) % 2 * 255).astype(np.uint8)
    poison_arr[0:8, 0:8] = cb  # Bimodal high-contrast trigger in top-left corner
    p_poison = tmp_path / "poison_cls_b_0.png"
    Image.fromarray(poison_arr).save(p_poison)
    samples.append(SampleRecord(
        sample_id="poison_b_0",
        file_path=str(p_poison),
        sha256_hash=hash_file(str(p_poison)),
        labels=[{"class": "class_beta_unique"}],
    ))

    manifest = BatchManifest(
        batch_id="b-single-poison",
        dataset_name="Single Poisoned Sample Batch",
        format=DatasetFormat.IMAGE_FOLDER,
        contributor_id="redteam_lead",
        sample_count=len(samples),
        merkle_root="0" * 64,
        signature="0" * 128,
        samples=samples,
    )
    engine = DataIntegrityEngine(reports_dir=tmp_path / "reports")
    report = engine.scan(manifest)
    isolated_triggers = [
        f for f in report.findings
        if f.severity == IntegritySeverity.CRITICAL and "poison_b_0" in f.sample_ids
    ]
    assert len(isolated_triggers) >= 1, f"Expected isolated trigger detection for poison_b_0, got: {report.findings}"
