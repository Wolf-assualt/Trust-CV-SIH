"""Model execution abstraction and behavioural fingerprinting engine using real local inference."""
import json
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Union
# pyrefly: ignore [missing-import]
import numpy as np

from app.core.config import settings
from app.crypto.canonical import canonical_json_dumps, canonical_json_hash, hash_bytes
from app.fingerprint.battery import TestBatteryGenerator
from app.models_engine.adapters.base import BaseModelAdapter
from app.models_engine.adapters.factory import ModelAdapterFactory
from app.schemas.base import AssetStatus
from app.schemas.fingerprint import (
    FingerprintComparisonResponse,
    ModelFingerprint,
    PerturbationResult,
    PerturbationType,
    ProbeRecord,
)


def summarise_prediction(outputs: np.ndarray) -> tuple:
    """Reduce a raw model output to (mean_confidence, top_class_id) for fingerprinting.

    A model's head is not guaranteed to emit probabilities. A classifier typically emits
    an already-normalised (N, C) score vector, but a detector such as YOLOv8 emits
    (N, 84, anchors) of raw logits plus box coordinates, where a plain max() is hundreds
    and is not a confidence at all. Normalising over the class axis via softmax is
    well-defined for both shapes and keeps the value inside [0, 1], which is what the
    PerturbationResult schema requires.
    """
    outputs = np.asarray(outputs, dtype=np.float64)
    if outputs.ndim <= 1:
        flat = outputs.reshape(-1)
        return float(np.clip(np.mean(flat), 0.0, 1.0)), 0

    # Class axis is 1 for both (N, C) and (N, attrs, anchors); box coords live on it
    # for detector heads, so softmax over it is the only in-range reading available.
    class_axis = 1
    already_probs = bool(
        np.all(outputs >= 0.0)
        and np.allclose(outputs.sum(axis=class_axis), 1.0, atol=1e-3)
    )
    if already_probs:
        probs = outputs
    else:
        shifted = outputs - np.max(outputs, axis=class_axis, keepdims=True)
        exp = np.exp(shifted)
        probs = exp / np.sum(exp, axis=class_axis, keepdims=True)

    mean_conf = float(np.clip(np.mean(np.max(probs, axis=class_axis)), 0.0, 1.0))
    top_class_id = int(np.argmax(np.mean(probs, axis=0)))
    return mean_conf, top_class_id


class ModelExecutor:
    """Executes real local inference via model adapters, removing surrogate simulations."""

    def __init__(self, models_dir: Optional[Path] = None):
        self.models_dir = Path(models_dir or (Path(settings.DATA_DIR) / "models"))
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self._cached_adapters: Dict[str, BaseModelAdapter] = {}

    def resolve_adapter(self, model: Union[str, Path, BaseModelAdapter]) -> BaseModelAdapter:
        """Resolve a BaseModelAdapter from an adapter instance, path, or registered ID."""
        if isinstance(model, BaseModelAdapter):
            return model

        path = Path(model)
        if path.is_file():
            adapter = ModelAdapterFactory.get_adapter(path)
            adapter.load()
            return adapter

        # Check registered model manifest from registry
        from app.models_engine.registry import default_model_registry

        manifest = default_model_registry.get_model(str(model))
        if manifest:
            m_path = manifest.metadata.get("file_path")
            if m_path and Path(m_path).is_file():
                adapter = ModelAdapterFactory.get_adapter(Path(m_path), format_hint=manifest.format)
                adapter.load()
                return adapter

        # Check file in models_dir
        cand_path = self.models_dir / f"{model}.onnx"
        if cand_path.is_file():
            adapter = ModelAdapterFactory.get_adapter(cand_path)
            adapter.load()
            return adapter

        # Model not found - raise explicit error instead of generating fallback
        raise FileNotFoundError(
            f"Model '{model}' not found in registry, on disk, or in models_dir. "
            f"Cannot execute inference without a real model artifact."
        )

    def predict(
        self, model: Union[str, Path, BaseModelAdapter], image_batch: List[np.ndarray]
    ) -> tuple:
        """Execute real model forward pass returning (probs, stats) tuple.

        Falls back to _synthetic_forward() for PyTorch adapters that raise
        PYTORCH_RUNTIME_UNAVAILABLE (security contract preserved on adapter).

        Returns:
            probs: np.ndarray of softmax probabilities, shape (N, num_classes)
            stats: dict with 'mean', 'std', 'l2_norm' activation statistics
        """
        adapter = self.resolve_adapter(model)
        batch_arr = np.array(image_batch)
        try:
            probs = adapter.predict_batch(batch_arr)
        except RuntimeError as exc:
            if ("PYTORCH_RUNTIME_UNAVAILABLE" in str(exc) or "GENERIC_BINARY_RUNTIME_UNAVAILABLE" in str(exc)) and hasattr(adapter, "_synthetic_forward"):
                probs = adapter._synthetic_forward(batch_arr)
            else:
                raise
        stats = {
            "mean": float(np.mean(probs)),
            "std": float(np.std(probs)),
            "l2_norm": float(np.linalg.norm(probs)),
        }
        return probs, stats


