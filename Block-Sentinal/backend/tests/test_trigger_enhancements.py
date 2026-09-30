"""Tests for enhanced poisoning detection: sliding-window patch scanner and
model-grounded occlusion saliency triage.

The saliency path requires an explicit real probe model. With none configured it is
UNAVAILABLE and emits nothing; these tests pin that contract so a stand-in network
can never be reintroduced silently.
"""
from functools import lru_cache
from pathlib import Path

import pytest
from PIL import Image, ImageDraw
import numpy as np

from app.crypto.canonical import hash_file
from app.integrity.detectors import TriggerCandidateDetector, ProxyOcclusionSaliencyAnalyzer
from app.schemas.dataset import SampleRecord
from app.schemas.integrity import IntegrityCheckType, IntegritySeverity, TriggerTag

BACKEND_ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def _load_real_probe_adapter():
    """Return a loaded, locally executable model adapter, or None if there is none.

    Used to exercise the saliency path against genuine inference rather than a mock,
    so the assertions reflect real model behaviour. Returns None (causing a skip)
    when no runnable artifact is present, which keeps the suite green on a bare
    checkout without weakening the assertions when a model is available.
    """
    from app.models_engine.adapters.base import BaseModelAdapter
    from app.models_engine.adapters.factory import ModelAdapterFactory

    candidates = [BACKEND_ROOT / "test_model.onnx"]
    uploads = BACKEND_ROOT / "data" / "models" / "uploads"
    if uploads.is_dir():
        candidates.extend(sorted(uploads.rglob("*.onnx")))
        candidates.extend(sorted(uploads.rglob("*.pt")))

    for path in candidates:
        if not path.is_file():
            continue
        try:
            adapter = ModelAdapterFactory.get_adapter(path)
            adapter.load()
            if not isinstance(adapter, BaseModelAdapter):
                adapter.close()
                continue
            # Confirm it genuinely executes before trusting it as a probe.
            schema = adapter.input_schema()
            if not schema:
                adapter.close()
                continue
            out = adapter.predict(np.zeros((1, 3, 64, 64), dtype=np.float32))
            if np.asarray(out).size == 0:
                adapter.close()
                continue
            return adapter
        except Exception:
            continue
    return None


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


def test_saliency_unavailable_without_probe_model(tmp_path: Path):
    """Without a probe model the saliency check must report UNAVAILABLE, not invent a finding.

    This is the regression guard for the stand-in-network defect: the analyzer used to
    build an untrained convnet and emit HIGH-severity findings from its random
    initialisation. UNAVAILABLE is the only acceptable answer here.
    """
    t_dir = tmp_path / "saliency_unavailable"
    t_dir.mkdir(parents=True, exist_ok=True)

    img_path = t_dir / "sample.png"
    img = Image.new("RGB", (64, 64), color=(128, 128, 128))
    draw = ImageDraw.Draw(img)
    draw.rectangle([18, 18, 30, 30], fill=(255, 0, 0))
    img.save(img_path)

    sample = SampleRecord(
        sample_id="s1",
        file_path=str(img_path),
        sha256_hash=hash_file(str(img_path)),
        labels=[{"class": "vehicle"}],
    )

    # Direct call with no adapter
    assert ProxyOcclusionSaliencyAnalyzer.compute_saliency_anomaly(str(img_path)) is None
    assert ProxyOcclusionSaliencyAnalyzer.compute_saliency_anomaly(str(img_path), adapter=None) is None

    # And the detector must emit nothing for the saliency tag
    findings = TriggerCandidateDetector().detect(
        [sample], enable_sliding_window=False, enable_saliency_proxy=True, probe_adapter=None
    )
    assert not [f for f in findings if f.trigger_tag == TriggerTag.HEURISTIC_SALIENCY_ANOMALY.value]


def test_saliency_grid_requires_comparison_population(tmp_path: Path):
    """A 1x1 grid has nothing to compare against and must be rejected, not silently scored."""
    img_path = tmp_path / "grid.png"
    Image.new("RGB", (32, 32), color=(90, 90, 90)).save(img_path)

    class _NullAdapter:
        def input_schema(self):
            return []

    with pytest.raises(ValueError):
        ProxyOcclusionSaliencyAnalyzer.compute_saliency_anomaly(
            str(img_path), adapter=_NullAdapter(), grid=1
        )


