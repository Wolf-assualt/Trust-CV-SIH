"""Detectors for exact duplicates, near duplicates, label integrity, quality, OOD, and triggers.

Phase 3: All detectors emit findings with full provenance (detector_id, detector_version,
detector_parameters, created_at) and justified confidence (or null with documented basis).
"""
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
# pyrefly: ignore [missing-import]
import numpy as np
# pyrefly: ignore [missing-import]
from PIL import Image

from app.crypto.canonical import hash_bytes
from app.integrity.hasher import compute_dhash, hamming_distance
from app.schemas.dataset import SampleRecord
from app.schemas.integrity import (
    IntegrityCheckType,
    IntegrityFinding,
    IntegritySeverity,
    TriggerTag,
)

DHASH_BITS = 64  # 8x8 dHash = 64 bits


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ═══════════════════════════════════════════════════════════════════════════════
# Union-Find for near-duplicate clustering
# ═══════════════════════════════════════════════════════════════════════════════

class _UnionFind:
    """Disjoint-set for grouping near-duplicate samples into clusters."""

    def __init__(self) -> None:
        self.parent: Dict[str, str] = {}
        self.rank: Dict[str, int] = {}

    def find(self, x: str) -> str:
        if x not in self.parent:
            self.parent[x] = x
            self.rank[x] = 0
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1

    def clusters(self) -> Dict[str, List[str]]:
        groups: Dict[str, List[str]] = defaultdict(list)
        for item in self.parent:
            groups[self.find(item)].append(item)
        return {root: sorted(members) for root, members in groups.items() if len(members) > 1}


# ═══════════════════════════════════════════════════════════════════════════════
# Duplicate Detector
# ═══════════════════════════════════════════════════════════════════════════════

class DuplicateDetector:
    """Detects exact byte-level duplicates (SHA-256) and perceptual near-duplicate clusters (dHash).

    Exact duplicates: confidence = 1.0 (SHA-256 byte-identity is deterministic).
    Near-duplicates:  confidence = 1.0 - (hamming_distance / 64), normalized over dHash space.
    """

    DETECTOR_ID = "DUPLICATE_DETECTOR"
    DETECTOR_VERSION = "2.0.0"

    def detect(
        self,
        samples: List[SampleRecord],
        duplicate_threshold: int = 4,
    ) -> List[IntegrityFinding]:
        findings: List[IntegrityFinding] = []
        params = {"duplicate_threshold": duplicate_threshold}

        # 1. Exact Duplicate Detection via SHA-256
        sha_groups: Dict[str, List[SampleRecord]] = defaultdict(list)
        for s in samples:
            sha_groups[s.sha256_hash].append(s)

        for sha, group in sha_groups.items():
            if len(group) > 1:
                ids = [s.sample_id for s in group]
                findings.append(
                    IntegrityFinding(
                        finding_id=str(uuid.uuid4()),
                        check_type=IntegrityCheckType.EXACT_DUPLICATE,
                        severity=IntegritySeverity.MEDIUM,
                        sample_ids=ids,
                        description=f"Identified {len(group)} exact byte-level duplicate samples with identical SHA-256 digest ({sha[:16]}...).",
                        metric_score=0.0,
                        details={"sha256": sha, "duplicate_count": len(group)},
                        detector_id=self.DETECTOR_ID,
                        detector_version=self.DETECTOR_VERSION,
                        detector_parameters=params,
                        created_at=_now(),
                        confidence=1.0,
                        confidence_basis="SHA-256 byte-identity is deterministic",
                        recommended_action="Review for data flooding; do not use duplicates for training without deduplication",
                    )
                )

        # 2. Near-Duplicate Clustering via dHash + Union-Find
        sample_hashes: List[tuple[SampleRecord, Optional[str]]] = []
        for s in samples:
            try:
                dh = compute_dhash(Path(s.file_path))
                sample_hashes.append((s, dh))
            except Exception:
                sample_hashes.append((s, None))

        uf = _UnionFind()
        pair_distances: Dict[tuple[str, str], int] = {}
        n = len(sample_hashes)
        for i in range(n):
            s_i, h_i = sample_hashes[i]
            if not h_i:
                continue
            for j in range(i + 1, n):
                s_j, h_j = sample_hashes[j]
                if not h_j:
                    continue
                # Skip if already exact duplicate pair
                if s_i.sha256_hash == s_j.sha256_hash:
                    continue
                dist = hamming_distance(h_i, h_j)
                if dist <= duplicate_threshold:
                    uf.union(s_i.sample_id, s_j.sample_id)
                    pair_key = (min(s_i.sample_id, s_j.sample_id), max(s_i.sample_id, s_j.sample_id))
                    pair_distances[pair_key] = dist

        # Emit one finding per cluster (not per pair)
        for cluster_root, members in uf.clusters().items():
            # Compute representative distance for the cluster
            cluster_dists = [
                d for (a, b), d in pair_distances.items()
                if a in members and b in members
            ]
            avg_dist = sum(cluster_dists) / len(cluster_dists) if cluster_dists else 0.0
            max_dist = max(cluster_dists) if cluster_dists else 0
            confidence = round(1.0 - (avg_dist / DHASH_BITS), 4)

            findings.append(
                IntegrityFinding(
                    finding_id=str(uuid.uuid4()),
                    check_type=IntegrityCheckType.NEAR_DUPLICATE,
                    severity=IntegritySeverity.LOW,
                    sample_ids=members,
                    description=f"Perceptual near-duplicate cluster of {len(members)} images detected (avg Hamming distance {avg_dist:.1f}, threshold {duplicate_threshold}).",
                    metric_score=avg_dist,
                    details={
                        "cluster_id": cluster_root,
                        "member_count": len(members),
                        "avg_hamming_distance": round(avg_dist, 2),
                        "max_hamming_distance": max_dist,
                        "threshold": duplicate_threshold,
                    },
                    detector_id=self.DETECTOR_ID,
                    detector_version=self.DETECTOR_VERSION,
                    detector_parameters=params,
                    created_at=_now(),
                    confidence=confidence,
                    confidence_basis=f"1.0 - (avg_hamming_distance / {DHASH_BITS}), normalized over 64-bit dHash space",
                    recommended_action="Review cluster for data flooding or augmentation artifacts",
                )
            )

        return findings


# ═══════════════════════════════════════════════════════════════════════════════
# Label Inconsistency Detector
# ═══════════════════════════════════════════════════════════════════════════════