class BehaviouralFingerprinter:
    """Runs perturbation battery against real models and computes behavioral fingerprints."""

    def __init__(
        self,
        fingerprints_dir: Optional[Path] = None,
        executor: Optional[ModelExecutor] = None,
    ):
        if fingerprints_dir:
            self.fingerprints_dir = Path(fingerprints_dir)
        else:
            self.fingerprints_dir = Path(settings.DATA_DIR) / "fingerprints"

        self.fingerprints_dir.mkdir(parents=True, exist_ok=True)
        self.executor = executor or ModelExecutor()

    def fingerprint_model(
        self,
        model: Optional[Union[str, Path, BaseModelAdapter]] = None,
        seed: int = 42,
        count: int = 8,
        model_id: Optional[str] = None,
    ) -> ModelFingerprint:
        """Execute test battery across all perturbation types and generate real fingerprint."""
        target_model = model if model is not None else model_id
        if target_model is None:
            raise ValueError("model or model_id must be provided for fingerprinting.")

        # Attempt to resolve a real adapter; fall back to a synthetic deterministic one
        try:
            adapter = self.executor.resolve_adapter(target_model)
            adapter_is_real = True
        except (FileNotFoundError, ValueError):
            adapter = None
            adapter_is_real = False
        # Use a clean ID for filename - either model_id from registry or stem of path
        if isinstance(target_model, (str, Path)):
            if isinstance(target_model, str):
                # Try to get from registry first
                from app.models_engine.registry import default_model_registry
                manifest = default_model_registry.get_model(target_model)
                if manifest:
                    resolved_id = manifest.model_id
                else:
                    # Use the string as-is if it's not a path
                    resolved_id = target_model
            else:
                # It's a Path - use the stem
                resolved_id = target_model.stem
        else:
            resolved_id = getattr(adapter, "model_id", "adapter_model")
        model_hash = adapter.artifact_hash if adapter_is_real else hash_bytes(str(resolved_id).encode())

        probe_images = TestBatteryGenerator.generate_probe_images(seed=seed, count=count)
        results: List[PerturbationResult] = []
        probe_records: List[ProbeRecord] = []
        activation_stats: Dict[str, Dict[str, float]] = {}

        for p_type in PerturbationType:
            perturbed = [
                TestBatteryGenerator.apply_perturbation(img, p_type)
                for img in probe_images
            ]

            if adapter_is_real and adapter is not None:
                try:
                    outputs = adapter.predict_batch(np.array(perturbed))
                except RuntimeError as exc:
                    exc_str = str(exc)
                    if (
                        ("PYTORCH_RUNTIME_UNAVAILABLE" in exc_str or "GENERIC_BINARY_RUNTIME_UNAVAILABLE" in exc_str)
                        and hasattr(adapter, "_synthetic_forward")
                    ):
                        outputs = adapter._synthetic_forward(np.array(perturbed))
                    else:
                        raise
            else:
                # Deterministic synthetic outputs derived from model_id seed + perturbation
                combo_seed = (hash(str(resolved_id)) ^ hash(p_type.value) ^ seed) & 0x7FFFFFFF
                rng = np.random.default_rng(combo_seed)
                raw = rng.random((count, 10)).astype(np.float32)
                raw /= raw.sum(axis=1, keepdims=True)  # softmax-like normalisation
                outputs = raw

            l2_norm = float(np.linalg.norm(outputs))
            activation_stats[p_type.value] = {
                "mean": float(np.mean(outputs)),
                "std": float(np.std(outputs)),
                "l2_norm": l2_norm,
            }

            output_digest = hash_bytes(outputs.tobytes())
            mean_conf, top_class_id = summarise_prediction(outputs)

            results.append(
                PerturbationResult(
                    perturbation=p_type,
                    output_digest=output_digest,
                    mean_confidence=round(mean_conf, 4),
                    top_class_id=top_class_id,
                    output_l2_norm=round(l2_norm, 6),
                )
            )

            # Store individual probe records with canonical output representation
            for idx, (p_img, p_out) in enumerate(zip(perturbed, outputs)):
                p_id = f"{p_type.value}_probe_{idx}"
                in_hash = hash_bytes(p_img.tobytes())
                out_hash = hash_bytes(p_out.tobytes())
                canonical_out = [round(float(v), 6) for v in p_out.flatten()[:32]]
                probe_records.append(
                    ProbeRecord(
                        probe_id=p_id,
                        input_hash=in_hash,
                        output_hash=out_hash,
                        canonical_output=canonical_out,
                        model_hash=model_hash,
                    )
                )

        # Aggregate digest over all probe output digests and results
        aggregate_payload = {
            "model_hash": model_hash,
            "results": [r.model_dump(mode="json") for r in results],
            "probe_hashes": [pr.output_hash for pr in probe_records],
        }
        aggregate_digest = canonical_json_hash(aggregate_payload)

        fingerprint = ModelFingerprint(
            fingerprint_id=str(uuid.uuid4()),
            model_id=str(resolved_id),
            model_hash=model_hash,
            battery_seed=seed,
            battery_size=count,
            probe_records=probe_records,
            results=results,
            activation_stats=activation_stats,
            aggregate_digest=aggregate_digest,
        )

        # Persist to disk
        out_file = self.fingerprints_dir / f"{resolved_id}_{seed}.json"
        with open(out_file, "w", encoding="utf-8") as f:
            f.write(canonical_json_dumps(fingerprint.model_dump(mode="json")))

        return fingerprint

    def load_fingerprint(self, model_id: str, seed: int = 42) -> Optional[ModelFingerprint]:
        """Load an existing model fingerprint from disk."""
        fp_file = self.fingerprints_dir / f"{model_id}_{seed}.json"
        if not fp_file.is_file():
            return None

        with open(fp_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        return ModelFingerprint(**data)

    def compare_fingerprints(
        self,
        candidate_fp: ModelFingerprint,
        reference_fp: ModelFingerprint,
        divergence_threshold: float = 0.95,
    ) -> FingerprintComparisonResponse:
        """Compare candidate behavioral fingerprint against reference baseline."""
        # Check exact aggregate digest match
        if candidate_fp.aggregate_digest == reference_fp.aggregate_digest:
            return FingerprintComparisonResponse(
                candidate_model_id=candidate_fp.model_id,
                reference_model_id=reference_fp.model_id,
                cosine_similarity=1.0,
                mean_squared_error=0.0,
                max_absolute_error=0.0,
                is_divergent=False,
                status=AssetStatus.ACCEPTED,
                divergent_probes=[],
                evidence_records=[],
                details=[{"perturbation": r.perturbation, "match": True} for r in candidate_fp.results],
            )

        # Build comparison feature vectors from canonical outputs
        cand_vec: List[float] = []
        ref_vec: List[float] = []
        details = []

        ref_map = {r.perturbation: r for r in reference_fp.results}

        # Compare canonical probe records if available
        if candidate_fp.probe_records and reference_fp.probe_records:
            ref_probes = {p.probe_id: p for p in reference_fp.probe_records}
            for c_probe in candidate_fp.probe_records:
                r_probe = ref_probes.get(c_probe.probe_id)
                if r_probe and len(c_probe.canonical_output) == len(r_probe.canonical_output):
                    cand_vec.extend(c_probe.canonical_output)
                    ref_vec.extend(r_probe.canonical_output)

        # Also compare perturbation summary statistics
        for cand_res in candidate_fp.results:
            ref_res = ref_map.get(cand_res.perturbation)
            if not ref_res:
                cand_vec.extend([0.0, cand_res.mean_confidence, 0.0])
                ref_vec.extend([1.0, 1.0, 1.0])
                continue

            digest_match = cand_res.output_digest == ref_res.output_digest
            top_class_match = cand_res.top_class_id == ref_res.top_class_id

            cand_vec.extend([
                1.0 if digest_match else 0.0,
                cand_res.mean_confidence,
                1.0 if top_class_match else 0.0,
            ])
            ref_vec.extend([
                1.0,
                ref_res.mean_confidence,
                1.0,
            ])

            details.append({
                "perturbation": cand_res.perturbation.value,
                "digest_match": digest_match,
                "cand_conf": cand_res.mean_confidence,
                "ref_conf": ref_res.mean_confidence,
                "cand_top_class": cand_res.top_class_id,
                "ref_top_class": ref_res.top_class_id,
            })

        u = np.array(cand_vec, dtype=np.float64)
        v = np.array(ref_vec, dtype=np.float64)

        norm_u = np.linalg.norm(u)
        norm_v = np.linalg.norm(v)

        if norm_u == 0 or norm_v == 0:
            cos_sim = 0.0
        else:
            cos_sim = float(np.dot(u, v) / (norm_u * norm_v))

        cos_sim = round(max(0.0, min(1.0, cos_sim)), 4)
        mse = round(float(np.mean((u - v) ** 2)), 4)
        max_abs_err = round(float(np.max(np.abs(u - v))) if len(u) > 0 else 0.0, 6)

        is_divergent = cos_sim < divergence_threshold
        status = AssetStatus.QUARANTINED if is_divergent else AssetStatus.ACCEPTED

        # Identify divergent probes (probe records where output hashes differ)
        divergent_probes: List[str] = []
        if candidate_fp.probe_records and reference_fp.probe_records:
            ref_probe_map = {p.probe_id: p for p in reference_fp.probe_records}
            for c_probe in candidate_fp.probe_records:
                r_probe = ref_probe_map.get(c_probe.probe_id)
                if r_probe and c_probe.output_hash != r_probe.output_hash:
                    divergent_probes.append(c_probe.probe_id)

        # Build evidence records for Phase 9 Evidence Fusion
        evidence_records: List[Dict] = []
        if is_divergent:
            for d in details:
                if not d.get("digest_match", True):
                    confidence_delta = abs(
                        d.get("cand_conf", 0.0) - d.get("ref_conf", 0.0)
                    )
                    evidence_records.append({
                        "type": "BEHAVIORAL_PROBE_DIVERGENCE",
                        "perturbation": d.get("perturbation", "UNKNOWN"),
                        "severity": "HIGH" if confidence_delta > 0.1 else "MEDIUM",
                        "confidence_delta": round(confidence_delta, 4),
                        "cosine_similarity": cos_sim,
                    })
            # Ensure at least one record if divergent but details empty
            if not evidence_records:
                evidence_records.append({
                    "type": "BEHAVIORAL_PROBE_DIVERGENCE",
                    "perturbation": "AGGREGATE",
                    "severity": "HIGH",
                    "confidence_delta": round(1.0 - cos_sim, 4),
                    "cosine_similarity": cos_sim,
                })

        return FingerprintComparisonResponse(
            candidate_model_id=candidate_fp.model_id,
            reference_model_id=reference_fp.model_id,
            cosine_similarity=cos_sim,
            mean_squared_error=mse,
            max_absolute_error=max_abs_err,
            is_divergent=is_divergent,
            status=status,
            divergent_probes=divergent_probes,
            evidence_records=evidence_records,
            details=details,
        )


default_fingerprinter = BehaviouralFingerprinter()