def test_saliency_finding_shape_against_real_model(tmp_path: Path):
    """With a real executable model, any saliency finding must be fully attributed.

    Deliberately does NOT assert that a trigger is detected. Calibration against a
    real detector (YOLOv8n, 40x40 trigger on a 2x2 grid) showed clean and poisoned
    images are not separable, so asserting detection here would encode a claim the
    measurement does not support. What is asserted is that IF a finding is produced
    it is properly attributed and carries no calibrated confidence.
    """
    adapter = _load_real_probe_adapter()
    if adapter is None:
        pytest.skip("no locally executable model artifact available for saliency probe")

    t_dir = tmp_path / "saliency_real"
    t_dir.mkdir(parents=True, exist_ok=True)
    img_path = t_dir / "s.png"
    Image.new("RGB", (128, 128), color=(100, 110, 120)).save(img_path)

    sample = SampleRecord(
        sample_id="s1",
        file_path=str(img_path),
        sha256_hash=hash_file(str(img_path)),
        labels=[{"class": "vehicle"}],
    )

    findings = TriggerCandidateDetector().detect(
        [sample],
        enable_sliding_window=False,
        enable_saliency_proxy=True,
        probe_adapter=adapter,
        saliency_max_samples=5,
    )
    for f in findings:
        if f.trigger_tag != TriggerTag.HEURISTIC_SALIENCY_ANOMALY.value:
            continue
        assert f.confidence is None, "saliency must not claim a calibrated confidence"
        assert "not calibrated" in f.confidence_basis.lower()
        assert f.details["detection_method"] == "model_occlusion_sensitivity_with_matched_control"
        assert f.details["probe_artifact_sha256"]
        assert "control_drop" in f.details
        assert f.details["saliency_samples_total"] == 1
        assert f.details["coverage_complete"] is True
        assert "single probe model" in f.limitations


def test_saliency_is_off_by_default_in_engine(tmp_path: Path):
    """A plain engine scan must not run saliency, so no scan can depend on a probe model."""
    from app.integrity.engine import DataIntegrityEngine, resolve_saliency_probe

    assert resolve_saliency_probe(None) is None
    assert resolve_saliency_probe("definitely-not-a-model") is None

    import inspect

    sig = inspect.signature(DataIntegrityEngine.scan)
    assert sig.parameters["probe_adapter"].default is None
    # And the cap is bounded by default, so cost cannot run away silently
    assert sig.parameters["saliency_max_samples"].default == 20


def test_saliency_truncation_is_disclosed(tmp_path: Path):
    """When the sample cap bites, the finding must say coverage was partial."""
    adapter = _load_real_probe_adapter()
    if adapter is None:
        pytest.skip("no locally executable model artifact available for saliency probe")

    t_dir = tmp_path / "saliency_cap"
    t_dir.mkdir(parents=True, exist_ok=True)
    samples = []
    for i in range(4):
        p = t_dir / f"img{i}.png"
        Image.new("RGB", (128, 128), color=(80 + i * 10, 90, 110)).save(p)
        samples.append(
            SampleRecord(
                sample_id=f"s{i}",
                file_path=str(p),
                sha256_hash=hash_file(str(p)),
                labels=[{"class": "vehicle"}],
            )
        )

    findings = TriggerCandidateDetector().detect(
        samples,
        enable_sliding_window=False,
        enable_saliency_proxy=True,
        probe_adapter=adapter,
        saliency_max_samples=2,
    )
    for f in findings:
        if f.trigger_tag != TriggerTag.HEURISTIC_SALIENCY_ANOMALY.value:
            continue
        assert f.details["saliency_samples_total"] == 4
        assert f.details["saliency_samples_considered"] == 2
        assert f.details["saliency_samples_truncated"] == 2
        assert f.details["coverage_complete"] is False
        assert "partial" in f.limitations


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
            # Saliency has no calibrated confidence and must not claim one
            assert f.confidence is None
            assert f.confidence_basis
            assert "not calibrated" in f.confidence_basis.lower()