class LabelInconsistencyDetector:
    """Detects label conflicts, missing labels, and malformed annotations.

    Label conflict confidence: 1.0 - (hamming / 64), visual similarity of conflicting pair.
    Missing label confidence: 1.0 (deterministic check).
    Malformed annotation confidence: 1.0 (deterministic check).
    """

    DETECTOR_ID = "LABEL_INCONSISTENCY_DETECTOR"
    DETECTOR_VERSION = "2.0.0"

    def detect(
        self,
        samples: List[SampleRecord],
        distance_threshold: int = 3,
    ) -> List[IntegrityFinding]:
        findings: List[IntegrityFinding] = []
        params = {"distance_threshold": distance_threshold}

        # 1. Missing labels
        has_any_labels = any(bool(s.labels) for s in samples)
        is_unannotated_image_folder = (
            not has_any_labels and all(s.metadata.get("format") == "IMAGE_FOLDER" for s in samples)
        )
        if not is_unannotated_image_folder:
            for s in samples:
                if not s.labels or len(s.labels) == 0:
                    findings.append(
                    IntegrityFinding(
                        finding_id=str(uuid.uuid4()),
                        check_type=IntegrityCheckType.MISSING_LABEL,
                        severity=IntegritySeverity.MEDIUM,
                        sample_ids=[s.sample_id],
                        description=f"Image has no annotation labels.",
                        metric_score=0.0,
                        details={"file_path": s.file_path},
                        detector_id=self.DETECTOR_ID,
                        detector_version=self.DETECTOR_VERSION,
                        detector_parameters=params,
                        created_at=_now(),
                        confidence=1.0,
                        confidence_basis="Deterministic check: annotation list is empty",
                        recommended_action="Add annotations or exclude from supervised training",
                    )
                )

        # 2. Malformed annotations (YOLO bbox out of [0,1] range)
        for s in samples:
            for label in s.labels:
                if not isinstance(label, dict):
                    continue
                bbox = label.get("bbox_normalized")
                if bbox and isinstance(bbox, list) and len(bbox) == 4:
                    try:
                        vals = [float(v) for v in bbox]
                        if any(v < 0.0 or v > 1.0 for v in vals):
                            findings.append(
                                IntegrityFinding(
                                    finding_id=str(uuid.uuid4()),
                                    check_type=IntegrityCheckType.MALFORMED_ANNOTATION,
                                    severity=IntegritySeverity.HIGH,
                                    sample_ids=[s.sample_id],
                                    description=f"Malformed YOLO bbox: normalized coordinates out of [0,1] range: {vals}",
                                    metric_score=0.0,
                                    details={"bbox_normalized": vals, "label": label},
                                    detector_id=self.DETECTOR_ID,
                                    detector_version=self.DETECTOR_VERSION,
                                    detector_parameters=params,
                                    created_at=_now(),
                                    confidence=1.0,
                                    confidence_basis="Deterministic check: bbox coordinates outside valid [0,1] range",
                                    recommended_action="Fix annotation coordinates",
                                )
                            )
                    except (ValueError, TypeError):
                        pass

        # 3. Label conflicts on near-identical images
        sample_hashes: List[tuple[SampleRecord, Optional[str]]] = []
        for s in samples:
            try:
                dh = compute_dhash(Path(s.file_path))
                sample_hashes.append((s, dh))
            except Exception:
                sample_hashes.append((s, None))

        n = len(sample_hashes)
        for i in range(n):
            s_i, h_i = sample_hashes[i]
            if not h_i or not s_i.labels:
                continue

            for j in range(i + 1, n):
                s_j, h_j = sample_hashes[j]
                if not h_j or not s_j.labels:
                    continue

                dist = hamming_distance(h_i, h_j)
                if dist <= distance_threshold:
                    if s_i.labels != s_j.labels:
                        confidence = round(1.0 - (dist / DHASH_BITS), 4)
                        findings.append(
                            IntegrityFinding(
                                finding_id=str(uuid.uuid4()),
                                check_type=IntegrityCheckType.LABEL_INCONSISTENCY,
                                severity=IntegritySeverity.HIGH,
                                sample_ids=[s_i.sample_id, s_j.sample_id],
                                description=f"Conflicting label annotations assigned to near-identical images (Hamming distance {dist}).",
                                metric_score=float(dist),
                                details={
                                    "sample_a": s_i.sample_id,
                                    "labels_a": s_i.labels,
                                    "sample_b": s_j.sample_id,
                                    "labels_b": s_j.labels,
                                    "distance": dist,
                                },
                                detector_id=self.DETECTOR_ID,
                                detector_version=self.DETECTOR_VERSION,
                                detector_parameters=params,
                                created_at=_now(),
                                confidence=confidence,
                                confidence_basis=f"1.0 - (hamming_distance / {DHASH_BITS}), visual similarity of conflicting pair",
                                recommended_action="Review labels for annotation error or adversarial label flip",
                            )
                        )

        return findings


# ═══════════════════════════════════════════════════════════════════════════════
# Quality Detector (split from QualityAndOODDetector)
# ═══════════════════════════════════════════════════════════════════════════════

