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
    """Lightweight proxy-model occlusion sensitivity scanner to detect localized regions
    with abnormally high influence on prediction relative to the rest of the image.

    Serves as an additional heuristic proxy signal for optimized, imperceptible, or non-static triggers.
    """
    _proxy_net = None

    @classmethod
    def get_proxy_net(cls):
        if cls._proxy_net is None:
            try:
                import torch
                import torch.nn as nn

                class SmallProxyNet(nn.Module):
                    def __init__(self):
                        super().__init__()
                        self.conv1 = nn.Conv2d(3, 16, 3, padding=1)
                        self.pool = nn.MaxPool2d(2, 2)
                        self.conv2 = nn.Conv2d(16, 32, 3, padding=1)
                        self.fc = nn.Linear(32 * 8 * 8, 10)

                    def forward(self, x):
                        x = self.pool(torch.relu(self.conv1(x)))
                        x = self.pool(torch.relu(self.conv2(x)))
                        x = torch.flatten(x, 1)
                        return self.fc(x)

                torch.manual_seed(42)
                net = SmallProxyNet()
                net.eval()
                cls._proxy_net = net
            except Exception:
                cls._proxy_net = False
        return cls._proxy_net

    @classmethod
    def compute_saliency_anomaly(cls, image_path: str) -> Optional[Dict[str, Any]]:
        """Returns saliency anomaly details if a localized patch disproportionately influences output."""
        try:
            with Image.open(image_path) as img:
                rgb = img.convert("RGB").resize((32, 32), resample=Image.Resampling.BILINEAR)
                arr = np.array(rgb, dtype=np.float32) / 255.0

            net = cls.get_proxy_net()
            if net and net is not False:
                import torch
                tensor = torch.tensor(arr.transpose(2, 0, 1), dtype=torch.float32).unsqueeze(0)
                with torch.no_grad():
                    logits = net(tensor)
                    probs = torch.softmax(logits, dim=1)[0]
                    top_class = int(torch.argmax(probs).item())
                    base_prob = float(probs[top_class].item())

                    # 4x4 grid occlusion (each cell is 8x8 in 32x32 image)
                    drops = []
                    grid_coords = []
                    for r in range(4):
                        for c in range(4):
                            occ_tensor = tensor.clone()
                            occ_tensor[0, :, r * 8 : (r + 1) * 8, c * 8 : (c + 1) * 8] = 0.5
                            occ_logits = net(occ_tensor)
                            occ_prob = float(torch.softmax(occ_logits, dim=1)[0, top_class].item())
                            drop = max(0.0, base_prob - occ_prob)
                            drops.append(drop)
                            grid_coords.append((r, c))

                    drops_arr = np.array(drops, dtype=np.float32)
                    mean_drop = float(np.mean(drops_arr))
                    std_drop = float(np.std(drops_arr))
                    max_idx = int(np.argmax(drops_arr))
                    max_drop = float(drops_arr[max_idx])
                    best_r, best_c = grid_coords[max_idx]

                    if std_drop > 1e-4 and mean_drop > 1e-4:
                        ratio = max_drop / (mean_drop + 1e-6)
                        z_score = (max_drop - mean_drop) / (std_drop + 1e-6)
                    else:
                        ratio = 1.0
                        z_score = 0.0

                    if ratio >= 3.0 and z_score >= 2.2 and max_drop >= 0.12:
                        return {
                            "grid_cell": [best_r, best_c],
                            "saliency_ratio": round(ratio, 4),
                            "z_score": round(z_score, 4),
                            "max_drop": round(max_drop, 4),
                            "mean_drop": round(mean_drop, 4),
                            "method": "proxy_model_occlusion_sensitivity",
                        }
            else:
                gray = np.mean(arr, axis=2)
                energies = []
                coords = []
                for r in range(4):
                    for c in range(4):
                        block = gray[r * 8 : (r + 1) * 8, c * 8 : (c + 1) * 8]
                        var = float(np.var(block))
                        energies.append(var)
                        coords.append((r, c))
                energies_arr = np.array(energies, dtype=np.float32)
                mean_e = float(np.mean(energies_arr))
                std_e = float(np.std(energies_arr))
                max_idx = int(np.argmax(energies_arr))
                max_e = float(energies_arr[max_idx])
                best_r, best_c = coords[max_idx]
                if std_e > 1e-4 and mean_e > 1e-4:
                    ratio = max_e / (mean_e + 1e-6)
                    z_score = (max_e - mean_e) / (std_e + 1e-6)
                    if ratio >= 4.0 and z_score >= 2.5 and max_e >= 0.08:
                        return {
                            "grid_cell": [best_r, best_c],
                            "saliency_ratio": round(ratio, 4),
                            "z_score": round(z_score, 4),
                            "max_drop": round(max_e, 4),
                            "mean_drop": round(mean_e, 4),
                            "method": "numpy_energy_concentration",
                        }
        except Exception:
            pass
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# Trigger Candidate Detector
# ═══════════════════════════════════════════════════════════════════════════════

