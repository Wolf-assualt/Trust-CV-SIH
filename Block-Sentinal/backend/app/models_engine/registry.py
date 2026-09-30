"""Model Registry managing cryptographic identity, structural metadata, and baseline audits."""
import json
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from app.core.config import settings
from app.crypto.canonical import canonical_json_dumps, canonical_json_hash, hash_bytes, hash_file
from app.crypto.signer import KeyManager
from app.models_engine.adapters.factory import ModelAdapterFactory
from app.models_engine.trigger_detector import TriggerDetector
from app.schemas.base import AssetStatus
from app.schemas.model import (
    AccessMode,
    ModelAssuranceFinding,
    ModelFormat,
    ModelIdentityManifest,
    ModelLayerInfo,
    ModelVerifyResponse,
    TriggerStatus,
    VerificationStatus,
)


class ModelRegistry:
    """Manages model registration, deterministic identity hashing, and baseline verification."""

    def __init__(self, base_dir: Optional[Path] = None):
        if base_dir:
            self.base_dir = Path(base_dir)
        else:
            self.base_dir = Path(settings.DATA_DIR) / "models"

        self.manifests_dir = self.base_dir / "manifests"
        self.baselines_dir = self.base_dir / "baselines"

        self.manifests_dir.mkdir(parents=True, exist_ok=True)
        self.baselines_dir.mkdir(parents=True, exist_ok=True)

        # ECDSA keypair for signing model identity manifests
        self.key_manager = KeyManager()

    def register_model(
        self,
        name: str,
        version: str,
        model_path: Path,
        format: ModelFormat,
        is_reference: bool = False,
        access_mode: Optional[AccessMode] = None,
    ) -> ModelIdentityManifest:
        """Inspect model binary, calculate canonical identity digest, and persist manifest."""
        path = Path(model_path)
        if not path.is_file():
            raise FileNotFoundError(f"Model file not found: {model_path}")

        # Always calculate SHA-256 directly from the current model artifact on disk
        artifact_hash = hash_file(str(path))

        if isinstance(format, str):
            f_upper = format.upper()
            if f_upper in ("PYTORCH", "PYTORCH_WEIGHTS", "TORCH"):
                format = ModelFormat.PYTORCH_WEIGHTS
            elif f_upper == "TORCHSCRIPT":
                format = ModelFormat.TORCHSCRIPT
            elif f_upper == "ONNX":
                format = ModelFormat.ONNX
            elif f_upper == "GENERIC_BINARY":
                format = ModelFormat.GENERIC_BINARY
            elif f_upper == "BLACK_BOX":
                format = ModelFormat.BLACK_BOX
            else:
                format = ModelFormat.UNSUPPORTED

        adapter = ModelAdapterFactory.get_adapter(path, format_hint=format)
        adapter.load()
        meta = adapter.metadata()
        in_schema = adapter.input_schema()
        out_schema = adapter.output_schema()
        resolved_access_mode = access_mode or adapter.access_mode

        # --- Compute per-layer hashes (PyTorch state_dict) ---
        layers: List[ModelLayerInfo] = []
        weights_hash: Optional[str] = None
        architecture_hash: Optional[str] = None

        # Only a PyTorch state_dict can produce per-layer hashes. Measured against real
        # artifacts: torch.load succeeds on a .pth checkpoint, and raises on an ONNX file
        # (UnpicklingError) and on a TorchScript archive (RuntimeError), so the call was
        # a no-op for every other format. Guarding on the format avoids importing torch
        # (~3s) when registering an ONNX model, which is the common upload path.
        if format == ModelFormat.PYTORCH_WEIGHTS:
            try:
                # pyrefly: ignore [missing-import]
                import torch
                data = torch.load(str(path), map_location="cpu", weights_only=True)
                if isinstance(data, dict):
                    state_dict = data.get("state_dict") or data.get("model") or data
                    if isinstance(state_dict, dict):
                        # Per-layer hashing
                        arch_entries = []  # name + shape only (structure)
                        weight_entries = []  # name + shape + hash (content)
                        for tensor_name in sorted(state_dict.keys()):
                            tensor = state_dict[tensor_name]
                            if hasattr(tensor, "detach"):
                                t_np = tensor.detach().cpu().numpy()
                                t_bytes = t_np.tobytes()
                                t_hash = hash_bytes(t_bytes)
                                t_shape = list(tensor.shape)
                                t_count = int(tensor.numel())
                                layers.append(ModelLayerInfo(
                                    name=tensor_name,
                                    shape=t_shape,
                                    sha256_hash=t_hash,
                                    param_count=t_count,
                                ))
                                arch_entries.append({"name": tensor_name, "shape": t_shape})
                                weight_entries.append({"name": tensor_name, "hash": t_hash})

                        architecture_hash = canonical_json_hash({"layers": arch_entries})
                        weights_hash = canonical_json_hash({"weights": weight_entries})
            except Exception:
                # Not a readable state_dict — hashes remain None (set from identity_digest below)
                pass

        identity_payload = {
            "name": name,
            "version": version,
            "format": format.value,
            "parameter_count": meta.get("parameter_count", 0),
            "node_count": meta.get("node_count", 0),
            "layer_count": meta.get("layer_count", 0),
            "inputs": [inp.model_dump() for inp in in_schema],
            "outputs": [out.model_dump() for out in out_schema],
        }
        identity_digest = canonical_json_hash(identity_payload)

        # For non-PyTorch formats derive architecture_hash / weights_hash from the identity digest
        if architecture_hash is None:
            architecture_hash = canonical_json_hash({"format": format.value, "identity": identity_digest})
        if weights_hash is None:
            weights_hash = artifact_hash  # fall back to full file hash

        # Sign the identity digest
        signature = self.key_manager.sign_hash(identity_digest)

        model_id = str(uuid.uuid4())
        manifest_meta = dict(meta)
        manifest_meta["file_path"] = str(path.resolve())

        manifest = ModelIdentityManifest(
            model_id=model_id,
            name=name,
            version=version,
            format=format,
            artifact_hash=artifact_hash,
            binary_sha256=artifact_hash,
            access_mode=resolved_access_mode,
            architecture_hash=architecture_hash,
            weights_hash=weights_hash,
            signature=signature,
            layers=layers,
            architecture_info=meta,
            parameter_count=meta.get("parameter_count", 0),
            node_count=meta.get("node_count", 0),
            layer_count=len(layers) if layers else meta.get("layer_count", 0),
            inputs=in_schema,
            outputs=out_schema,
            metadata=manifest_meta,
            scanner_version="1.0.0",
            identity_digest=identity_digest,
            status=AssetStatus.ACCEPTED,
        )

        # Persist manifest
        manifest_file = self.manifests_dir / f"{model_id}.json"
        with open(manifest_file, "w", encoding="utf-8") as f:
            f.write(canonical_json_dumps(manifest.model_dump(mode="json")))

        # If designated as reference, also store under baseline name
        if is_reference:
            baseline_file = self.baselines_dir / f"{name}_{version}.json"
            with open(baseline_file, "w", encoding="utf-8") as f:
                f.write(canonical_json_dumps(manifest.model_dump(mode="json")))

        return manifest

    def get_model(self, model_id: str) -> Optional[ModelIdentityManifest]:
        """Load registered model manifest by model_id."""
        manifest_file = self.manifests_dir / f"{model_id}.json"
        if not manifest_file.is_file():
            return None

        with open(manifest_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        return ModelIdentityManifest(**data)

    def list_models(self) -> List[ModelIdentityManifest]:
        """List all registered model identity manifests."""
        models: List[ModelIdentityManifest] = []
        if self.manifests_dir.exists():
            for mf in self.manifests_dir.glob("*.json"):
                try:
                    with open(mf, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    models.append(ModelIdentityManifest(**data))
                except Exception:
                    continue
        return models

    def get_baseline(self, name: str, version: str) -> Optional[ModelIdentityManifest]:
        """Load reference baseline manifest by model name and version."""
        baseline_file = self.baselines_dir / f"{name}_{version}.json"
        if not baseline_file.is_file():
            return None

        with open(baseline_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        return ModelIdentityManifest(**data)

    def verify_against_baseline(
        self,
        model_id: str,
        baseline_id: Optional[str] = None,
    ) -> ModelVerifyResponse:
        """Verify candidate model across binary, structural, and behavioural identity tiers."""
        candidate = self.get_model(model_id)
        if not candidate:
            raise FileNotFoundError(f"Candidate model {model_id} not found in registry.")

        if baseline_id:
            baseline = self.get_model(baseline_id)
        else:
            baseline = self.get_baseline(candidate.name, candidate.version)

        if not baseline:
            return ModelVerifyResponse(
                model_id=model_id,
                is_valid=False,
                binary_match=False,
                structural_match=False,
                binary_identity=VerificationStatus.UNAVAILABLE,
                structural_identity=VerificationStatus.UNAVAILABLE,
                behavioural_identity=VerificationStatus.UNAVAILABLE,
                trigger_status=TriggerStatus.UNAVAILABLE,
                discrepancies=["No registered reference baseline found for this model."],
            )

        discrepancies: List[str] = []

        # 1. Re-calculate hash directly from disk to detect local tampering
        cand_path_str = candidate.metadata.get("file_path")
        current_cand_hash = candidate.artifact_hash
        if cand_path_str and Path(cand_path_str).is_file():
            current_cand_hash = hash_file(cand_path_str)
            if current_cand_hash != candidate.artifact_hash:
                discrepancies.append(
                    f"Candidate model artifact modified on disk: original={candidate.artifact_hash[:16]}... vs current={current_cand_hash[:16]}..."
                )

        # 2. Binary Identity
        binary_match = (current_cand_hash == baseline.artifact_hash)
        binary_identity = VerificationStatus.MATCH if binary_match else VerificationStatus.MISMATCH
        if not binary_match:
            discrepancies.append(
                f"Binary SHA-256 mismatch: candidate={current_cand_hash[:16]}... vs baseline={baseline.artifact_hash[:16]}..."
            )

        # 2b. Weights-level hash comparison (per-layer)
        weights_match = True
        if candidate.weights_hash and baseline.weights_hash:
            weights_match = (candidate.weights_hash == baseline.weights_hash)
            if not weights_match:
                # Identify specific differing layers
                cand_layer_map = {l.name: l.sha256_hash for l in candidate.layers}
                base_layer_map = {l.name: l.sha256_hash for l in baseline.layers}
                for lname, lhash in cand_layer_map.items():
                    if lname in base_layer_map and base_layer_map[lname] != lhash:
                        discrepancies.append(
                            f"Weight tamper detected in layer '{lname}': hash changed from baseline"
                        )

        # 3. Structural Identity
        if candidate.access_mode == AccessMode.BLACK_BOX or baseline.access_mode == AccessMode.BLACK_BOX:
            structural_identity = VerificationStatus.UNAVAILABLE
            structural_match = False
            discrepancies.append("Structural verification unavailable: Model has BLACK_BOX access mode.")
        else:
            # Use architecture_hash if available; fall back to identity_digest
            cand_arch = candidate.architecture_hash or candidate.identity_digest
            base_arch = baseline.architecture_hash or baseline.identity_digest
            structural_match = (cand_arch == base_arch)
            structural_identity = VerificationStatus.MATCH if structural_match else VerificationStatus.MISMATCH
            if not structural_match:
                discrepancies.append(
                    f"Architecture hash mismatch: candidate={cand_arch[:16]}... vs baseline={base_arch[:16]}..."
                )
            if candidate.layer_count != baseline.layer_count:
                discrepancies.append(
                    f"Layer count mismatch: candidate={candidate.layer_count} vs baseline={baseline.layer_count}"
                )
            if candidate.parameter_count != baseline.parameter_count:
                discrepancies.append(
                    f"Parameter count mismatch: candidate={candidate.parameter_count} vs baseline={baseline.parameter_count}"
                )
            if candidate.inputs != baseline.inputs:
                discrepancies.append("Input tensor specifications do not match baseline")
            if candidate.outputs != baseline.outputs:
                discrepancies.append("Output tensor specifications do not match baseline")

        # 4. Behavioural Identity
        behavioural_identity = VerificationStatus.UNAVAILABLE
        if cand_path_str and Path(cand_path_str).is_file():
            try:
                from app.fingerprint.runner import default_fingerprinter

                cand_fp = default_fingerprinter.fingerprint_model(Path(cand_path_str))
                base_path_str = baseline.metadata.get("file_path")
                if base_path_str and Path(base_path_str).is_file():
                    base_fp = default_fingerprinter.fingerprint_model(Path(base_path_str))
                    comp = default_fingerprinter.compare_fingerprints(cand_fp, base_fp)
                    if comp.is_divergent:
                        behavioural_identity = VerificationStatus.MISMATCH
                        discrepancies.append(f"Behavioural divergence detected: cosine similarity={comp.cosine_similarity}")
                    else:
                        behavioural_identity = VerificationStatus.MATCH
            except Exception:
                behavioural_identity = VerificationStatus.UNAVAILABLE

        # 5. Trigger Sensitivity
        trigger_status = TriggerStatus.UNAVAILABLE
        if cand_path_str and Path(cand_path_str).is_file():
            try:
                adapter = ModelAdapterFactory.get_adapter(Path(cand_path_str), format_hint=candidate.format)
                t_stat, _, _, _, _ = TriggerDetector.evaluate(adapter)
                trigger_status = t_stat
                if trigger_status == TriggerStatus.SUSPICIOUS_TRIGGER_SENSITIVITY:
                    discrepancies.append("Suspicious behavioural trigger sensitivity detected on candidate model.")
            except Exception:
                trigger_status = TriggerStatus.UNAVAILABLE

        is_valid = (
            binary_match
            and weights_match
            and (structural_identity in (VerificationStatus.MATCH, VerificationStatus.UNAVAILABLE))
            and (behavioural_identity in (VerificationStatus.MATCH, VerificationStatus.UNAVAILABLE))
            and (trigger_status != TriggerStatus.SUSPICIOUS_TRIGGER_SENSITIVITY)
            and (len(discrepancies) == 0)
        )

        return ModelVerifyResponse(
            model_id=model_id,
            is_valid=is_valid,
            binary_match=binary_match,
            structural_match=structural_match,
            weights_match=weights_match,
            binary_identity=binary_identity,
            structural_identity=structural_identity,
            behavioural_identity=behavioural_identity,
            trigger_status=trigger_status,
            discrepancies=discrepancies,
        )

    def generate_assurance_finding(
        self,
        model_id: str,
        baseline_id: Optional[str] = None,
    ) -> ModelAssuranceFinding:
        """Produce standardized ModelAssuranceFinding for a registered model."""
        candidate = self.get_model(model_id)
        if not candidate:
            raise FileNotFoundError(f"Model {model_id} not found in registry.")

        cand_path_str = candidate.metadata.get("file_path")
        cand_path = Path(cand_path_str) if cand_path_str else None
        current_hash = hash_file(cand_path_str) if cand_path and cand_path.is_file() else candidate.artifact_hash

        verification = self.verify_against_baseline(model_id, baseline_id=baseline_id)

        evidence = {
            "name": candidate.name,
            "version": candidate.version,
            "discrepancies": verification.discrepancies,
            "parameter_count": candidate.parameter_count,
            "node_count": candidate.node_count,
            "binary_match": verification.binary_match,
            "structural_match": verification.structural_match,
        }

        limitations = [
            "Assurance is verified using local offline runtimes (ONNX Runtime, TorchScript).",
            "Pickle-based arbitrary PyTorch code execution is disabled to prevent code injection.",
        ]
        if candidate.access_mode == AccessMode.BLACK_BOX:
            limitations.append("Model is black-box; internal architecture cannot be verified.")

        # Justified confidence calculation
        confidence = 1.0 if verification.binary_match else 0.95
        confidence_basis = "Deterministic cryptographic file SHA-256 hash direct from disk."

        return ModelAssuranceFinding(
            model_id=model_id,
            artifact_hash=current_hash,
            format=candidate.format.value,
            access_mode=candidate.access_mode,
            identity_status=verification.binary_identity,
            structural_status=verification.structural_identity,
            behavioural_status=verification.behavioural_identity,
            trigger_status=verification.trigger_status,
            confidence=confidence,
            confidence_basis=confidence_basis,
            evidence=evidence,
            limitations=limitations,
        )


default_model_registry = ModelRegistry()