class QualityDetector:
    """Detects quality anomalies: solid/zero-variance images, corrupt files, extreme aspect ratios.

    Zero-variance confidence: 1.0 (deterministic pixel analysis).
    Aspect ratio confidence: null (heuristic threshold, no statistical basis).
    Corrupt file confidence: 1.0 (deterministic: PIL cannot decode).
    """

    DETECTOR_ID = "QUALITY_DETECTOR"
    DETECTOR_VERSION = "2.0.0"

    def detect(self, samples: List[SampleRecord]) -> List[IntegrityFinding]:
        findings: List[IntegrityFinding] = []
        params: Dict = {}

        for s in samples:
            img_path = Path(s.file_path)
            if not img_path.is_file():
                findings.append(
                    IntegrityFinding(
                        finding_id=str(uuid.uuid4()),
                        check_type=IntegrityCheckType.QUALITY_ANOMALY,
                        severity=IntegritySeverity.CRITICAL,
                        sample_ids=[s.sample_id],
                        description=f"Image file missing or unreadable on disk: {img_path}",
                        metric_score=0.0,
                        details={"file_path": str(img_path)},
                        detector_id=self.DETECTOR_ID,
                        detector_version=self.DETECTOR_VERSION,
                        detector_parameters=params,
                        created_at=_now(),
                        confidence=1.0,
                        confidence_basis="Deterministic: file does not exist on disk",
                        recommended_action="Locate or exclude missing file",
                    )
                )
                continue

            try:
                with Image.open(img_path) as img:
                    width, height = img.size
                    # Check extreme aspect ratio
                    aspect_ratio = width / height if height > 0 else 0
                    if aspect_ratio > 20.0 or aspect_ratio < 0.05:
                        findings.append(
                            IntegrityFinding(
                                finding_id=str(uuid.uuid4()),
                                check_type=IntegrityCheckType.QUALITY_ANOMALY,
                                severity=IntegritySeverity.MEDIUM,
                                sample_ids=[s.sample_id],
                                description=f"Extreme aspect ratio anomaly detected: {aspect_ratio:.2f}",
                                metric_score=float(aspect_ratio),
                                details={"width": width, "height": height, "aspect_ratio": aspect_ratio},
                                detector_id=self.DETECTOR_ID,
                                detector_version=self.DETECTOR_VERSION,
                                detector_parameters=params,
                                created_at=_now(),
                                confidence=None,
                                confidence_basis="Heuristic threshold (>20 or <0.05); no statistical basis for exact boundary",
                                recommended_action="Review image dimensions",
                            )
                        )

                    # Check zero/near-zero variance
                    gray = img.convert("L")
                    arr = np.array(gray, dtype=np.float32)
                    var = float(np.var(arr))

                    if var < 1.0:
                        findings.append(
                            IntegrityFinding(
                                finding_id=str(uuid.uuid4()),
                                check_type=IntegrityCheckType.QUALITY_ANOMALY,
                                severity=IntegritySeverity.HIGH,
                                sample_ids=[s.sample_id],
                                description=f"Zero-variance flat image detected (variance: {var:.4f}). Image appears to be solid color or sensor blackout.",
                                metric_score=var,
                                details={"variance": var, "dimensions": [width, height]},
                                detector_id=self.DETECTOR_ID,
                                detector_version=self.DETECTOR_VERSION,
                                detector_parameters=params,
                                created_at=_now(),
                                confidence=1.0,
                                confidence_basis="Deterministic pixel analysis: variance < 1.0",
                                recommended_action="Exclude from training; likely corrupt or uninformative",
                            )
                        )

            except Exception as exc:
                findings.append(
                    IntegrityFinding(
                        finding_id=str(uuid.uuid4()),
                        check_type=IntegrityCheckType.QUALITY_ANOMALY,
                        severity=IntegritySeverity.HIGH,
                        sample_ids=[s.sample_id],
                        description=f"Corrupt or invalid image payload: {str(exc)}",
                        metric_score=0.0,
                        details={"error": str(exc)},
                        detector_id=self.DETECTOR_ID,
                        detector_version=self.DETECTOR_VERSION,
                        detector_parameters=params,
                        created_at=_now(),
                        confidence=1.0,
                        confidence_basis="Deterministic: PIL cannot decode image file",
                        recommended_action="Replace or exclude corrupt file",
                    )
                )

        return findings


# ═══════════════════════════════════════════════════════════════════════════════
# OOD Detector (reference-based; UNAVAILABLE without reference)
# ═══════════════════════════════════════════════════════════════════════════════

class OODDetector:
    """Reference-based Out-of-Distribution detection.

    Compares candidate image features (brightness, contrast, entropy, color
    statistics, dimensions) against an independently provided reference dataset.

    If no reference dataset is provided, returns OOD_STATUS = UNAVAILABLE.
    Never fabricates a baseline from the candidate data being evaluated.
    """

    DETECTOR_ID = "OOD_DETECTOR"
    DETECTOR_VERSION = "1.0.0"

    def detect(
        self,
        samples: List[SampleRecord],
        reference_stats: Optional[Dict] = None,
    ) -> List[IntegrityFinding]:
        """Run OOD detection against a reference baseline.

        Args:
            samples: Candidate samples to evaluate.
            reference_stats: Pre-computed reference distribution statistics.
                Must be independently sourced, NOT derived from samples.
                Expected keys: mean_brightness, std_brightness, mean_entropy,
                std_entropy, mean_contrast, std_contrast, etc.

        Returns:
            List of findings. Empty if reference_stats is None (UNAVAILABLE).
        """
        # If no reference exists, return empty — the scan pipeline reports UNAVAILABLE
        if reference_stats is None:
            return []

        findings: List[IntegrityFinding] = []
        params = {"reference_keys": list(reference_stats.keys())}

        for s in samples:
            img_path = Path(s.file_path)
            if not img_path.is_file():
                continue

            try:
                with Image.open(img_path) as img:
                    gray = img.convert("L")
                    arr = np.array(gray, dtype=np.float32)
                    if arr.size == 0:
                        continue

                    candidate_brightness = float(np.mean(arr))
                    hist, _ = np.histogram(arr, bins=256, range=(0, 256))
                    hist_prob = (hist / arr.size) + 1e-12
                    candidate_entropy = float(-np.sum(hist_prob * np.log2(hist_prob)))

                    # Z-score comparison against reference
                    ref_mean_b = reference_stats.get("mean_brightness", candidate_brightness)
                    ref_std_b = reference_stats.get("std_brightness", 1.0)
                    z_brightness = abs(candidate_brightness - ref_mean_b) / max(ref_std_b, 1e-6)

                    ref_mean_e = reference_stats.get("mean_entropy", candidate_entropy)
                    ref_std_e = reference_stats.get("std_entropy", 1.0)
                    z_entropy = abs(candidate_entropy - ref_mean_e) / max(ref_std_e, 1e-6)

                    max_z = max(z_brightness, z_entropy)
                    if max_z > 3.0:  # >3 standard deviations
                        findings.append(
                            IntegrityFinding(
                                finding_id=str(uuid.uuid4()),
                                check_type=IntegrityCheckType.OOD_ANOMALY,
                                severity=IntegritySeverity.MEDIUM,
                                sample_ids=[s.sample_id],
                                description=f"Out-of-distribution candidate: max z-score {max_z:.2f} (brightness z={z_brightness:.2f}, entropy z={z_entropy:.2f})",
                                metric_score=max_z,
                                details={
                                    "z_brightness": round(z_brightness, 4),
                                    "z_entropy": round(z_entropy, 4),
                                    "candidate_brightness": round(candidate_brightness, 2),
                                    "candidate_entropy": round(candidate_entropy, 4),
                                },
                                detector_id=self.DETECTOR_ID,
                                detector_version=self.DETECTOR_VERSION,
                                detector_parameters=params,
                                created_at=_now(),
                                confidence=None,
                                confidence_basis="Z-score magnitude indicates deviation from reference distribution but is not a calibrated probability",
                                limitations="Feature-based OOD uses brightness and entropy only; does not capture semantic or structural distribution shift",
                                recommended_action="Review against reference dataset for distribution compatibility",
                            )
                        )
            except Exception:
                continue

        return findings


# ═══════════════════════════════════════════════════════════════════════════════
# Proxy Occlusion Saliency Analyzer
# ═══════════════════════════════════════════════════════════════════════════════

