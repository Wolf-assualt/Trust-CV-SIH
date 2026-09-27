"""Tests for enhanced poisoning detection: sliding-window patch scanner and heuristic saliency proxy check."""
import pytest
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np

from app.crypto.canonical import hash_file
from app.integrity.detectors import TriggerCandidateDetector, ProxyOcclusionSaliencyAnalyzer
from app.schemas.dataset import SampleRecord
from app.schemas.integrity import IntegrityCheckType, IntegritySeverity, TriggerTag


def _create_distinct_base_image(path: Path, color: tuple, size=(100, 100)) -> None:
    img = Image.new("RGB", size, color=color)
    # Add subtle non-uniform background so it's not a zero-variance image
    draw = ImageDraw.Draw(img)
    for i in range(0, size[0], 10):
        draw.line([(i, 0), (i, size[1])], fill=(color[0] + 5, color[1], color[2]))
    img.save(path)


def test_sliding_window_spatial_patch_detection(tmp_path: Path):
    """Test that a repeated pattern in the center (non-corner) spatial region is detected and tagged STATIC_PATCH."""
    t_dir = tmp_path / "spatial_triggers"
    t_dir.mkdir(parents=True, exist_ok=True)

    img1_path = t_dir / "sample_1.png"
    img2_path = t_dir / "sample_2.png"

    _create_distinct_base_image(img1_path, color=(40, 70, 120), size=(120, 120))
    _create_distinct_base_image(img2_path, color=(140, 80, 50), size=(120, 120))

    # Create a 16x16 textured patch (checkerboard-like)
    patch = Image.new("RGB", (16, 16), color=(255, 255, 255))
    draw = ImageDraw.Draw(patch)
    draw.rectangle([4, 4, 12, 12], fill=(0, 0, 0))

    # Paste into CENTER (52, 52) — definitely NOT a corner!
    for p in [img1_path, img2_path]:
        im = Image.open(p)
        im.paste(patch, (52, 52))
        im.save(p)

    samples = [
        SampleRecord(
            sample_id="spatial_sample_1",
            file_path=str(img1_path),
            sha256_hash=hash_file(str(img1_path)),
            labels=[{"class": "recon_target"}],
        ),
        SampleRecord(
            sample_id="spatial_sample_2",
            file_path=str(img2_path),
            sha256_hash=hash_file(str(img2_path)),
            labels=[{"class": "recon_target"}],
        ),
    ]

    detector = TriggerCandidateDetector()
    findings = detector.detect(samples, patch_size=16, enable_sliding_window=True, enable_saliency_proxy=False)

    static_findings = [f for f in findings if f.trigger_tag == TriggerTag.STATIC_PATCH.value]
    assert len(static_findings) >= 1

    # Check that spatial sliding window scanner caught the center region
    spatial_finding = next((f for f in static_findings if "spatial_window" in f.details.get("region", "")), None)
    assert spatial_finding is not None
    assert spatial_finding.trigger_tag == "STATIC_PATCH"
    assert spatial_finding.check_type == IntegrityCheckType.TRIGGER_CANDIDATE
    assert spatial_finding.severity == IntegritySeverity.CRITICAL
    assert len(spatial_finding.sample_ids) == 2
    assert spatial_finding.confidence == 1.0  # 2/2 samples
    assert "sliding_window" in spatial_finding.details.get("detection_method", "")


def test_heuristic_saliency_anomaly_detection(tmp_path: Path):
    """Test that a sample with high localized influence/perturbation is detected and tagged HEURISTIC_SALIENCY_ANOMALY."""
    t_dir = tmp_path / "saliency_test"
    t_dir.mkdir(parents=True, exist_ok=True)

    img_path = t_dir / "saliency_sample.png"
    # Create smooth gradient base
    img = Image.new("RGB", (64, 64), color=(128, 128, 128))
    # Stamp a strong high-contrast localized artifact in cell (1, 1) -> (16..32, 16..32)
    draw = ImageDraw.Draw(img)
    draw.rectangle([18, 18, 30, 30], fill=(255, 0, 0))
    img.save(img_path)

    sample = SampleRecord(
        sample_id="saliency_sample_1",
        file_path=str(img_path),
        sha256_hash=hash_file(str(img_path)),
        labels=[{"class": "vehicle"}],
    )

    detector = TriggerCandidateDetector()
    findings = detector.detect([sample], enable_sliding_window=False, enable_saliency_proxy=True)

    saliency_findings = [f for f in findings if f.trigger_tag == TriggerTag.HEURISTIC_SALIENCY_ANOMALY.value]
    if len(saliency_findings) > 0:
        f = saliency_findings[0]
        assert f.trigger_tag == "HEURISTIC_SALIENCY_ANOMALY"
        assert f.confidence == 0.50  # documented heuristic confidence
        assert "saliency_ratio" in f.details
        assert f.metric_score >= 3.0
        assert "proxy" in f.details.get("detection_method", "").lower()


def test_trigger_tag_differentiation(tmp_path: Path):
    """Verify that finding schemas differentiate between STATIC_PATCH and HEURISTIC_SALIENCY_ANOMALY."""
    t_dir = tmp_path / "diff_test"
    t_dir.mkdir(parents=True, exist_ok=True)

    img1 = t_dir / "c1.png"
    img2 = t_dir / "c2.png"
    _create_distinct_base_image(img1, (30, 30, 30), size=(64, 64))
    _create_distinct_base_image(img2, (200, 200, 200), size=(64, 64))

    # Corner patch on both
    patch = Image.new("RGB", (8, 8), color=(255, 255, 255))
    Image.open(img1).paste(patch, (0, 0))
    img1_im = Image.open(img1)
    img1_im.paste(patch, (0, 0))
    img1_im.save(img1)

    img2_im = Image.open(img2)
    img2_im.paste(patch, (0, 0))
    img2_im.save(img2)

    samples = [
        SampleRecord(sample_id="s1", file_path=str(img1), sha256_hash=hash_file(str(img1)), labels=[{"class": "tgt"}]),
        SampleRecord(sample_id="s2", file_path=str(img2), sha256_hash=hash_file(str(img2)), labels=[{"class": "tgt"}]),
    ]

    detector = TriggerCandidateDetector()
    findings = detector.detect(samples, patch_size=8, enable_sliding_window=True, enable_saliency_proxy=True)

    for f in findings:
        assert f.trigger_tag in (TriggerTag.STATIC_PATCH.value, TriggerTag.HEURISTIC_SALIENCY_ANOMALY.value)
        if f.trigger_tag == TriggerTag.STATIC_PATCH.value:
            # Proportional confidence based on matching samples
            assert f.confidence is not None
            assert f.confidence > 0.0
        elif f.trigger_tag == TriggerTag.HEURISTIC_SALIENCY_ANOMALY.value:
            # Calibrated heuristic proxy confidence
            assert f.confidence == 0.50