class TriggerCandidateDetector:
    """Detects recurring static patch patterns in corner and spatial regions, as well
    as heuristic saliency anomalies via proxy occlusion sensitivity.

    Finding type: TRIGGER_CANDIDATE (not TRIGGER_BACKDOOR).
    Tags findings by mechanism:
      - 'STATIC_PATCH': Repeated perceptual/exact patch patterns in corner or spatial sliding windows.
      - 'HEURISTIC_SALIENCY_ANOMALY': Localized regions with abnormally high predictive influence
        on a proxy model (heuristic proxy signal for optimized/imperceptible triggers).

    Coverage limitations:
    - Sliding window uses perceptual dHash and variance filtering.
    - Saliency check uses proxy occlusion sensitivity; does not guarantee detection of
      adversarially optimized or distributed triggers.
    - A positive finding indicates a CANDIDATE requiring human review.
    """

    DETECTOR_ID = "TRIGGER_CANDIDATE_DETECTOR"
    DETECTOR_VERSION = "2.1.0"

    def detect(
        self,
        samples: List[SampleRecord],
        patch_size: int = 4,
        enable_sliding_window: bool = True,
        enable_saliency_proxy: bool = True,
    ) -> List[IntegrityFinding]:
        findings: List[IntegrityFinding] = []
        params = {
            "patch_size": patch_size,
            "enable_sliding_window": enable_sliding_window,
            "enable_saliency_proxy": enable_saliency_proxy,
        }

        if len(samples) < 2:
            findings.extend(self._detect_isolated_trigger(samples, patch_size, params))
            if enable_saliency_proxy:
                findings.extend(self._detect_saliency_anomalies(samples, params))
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

        # (2) Lightweight saliency-based check on proxy model
        if enable_saliency_proxy:
            findings.extend(self._detect_saliency_anomalies(samples, params))

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
    ) -> List[IntegrityFinding]:
        """Detect localized regions with abnormally high predictive influence using proxy occlusion sensitivity."""
        findings: List[IntegrityFinding] = []
        for sample in samples:
            anomaly = ProxyOcclusionSaliencyAnalyzer.compute_saliency_anomaly(sample.file_path)
            if anomaly:
                r, c = anomaly["grid_cell"]
                ratio = anomaly["saliency_ratio"]
                z = anomaly["z_score"]
                findings.append(
                    IntegrityFinding(
                        finding_id=str(uuid.uuid4()),
                        check_type=IntegrityCheckType.TRIGGER_CANDIDATE,
                        severity=IntegritySeverity.HIGH,
                        sample_ids=[sample.sample_id],
                        description=(
                            f"Heuristic saliency anomaly: localized spatial cell ({r}, {c}) exhibits abnormally high "
                            f"predictive influence (saliency ratio {ratio:.2f}x mean, z-score {z:.2f}) on proxy model."
                        ),
                        metric_score=float(ratio),
                        trigger_tag=TriggerTag.HEURISTIC_SALIENCY_ANOMALY.value,
                        details={
                            "trigger_tag": TriggerTag.HEURISTIC_SALIENCY_ANOMALY.value,
                            "detection_method": anomaly.get("method", "proxy_occlusion_sensitivity"),
                            "grid_cell": [r, c],
                            "saliency_ratio": ratio,
                            "z_score": z,
                            "max_drop": anomaly.get("max_drop"),
                            "mean_drop": anomaly.get("mean_drop"),
                        },
                        detector_id=self.DETECTOR_ID,
                        detector_version=self.DETECTOR_VERSION,
                        detector_parameters=params,
                        created_at=_now(),
                        confidence=0.50,
                        confidence_basis=(
                            "Heuristic proxy-model occlusion sensitivity: localized cell accounts for >3x mean "
                            "predictive influence; proxy signal only, not a ground-truth backdoor proof"
                        ),
                        limitations=(
                            "Heuristic proxy signal only; does not guarantee detection of adversarially optimized, "
                            "low-amplitude, or distributed triggers. Ground-truth confirmation requires analyst review."
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