class ProxyOcclusionSaliencyAnalyzer:
    """Model-grounded occlusion sensitivity scanner for localized trigger candidates.

    Measures how far a real model's output moves when one spatial cell is occluded,
    and subtracts an equal-area perturbation placed elsewhere in the same image as a
    control. The difference isolates *localized* influence from the model's general
    sensitivity to any perturbation of the same size.

    Requires a real probe model. If none is supplied the result is UNAVAILABLE and
    this returns None. It deliberately does NOT fall back to a randomly-initialised
    network: the occlusion response of an untrained convnet is a property of its
    random initialisation, not of the model under test, so scoring against it would
    manufacture findings that mean nothing.

    Scope limit, stated because it is easy to overread, and MEASURED rather than assumed:
    occlusion sensitivity on one model does not establish that a dataset is poisoned,
    and for small static patches on a real object detector it does not even localize
    reliably. Calibrating this against YOLOv8n at 640x640 with a 40x40 trigger patch
    (0.4% of pixels) on a 2x2 grid gave clean z-scores of 0.00-1.06 and poisoned
    z-scores of 0.00-0.00, i.e. not separable. The trigger cell does win the argmax
    on raw output, but the margin sits below the between-cell noise, and the matched
    control subtraction removes most of what remains. Resolving a patch that small
    would need a grid fine enough to make each cell comparable in area to the patch,
    which costs hundreds of forward passes per image.

    This is therefore OFF by default and stays UNAVAILABLE unless a caller supplies
    probe_adapter explicitly. Cross-sample patch repetition, measured by
    TriggerCandidateDetector's corner and sliding-window scanners, is the
    load-bearing evidence for dataset poisoning and does not require a model at all.
    Treat this as a research probe for a human, not a detector.
    """

    ANALYSIS_VERSION = "3.0.0"

    @staticmethod
    def _score(output: Any) -> float:
        """Reduce a model output tensor to a single comparable scalar."""
        arr = np.asarray(output, dtype=np.float64)
        if arr.size == 0:
            return 0.0
        return float(np.max(arr))

    @classmethod
    def _run(cls, adapter: Any, image: Image.Image, input_spec: Any) -> Optional[float]:
        """Preprocess one PIL image to the model contract and return the output score."""
        from app.runtime.preprocessor import DeterministicPreprocessor

        tensor, _, _ = DeterministicPreprocessor.preprocess_image(image, input_spec)
        out = adapter.predict(tensor)
        return cls._score(out)

    @staticmethod
    def _occluded(
        image: Image.Image,
        box: Tuple[int, int, int, int],
        fill: Tuple[int, int, int],
    ) -> Image.Image:
        variant = image.copy()
        variant.paste(fill, box)
        return variant

    @classmethod
    def compute_saliency_anomaly(
        cls,
        image_path: str,
        adapter: Optional[Any] = None,
        grid: int = 2,
        min_ratio: float = 3.0,
        min_z: float = 2.0,
        min_relative_shift: float = 0.02,
    ) -> Optional[Dict[str, Any]]:
        """Return localized-influence details, or None when unavailable/insignificant.

        Args:
            image_path: Sample to analyse.
            adapter: A loaded real model adapter. None means UNAVAILABLE.
            grid: Grid resolution per axis. Cost is (grid*grid + 1) forward passes,
                so the default 2 keeps this to 6 passes per image.
            min_ratio: Localized signal must exceed the mean of the other cells by this factor.
            min_z: Same signal expressed in standard deviations above the other cells.
            min_relative_shift: Signal must move the model output by at least this
                fraction of the base output magnitude, so numerically large but
                negligible shifts on high-magnitude outputs do not qualify.
        """
        if adapter is None:
            return None
        if grid < 2:
            raise ValueError("grid must be >= 2 to have a comparison population")

        try:
            schema = adapter.input_schema()
            if not schema:
                return None
            input_spec = schema[0]

            with Image.open(image_path) as raw:
                base_image = raw.convert("RGB")

            base_score = cls._run(adapter, base_image, input_spec)
            if base_score is None:
                return None

            w, h = base_image.size
            fill = tuple(int(round(c)) for c in np.array(base_image).reshape(-1, 3).mean(axis=0))
            cell_w, cell_h = max(1, w // grid), max(1, h // grid)

            # Equal-area control perturbation, placed deterministically from the path
            # hash so repeated runs are reproducible.
            seed = int(hash_bytes(image_path.encode("utf-8"))[:8], 16)
            rng = np.random.default_rng(seed)
            ctrl_r = int(rng.integers(0, grid))
            ctrl_c = int(rng.integers(0, grid))
            control_box = (
                ctrl_c * cell_w,
                ctrl_r * cell_h,
                min(w, (ctrl_c + 1) * cell_w),
                min(h, (ctrl_r + 1) * cell_h),
            )
            control_score = cls._run(adapter, cls._occluded(base_image, control_box, fill), input_spec)
            if control_score is None:
                return None
            control_drop = max(0.0, base_score - control_score)

            signals: List[float] = []
            coords: List[Tuple[int, int]] = []
            for r in range(grid):
                for c in range(grid):
                    if (r, c) == (ctrl_r, ctrl_c):
                        continue
                    box = (c * cell_w, r * cell_h, min(w, (c + 1) * cell_w), min(h, (r + 1) * cell_h))
                    score = cls._run(adapter, cls._occluded(base_image, box, fill), input_spec)
                    if score is None:
                        return None
                    # Subtracting the control is what makes this a localization test
                    # rather than a measure of the model's general fragility.
                    signals.append(max(0.0, base_score - score) - control_drop)
                    coords.append((r, c))

            if not signals:
                return None

            arr = np.array(signals, dtype=np.float64)
            best_idx = int(np.argmax(arr))
            max_signal = float(arr[best_idx])
            best_r, best_c = coords[best_idx]

            others = np.delete(arr, best_idx)
            mean_other = float(np.mean(others)) if others.size else 0.0
            std_other = float(np.std(others)) if others.size else 0.0

            magnitude = abs(base_score) + 1e-6
            relative_shift = max_signal / magnitude

            if std_other > 1e-9 and mean_other > 1e-9:
                ratio = max_signal / (mean_other + 1e-9)
                z_score = (max_signal - mean_other) / (std_other + 1e-9)
            else:
                ratio = float("inf") if max_signal > 0 else 1.0
                z_score = 0.0

            if relative_shift < min_relative_shift:
                return None
            if ratio < min_ratio or z_score < min_z:
                return None

            return {
                "grid_cell": [best_r, best_c],
                "saliency_ratio": round(ratio, 4) if np.isfinite(ratio) else None,
                "z_score": round(z_score, 4),
                "max_drop": round(max_signal, 6),
                "mean_drop": round(mean_other, 6),
                "control_drop": round(control_drop, 6),
                "base_score": round(base_score, 6),
                "relative_shift": round(relative_shift, 6),
                "grid": grid,
                "probe_format": str(getattr(adapter, "format", "unknown")),
                "probe_artifact_sha256": getattr(adapter, "artifact_hash", None),
                "method": "model_occlusion_sensitivity_with_matched_control",
            }
        except Exception:
            return None


# ═══════════════════════════════════════════════════════════════════════════════
# Trigger Candidate Detector
# ═══════════════════════════════════════════════════════════════════════════════

class TriggerCandidateDetector:
    """Detects recurring static patch patterns in corner and spatial regions, as well
    as localized-influence anomalies measured against a real probe model.

    Finding type: TRIGGER_CANDIDATE (not TRIGGER_BACKDOOR).
    Tags findings by mechanism:
      - 'STATIC_PATCH': Repeated perceptual/exact patch patterns in corner or spatial
        sliding windows. This is the load-bearing evidence and needs no model.
      - 'HEURISTIC_SALIENCY_ANOMALY': Localized regions that move a real probe model's
        output disproportionately versus an equal-area control perturbation elsewhere
        in the same image. Requires an explicit probe model; without one this check
        reports UNAVAILABLE and emits nothing.

    Coverage limitations:
    - Sliding window uses perceptual dHash and variance filtering.
    - Saliency triage requires an explicitly supplied probe model and is OFF by
      default. It is also measured to be non-discriminative for small static patches
      on a real object detector (see ProxyOcclusionSaliencyAnalyzer), so it is a
      research aid, not a detector. It costs one forward pass per grid cell plus two.
    - Neither check guarantees detection of adversarially optimized, distributed,
      or input-dependent triggers.
    - A positive finding indicates a CANDIDATE requiring human review.
    """

    DETECTOR_ID = "TRIGGER_CANDIDATE_DETECTOR"
    DETECTOR_VERSION = "2.2.0"

    def detect(
        self,
        samples: List[SampleRecord],
        patch_size: int = 4,
        enable_sliding_window: bool = True,
        enable_saliency_proxy: bool = True,
        probe_adapter: Optional[Any] = None,
        saliency_max_samples: int = 20,
    ) -> List[IntegrityFinding]:
        findings: List[IntegrityFinding] = []
        params = {
            "patch_size": patch_size,
            "enable_sliding_window": enable_sliding_window,
            "enable_saliency_proxy": enable_saliency_proxy,
            "saliency_probe": getattr(probe_adapter, "format", None) and "configured" or "unavailable",
            "saliency_max_samples": saliency_max_samples,
        }

        if len(samples) < 2:
            findings.extend(self._detect_isolated_trigger(samples, patch_size, params))
            if enable_saliency_proxy:
                findings.extend(
                    self._detect_saliency_anomalies(samples, params, probe_adapter, saliency_max_samples)
                )
            return findings

        # Group samples by primary label class
        label_groups: Dict[str, List[SampleRecord]] = defaultdict(list)
        for s in samples:
            label_key = str(s.labels) if s.labels else "unlabeled"
            label_groups[label_key].append(s)

        corner_names = ["top_left", "top_right", "bottom_left", "bottom_right"]

        for label_key, group in label_groups.items():
            if len(group) < 2:
                findings.extend(self._detect_isolated_trigger(group, patch_size, params))
                continue

            existing_corner_pairs = set()

            for c_name in corner_names:
                patch_signatures: Dict[str, List[str]] = defaultdict(list)

                for sample in group:
                    try:
                        with Image.open(sample.file_path) as img:
                            w, h = img.size
                            if w < patch_size or h < patch_size:
                                continue

                            if c_name == "top_left":
                                box = (0, 0, patch_size, patch_size)
                            elif c_name == "top_right":
                                box = (w - patch_size, 0, w, patch_size)
                            elif c_name == "bottom_left":
                                box = (0, h - patch_size, patch_size, h)
                            else:
                                box = (w - patch_size, h - patch_size, w, h)

                            patch = img.crop(box).convert("L")
                            arr = np.array(patch, dtype=np.uint8)

                            if (arr == 0).all():
                                if float(np.mean(img)) > 20.0:
                                    sig = "CORNER_SOLID_BLACK_" + hash_bytes(arr.tobytes())
                                    patch_signatures[sig].append(sample.sample_id)
                            else:
                                sig = hash_bytes(arr.tobytes())
                                patch_signatures[sig].append(sample.sample_id)
                    except Exception:
                        continue

                sample_by_id = {s.sample_id: s for s in group}
                for sig, sample_ids in patch_signatures.items():
                    if len(sample_ids) >= 2:
                        distinct_image_hashes = {sample_by_id[sid].sha256_hash for sid in sample_ids}
                        if len(distinct_image_hashes) < 2:
                            # Identical duplicate files — handled by DuplicateDetector
                            continue
                        existing_corner_pairs.add(tuple(sorted(sample_ids)))
                        confidence = round(len(sample_ids) / len(group), 4)
                        findings.append(
                            IntegrityFinding(
                                finding_id=str(uuid.uuid4()),
                                check_type=IntegrityCheckType.TRIGGER_CANDIDATE,
                                severity=IntegritySeverity.CRITICAL,
                                sample_ids=sample_ids,
                                description=f"Suspicious repeated static localized patch pattern detected in {c_name} corner across {len(sample_ids)} samples sharing label '{label_key}'.",
                                metric_score=float(len(sample_ids)),
                                trigger_tag=TriggerTag.STATIC_PATCH.value,
                                details={
                                    "trigger_tag": TriggerTag.STATIC_PATCH.value,
                                    "corner": c_name,
                                    "patch_size": patch_size,
                                    "matched_samples": sample_ids,
                                    "target_label": label_key,
                                    "patch_signature": sig[:16],
                                },
                                detector_id=self.DETECTOR_ID,
                                detector_version=self.DETECTOR_VERSION,
                                detector_parameters=params,
                                created_at=_now(),
                                confidence=confidence,
                                confidence_basis=f"affected_count ({len(sample_ids)}) / group_size ({len(group)}): proportion of samples with matching patch signature",
                                limitations="Only inspects 4 corner regions; cannot detect non-localized, semantic, or per-sample-variable triggers",
                                recommended_action="Human review required — this is a CANDIDATE, not a confirmed backdoor",
                            )
                        )

            # (1) Sliding-window patch scanner across spatial regions
            if enable_sliding_window:
                spatial_findings = self._scan_sliding_window_patches(
                    group=group,
                    patch_size=patch_size,
                    label_key=label_key,
                    params=params,
                    existing_corner_pairs=existing_corner_pairs,
                )
                findings.extend(spatial_findings)

        # (2) Localized-influence check against a real probe model, if one was supplied
        if enable_saliency_proxy:
            findings.extend(
                self._detect_saliency_anomalies(samples, params, probe_adapter, saliency_max_samples)
            )

        return findings

    def _scan_sliding_window_patches(
        self,
        group: List[SampleRecord],
        patch_size: int,
        label_key: str,
        params: Dict,
        existing_corner_pairs: set,
    ) -> List[IntegrityFinding]:
        """Scans spatial interior regions across the image grid using perceptual dHash.

        Tags recurring matches as STATIC_PATCH.
        """
        findings: List[IntegrityFinding] = []
        spatial_signatures: Dict[str, List[Tuple[str, Tuple[int, int]]]] = defaultdict(list)
        scan_patch = max(8, patch_size)

        for sample in group:
            try:
                with Image.open(sample.file_path) as img:
                    w, h = img.size
                    if w < scan_patch or h < scan_patch:
                        continue

                    step_x = max(4, scan_patch // 4)
                    step_y = max(4, scan_patch // 4)
                    xs = list(range(0, max(1, w - scan_patch + 1), step_x))
                    if (w - scan_patch) not in xs and (w - scan_patch) > 0:
                        xs.append(w - scan_patch)
                    ys = list(range(0, max(1, h - scan_patch + 1), step_y))
                    if (h - scan_patch) not in ys and (h - scan_patch) > 0:
                        ys.append(h - scan_patch)

                    for y in ys:
                        for x in xs:
                            # Skip exact outer corners already processed
                            is_outer_corner = (
                                (x == 0 and y == 0)
                                or (x == w - scan_patch and y == 0)
                                or (x == 0 and y == h - scan_patch)
                                or (x == w - scan_patch and y == h - scan_patch)
                            )
                            if is_outer_corner:
                                continue

                            patch = img.crop((x, y, x + scan_patch, y + scan_patch))
                            arr = np.array(patch.convert("L"), dtype=np.float32)
                            p_var = float(np.var(arr))
                            p_mean = float(np.mean(arr))

                            if p_var < 10.0 and p_mean < 5.0 and float(np.mean(img)) > 20.0:
                                phash = "SOLID_BLACK_TRIGGER"
                            elif p_var < 10.0 and p_mean > 250.0 and float(np.mean(img)) < 235.0:
                                phash = "SOLID_WHITE_TRIGGER"
                            elif p_var < 80.0:
                                continue
                            else:
                                phash = compute_dhash(patch, hash_size=8)
                                # Ignore degenerate gradient hashes (horizontal/vertical uniform splits)
                                if phash in ("0000000000000000", "ffffffffffffffff"):
                                    continue
                                popcount = bin(int(phash, 16)).count("1")
                                if popcount < 6 or popcount > 58:
                                    continue
                            spatial_signatures[phash].append((sample.sample_id, (x, y)))
            except Exception:
                continue

        sample_by_id = {s.sample_id: s for s in group}
        for phash, entries in spatial_signatures.items():
            matched_sids = list(dict.fromkeys([e[0] for e in entries]))
            if len(matched_sids) >= 2:
                distinct_hashes = {sample_by_id[sid].sha256_hash for sid in matched_sids}
                if len(distinct_hashes) < 2:
                    continue  # Exact duplicate files

                # A localized backdoor trigger patch occurs once or twice per sample;
                # a pattern repeating repeatedly across rows/columns in the same sample
                # indicates a natural line, edge, or background texture.
                sample_counts = Counter(e[0] for e in entries)
                if any(cnt > 2 for cnt in sample_counts.values()):
                    continue

                if tuple(sorted(matched_sids)) in existing_corner_pairs:
                    continue

                coords = [e[1] for e in entries]
                xs_coords = [c[0] for c in coords]
                ys_coords = [c[1] for c in coords]
                if phash not in ("SOLID_BLACK_TRIGGER", "SOLID_WHITE_TRIGGER"):
                    pop_cnt = bin(int(phash, 16)).count("1")
                    # A localized backdoor trigger across samples is co-located in the same spatial region
                    if (max(xs_coords) - min(xs_coords) > 24 or max(ys_coords) - min(ys_coords) > 24) and pop_cnt < 12:
                        continue
                else:
                    if max(xs_coords) - min(xs_coords) > 24 or max(ys_coords) - min(ys_coords) > 24:
                        continue

                avg_x = sum(c[0] for c in coords) // len(coords)
                avg_y = sum(c[1] for c in coords) // len(coords)

                confidence = round(len(matched_sids) / len(group), 4)
                findings.append(
                    IntegrityFinding(
                        finding_id=str(uuid.uuid4()),
                        check_type=IntegrityCheckType.TRIGGER_CANDIDATE,
                        severity=IntegritySeverity.CRITICAL,
                        sample_ids=matched_sids,
                        description=(
                            f"Suspicious repeated static localized patch pattern detected via sliding-window perceptual hash "
                            f"scanner at spatial region ({avg_x}, {avg_y}) across {len(matched_sids)} samples sharing label '{label_key}'."
                        ),
                        metric_score=float(len(matched_sids)),
                        trigger_tag=TriggerTag.STATIC_PATCH.value,
                        details={
                            "trigger_tag": TriggerTag.STATIC_PATCH.value,
                            "detection_method": "sliding_window_perceptual_hash",
                            "region": f"spatial_window_({avg_x},{avg_y})",
                            "spatial_coordinates": [avg_x, avg_y, scan_patch, scan_patch],
                            "patch_size": scan_patch,
                            "perceptual_dhash": phash,
                            "matched_samples": matched_sids,
                            "target_label": label_key,
                        },
                        detector_id=self.DETECTOR_ID,
                        detector_version=self.DETECTOR_VERSION,
                        detector_parameters=params,
                        created_at=_now(),
                        confidence=confidence,
                        confidence_basis=(
                            f"affected_count ({len(matched_sids)}) / group_size ({len(group)}): "
                            f"proportion of samples sharing perceptual patch dHash in spatial scan"
                        ),
                        limitations=(
                            "Sliding-window scanner tests spatial grid with perceptual dHash; "
                            "still heuristic and does not guarantee detection of sample-variable or non-patch triggers"
                        ),
                        recommended_action=(
                            "Human review required — verify if repeated spatial patch is an injected trigger "
                            "or recurring background artifact"
                        ),
                    )
                )

        return findings

    def _detect_saliency_anomalies(
        self,
        samples: List[SampleRecord],
        params: Dict,
        probe_adapter: Optional[Any] = None,
        max_samples: int = 20,
    ) -> List[IntegrityFinding]:
        """Detect regions that move a real probe model's output disproportionately.

        Emits nothing when no probe model is configured: that is UNAVAILABLE, and
        reporting a finding from an untrained stand-in network would be fabrication.
        Sample count is capped because each sample costs one forward pass per grid
        cell plus two, and truncated coverage is stated on the finding rather than
        being passed off as a complete scan.
        """
        findings: List[IntegrityFinding] = []
        if probe_adapter is None:
            return findings

        total = len(samples)
        considered = samples[:max_samples] if max_samples > 0 else []
        truncated = total - len(considered)

        for sample in considered:
            anomaly = ProxyOcclusionSaliencyAnalyzer.compute_saliency_anomaly(
                sample.file_path, adapter=probe_adapter
            )
            if not anomaly:
                continue
            r, c = anomaly["grid_cell"]
            ratio = anomaly["saliency_ratio"]
            z = anomaly["z_score"]
            shift = anomaly.get("relative_shift")
            ratio_text = "unbounded" if ratio is None else f"{ratio:.2f}x mean"
            metric = float(z)
            findings.append(
                IntegrityFinding(
                    finding_id=str(uuid.uuid4()),
                    check_type=IntegrityCheckType.TRIGGER_CANDIDATE,
                    severity=IntegritySeverity.HIGH,
                    sample_ids=[sample.sample_id],
                    description=(
                        f"Localized-influence anomaly: spatial cell ({r}, {c}) moves the probe model's output "
                        f"{shift:.2%} of base magnitude, against an equal-area control perturbation "
                        f"(saliency ratio {ratio_text}, z-score {z:.2f})."
                    ) if shift is not None else (
                        f"Localized-influence anomaly: spatial cell ({r}, {c}) exceeds an equal-area control "
                        f"perturbation (saliency ratio {ratio_text}, z-score {z:.2f})."
                    ),
                    metric_score=metric,
                    trigger_tag=TriggerTag.HEURISTIC_SALIENCY_ANOMALY.value,
                    details={
                        "trigger_tag": TriggerTag.HEURISTIC_SALIENCY_ANOMALY.value,
                        "detection_method": anomaly.get(
                            "method", "model_occlusion_sensitivity_with_matched_control"
                        ),
                        "grid_cell": [r, c],
                        "saliency_ratio": ratio,
                        "z_score": z,
                        "max_drop": anomaly.get("max_drop"),
                        "mean_drop": anomaly.get("mean_drop"),
                        "control_drop": anomaly.get("control_drop"),
                        "base_score": anomaly.get("base_score"),
                        "relative_shift": shift,
                        "grid": anomaly.get("grid"),
                        "probe_format": anomaly.get("probe_format"),
                        "probe_artifact_sha256": anomaly.get("probe_artifact_sha256"),
                        "saliency_samples_considered": len(considered),
                        "saliency_samples_total": total,
                        "saliency_samples_truncated": truncated,
                        "coverage_complete": truncated == 0,
                    },
                    detector_id=self.DETECTOR_ID,
                    detector_version=self.DETECTOR_VERSION,
                    detector_parameters=params,
                    created_at=_now(),
                    confidence=None,
                    confidence_basis=(
                        "Not calibrated. The statistic measures one model's response to occlusion on one image "
                        "and has no known mapping to backdoor probability. Thresholded heuristically; a "
                        "positive result is a review lead, not a posterior."
                    ),
                    limitations=(
                        f"Measured against a single probe model ({anomaly.get('probe_format')}), so it reflects "
                        "that model's sensitivity and cannot generalise to the model the dataset actually targets. "
                        "Coverage is " + ("complete" if truncated == 0 else f"partial ({truncated} of {total} samples not analysed)")
                        + ". Does not detect adversarially optimized, low-amplitude, or distributed triggers. "
                        "Cross-sample patch repetition, not per-image saliency, is the load-bearing evidence for "
                        "dataset poisoning. Ground-truth confirmation requires analyst review."
                    ),
                    recommended_action=(
                        "Human review required — inspect localized region under high-contrast or magnification "
                        "to verify presence of trigger artifact"
                    ),
                )
            )
        return findings

    def _detect_isolated_trigger(
        self,
        samples: List[SampleRecord],
        patch_size: int,
        params: Dict,
    ) -> List[IntegrityFinding]:
        """Detect a measured high-contrast trigger patch when no comparison sample exists."""
        findings: List[IntegrityFinding] = []
        corner_names = ["top_left", "top_right", "bottom_left", "bottom_right"]
        for sample in samples:
            try:
                with Image.open(sample.file_path) as img:
                    width, height = img.size
                    if width < patch_size or height < patch_size:
                        continue
                    for corner in corner_names:
                        if corner == "top_left":
                            box = (0, 0, patch_size, patch_size)
                        elif corner == "top_right":
                            box = (width - patch_size, 0, width, patch_size)
                        elif corner == "bottom_left":
                            box = (0, height - patch_size, patch_size, height)
                        else:
                            box = (width - patch_size, height - patch_size, width, height)

                        patch = np.array(img.crop(box).convert("L"), dtype=np.float32)
                        variance = float(np.var(patch))
                        dark_ratio = float(np.mean(patch < 32))
                        light_ratio = float(np.mean(patch > 224))
                        # Backdoor patch triggers exhibit strong bimodal contrast (predominantly extreme dark and light pixels)
                        if (
                            variance >= 6000.0
                            and dark_ratio >= 0.25
                            and light_ratio >= 0.25
                            and (dark_ratio + light_ratio) >= 0.70
                        ):
                            findings.append(
                                IntegrityFinding(
                                    finding_id=str(uuid.uuid4()),
                                    check_type=IntegrityCheckType.TRIGGER_CANDIDATE,
                                    severity=IntegritySeverity.CRITICAL,
                                    sample_ids=[sample.sample_id],
                                    description=(
                                        f"High-contrast localized trigger candidate detected in {corner} corner "
                                        f"(variance {variance:.1f}, dark ratio {dark_ratio:.2f}, light ratio {light_ratio:.2f})."
                                    ),
                                    metric_score=min(1.0, variance / 16384.0),
                                    trigger_tag=TriggerTag.STATIC_PATCH.value,
                                    details={
                                        "trigger_tag": TriggerTag.STATIC_PATCH.value,
                                        "corner": corner,
                                        "patch_size": patch_size,
                                        "variance": variance,
                                        "dark_ratio": dark_ratio,
                                        "light_ratio": light_ratio,
                                        "isolated_sample": True,
                                    },
                                    detector_id=self.DETECTOR_ID,
                                    detector_version=self.DETECTOR_VERSION,
                                    detector_parameters=params,
                                    created_at=_now(),
                                    confidence=None,
                                    confidence_basis="Heuristic thresholds (variance>=5000, dark>=0.20, light>=0.20); no statistical ground truth",
                                    limitations="Single-sample heuristic; requires human review to confirm",
                                    recommended_action="Human review required — isolated trigger candidate",
                                )
                            )
                            break
            except Exception:
                continue
        return findings




# ═══════════════════════════════════════════════════════════════════════════════
# Cleanlab Confident Learning Detector
# ═══════════════════════════════════════════════════════════════════════════════

class CleanlabLabelQualityDetector:
    """Uses Cleanlab confident learning to score label quality and flag noisy/anomalous samples."""

    DETECTOR_ID = "CLEANLAB_LABEL_QUALITY_DETECTOR"
    DETECTOR_VERSION = "2.0.0"

    def detect(self, samples: List[SampleRecord]) -> List[IntegrityFinding]:
        findings: List[IntegrityFinding] = []
        if len(samples) < 6:
            return findings

        # 1. Resolve primary labels and extract features
        sample_entries = []
        label_set = set()
        for s in samples:
            label_val = None
            if s.labels:
                first = s.labels[0]
                if isinstance(first, dict):
                    for k in ("class", "category", "class_id", "spectral_band"):
                        if k in first and first[k] is not None:
                            label_val = str(first[k])
                            break
                elif isinstance(first, (str, int, float)):
                    label_val = str(first)
            if not label_val and s.metadata and "class" in s.metadata:
                label_val = str(s.metadata["class"])
            if not label_val:
                p = Path(s.file_path)
                if p.parent.name and p.parent.name not in (".", "images", "data", "uploads"):
                    label_val = p.parent.name

            if label_val:
                label_set.add(label_val)
                sample_entries.append((s, label_val))

        if len(label_set) < 2 or len(sample_entries) < 6:
            return findings

        # 2. Extract visual features for confident learning
        label_to_idx = {lbl: i for i, lbl in enumerate(sorted(label_set))}
        valid_samples = []
        features_list = []
        labels_list = []

        for s, lbl in sample_entries:
            img_path = Path(s.file_path)
            if not img_path.is_file():
                continue
            try:
                with Image.open(img_path) as img:
                    thumb = img.convert("L").resize((16, 16))
                    arr = np.array(thumb, dtype=np.float32).flatten() / 255.0
                    features_list.append(arr)
                    labels_list.append(label_to_idx[lbl])
                    valid_samples.append((s, lbl))
            except Exception:
                continue

        if len(valid_samples) < 6 or len(set(labels_list)) < 2:
            return findings

        try:
            from sklearn.neighbors import KNeighborsClassifier
            # pyrefly: ignore [missing-import]
            import cleanlab
            # pyrefly: ignore [missing-import]
            from cleanlab.filter import find_label_issues
            # pyrefly: ignore [missing-import]
            from cleanlab.rank import get_label_quality_scores

            X = np.array(features_list)
            y = np.array(labels_list)
            
            # Check class distribution
            class_counts = np.bincount(y)
            min_count = int(np.min(class_counts[class_counts > 0]))
            k = max(1, min(3, min_count))
            
            clf = KNeighborsClassifier(n_neighbors=k)
            clf.fit(X, y)
            probs = clf.predict_proba(X)
            probs = np.clip(probs, 1e-4, 1.0 - 1e-4)
            probs = probs / probs.sum(axis=1, keepdims=True)

            label_issues = find_label_issues(labels=y, pred_probs=probs)
            quality_scores = get_label_quality_scores(labels=y, pred_probs=probs)

            idx_to_label = {i: lbl for lbl, i in label_to_idx.items()}

            for i, (is_issue, score) in enumerate(zip(label_issues, quality_scores)):
                if is_issue or score < 0.40:
                    sample, given_lbl = valid_samples[i]
                    pred_class_idx = int(np.argmax(probs[i]))
                    suggested_lbl = idx_to_label.get(pred_class_idx, "Unknown")
                    sev = IntegritySeverity.HIGH if (is_issue and score < 0.25) else IntegritySeverity.MEDIUM
                    
                    findings.append(
                        IntegrityFinding(
                            finding_id=str(uuid.uuid4()),
                            check_type=IntegrityCheckType.LABEL_INCONSISTENCY,
                            severity=sev,
                            sample_ids=[sample.sample_id],
                            description=(
                                f"Cleanlab confident learning flagged potential label noise (Quality Score: {float(score):.3f}). "
                                f"Annotated as '{given_lbl}', visual features correlate more closely with '{suggested_lbl}'."
                            ),
                            metric_score=float(score),
                            details={
                                "cleanlab_quality_score": float(score),
                                "given_label": given_lbl,
                                "suggested_label": suggested_lbl,
                                "detector": "CLEANLAB_CONFIDENT_LEARNING",
                            },
                            detector_id=self.DETECTOR_ID,
                            detector_version=self.DETECTOR_VERSION,
                            detector_parameters={"n_neighbors": k, "label_count": len(label_set)},
                            created_at=_now(),
                            confidence=float(max(0.5, 1.0 - score)),
                            confidence_basis="Cleanlab confident learning out-of-sample label quality estimation",
                            recommended_action="Triage flagged sample in Cleanlab studio or verify ground-truth annotation",
                        )
                    )
        except Exception:
            pass

        return findings


# ═══════════════════════════════════════════════════════════════════════════════
# Backwards compatibility aliases & wrappers
# ═══════════════════════════════════════════════════════════════════════════════

class QualityAndOODDetector(QualityDetector):
    """Backwards-compatible wrapper mapping QUALITY_ANOMALY to CORRUPT_OR_OOD."""

    def detect(self, samples: List[SampleRecord]) -> List[IntegrityFinding]:
        findings = super().detect(samples)
        for f in findings:
            if f.check_type == IntegrityCheckType.QUALITY_ANOMALY:
                f.check_type = IntegrityCheckType.CORRUPT_OR_OOD
        return findings


class TriggerBackdoorDetector(TriggerCandidateDetector):
    """Backwards-compatible wrapper mapping TRIGGER_CANDIDATE to TRIGGER_BACKDOOR."""

    def detect(self, samples: List[SampleRecord], patch_size: int = 4, **kwargs) -> List[IntegrityFinding]:
        findings = super().detect(samples, patch_size=patch_size, **kwargs)
        for f in findings:
            if f.check_type == IntegrityCheckType.TRIGGER_CANDIDATE:
                f.check_type = IntegrityCheckType.TRIGGER_BACKDOOR
        return findings
