"""Inference execution under provenance tracking, real adapter execution, and cryptographic audit API."""
import base64
import io
from pathlib import Path
from typing import Any, Dict, List, Optional
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException, Query
# pyrefly: ignore [missing-import]
import numpy as np
# pyrefly: ignore [missing-import]
from PIL import Image

from app.core.config import settings
from app.crypto.canonical import canonical_json_hash, hash_bytes, hash_file
from app.inference.dna import default_dna_generator
from app.inference.verifier import InferenceDNAVerifier
from app.models_engine.adapters.factory import ModelAdapterFactory
from app.models_engine.registry import default_model_registry
from app.schemas.base import ResponseEnvelope
from app.schemas.inference import (
    BoundingBox,
    ChainVerificationResponse,
    InferenceDNARecord,
    InferenceOutput,
    InferenceReceipt,
    InferenceRequest,
    PreprocessingSpec,
    VerifyChainRequest,
    VerifyDNARequest,
    VerifyDNAResponse,
)
from app.schemas.model import ModelFormat

router = APIRouter(prefix="/inference", tags=["Inference DNA & Provenance"])


def _resolve_model_path(model_id: str) -> tuple[Path, str]:
    """Retrieve existing model from registry or disk without silent mock synthesis."""
    manifest = default_model_registry.get_model(model_id)
    if manifest and "file_path" in manifest.metadata and Path(manifest.metadata["file_path"]).is_file():
        return Path(manifest.metadata["file_path"]), manifest.artifact_hash

    # Check model binaries dir
    model_dir = Path(settings.DATA_DIR) / "models" / "binaries"
    model_path = model_dir / f"{model_id}.onnx"
    if model_path.is_file():
        return model_path, hash_file(str(model_path))

    # Check directly if model_id is a file path
    direct_path = Path(model_id)
    if direct_path.is_file():
        return direct_path, hash_file(str(direct_path))

    raise HTTPException(
        status_code=404,
        detail=f"INFERENCE = UNAVAILABLE: Model '{model_id}' not found in registry or on disk.",
    )


def _prepare_input_bytes_and_hash(
    image_bytes_b64: Optional[str],
    image_sha256: Optional[str],
) -> tuple[bytes, str]:
    """Extract raw image bytes and calculate/verify input hash without synthesizing fake inputs."""
    if image_bytes_b64:
        try:
            raw_bytes = base64.b64decode(image_bytes_b64)
            computed_hash = hash_bytes(raw_bytes)
            if image_sha256 and image_sha256.lower() != computed_hash.lower():
                raise HTTPException(
                    status_code=400,
                    detail=f"Input hash mismatch: computed {computed_hash} but claimed {image_sha256}.",
                )
            return raw_bytes, computed_hash
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid base64 encoding for image payload.")

    if image_sha256:
        # Caller supplied hash only without data bytes
        raise HTTPException(
            status_code=400,
            detail="INFERENCE = UNAVAILABLE: Raw image bytes must be provided for runtime model execution.",
        )

    raise HTTPException(
        status_code=400,
        detail="INFERENCE = UNAVAILABLE: No input image data or bytes provided for inference execution.",
    )


@router.post("/execute", response_model=ResponseEnvelope[InferenceReceipt])
def execute_inference_with_provenance(
    payload: InferenceRequest,
) -> ResponseEnvelope[InferenceReceipt]:
    """Execute real inference using local ONNX runtime, validate outputs, and cryptographically seal provenance."""
    from app.runtime.engine import default_runtime_engine

    prep_spec = payload.preprocessing or PreprocessingSpec()

    # 1. Resolve model artifact on disk
    model_path, model_identity_digest = _resolve_model_path(payload.model_id)

    # 2. Extract real input bytes and input hash
    raw_bytes, input_sha256 = _prepare_input_bytes_and_hash(
        payload.image_bytes_b64, payload.image_sha256
    )

    # 3. Real forward pass execution via ModelRuntimeEngine
    try:
        prep_override = {
            "target_size": prep_spec.target_size,
            "normalization_mean": prep_spec.normalization_mean,
            "normalization_std": prep_spec.normalization_std,
            "color_space": prep_spec.color_space,
        }
        exec_record, dna_record, output_arr = default_runtime_engine.execute_inference(
            model_path=model_path,
            image_input=raw_bytes,
            model_id=payload.model_id,
            preprocessing_override=prep_override,
            inference_config=payload.inference_config.model_dump() if payload.inference_config else None,
        )
    except RuntimeError as r_exc:
        err_msg = str(r_exc)
        if "INFERENCE = UNAVAILABLE" in err_msg:
            raise HTTPException(status_code=503, detail=err_msg)
        raise HTTPException(status_code=500, detail=f"Inference execution failed: {err_msg}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Inference execution failed: {str(exc)}")

    # 4. Construct authentic InferenceOutput (NO synthetic bounding boxes)
    flat_output = output_arr.flatten()
    output = InferenceOutput(
        predictions=[],  # No fabricated bounding boxes; raw predictions captured authentically
        raw_output_digest=exec_record.output_sha256,
        raw_output=flat_output[:1000].tolist(),
    )

    receipt = InferenceReceipt(
        dna_record=dna_record,
        output=output,
        public_key_pem=default_runtime_engine.dna_generator.export_public_key_pem(),
    )
    return ResponseEnvelope(data=receipt)


@router.post("/verify", response_model=ResponseEnvelope[VerifyDNAResponse])
def verify_inference_dna(
    payload: VerifyDNARequest,
) -> ResponseEnvelope[VerifyDNAResponse]:
    """Cryptographically audit an inference DNA record against a public key."""
    result = InferenceDNAVerifier.verify_record(
        record=payload.dna_record,
        public_key_pem=payload.public_key_pem,
    )
    return ResponseEnvelope(data=result)


@router.post("/verify-chain", response_model=ResponseEnvelope[ChainVerificationResponse])
def verify_inference_hash_chain(
    payload: VerifyChainRequest,
) -> ResponseEnvelope[ChainVerificationResponse]:
    """Cryptographically audit an entire hash chain sequence for continuity and replay attacks."""
    if not payload.public_key_pem:
        raise HTTPException(status_code=400, detail="public_key_pem is required for chain verification.")

    result = InferenceDNAVerifier.verify_chain(
        records=payload.records,
        public_key_pem=payload.public_key_pem,
    )
    return ResponseEnvelope(data=result)


@router.get("/record/{record_id}", response_model=ResponseEnvelope[InferenceDNARecord])
def get_inference_record_by_id(
    record_id: str,
) -> ResponseEnvelope[InferenceDNARecord]:
    """Retrieve persisted Inference DNA record by record ID."""
    record = default_dna_generator.load_record(record_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Inference DNA record '{record_id}' not found.")
    return ResponseEnvelope(data=record)


@router.get("/records", response_model=ResponseEnvelope[List[InferenceDNARecord]])
def list_inference_records(
    limit: int = Query(50, ge=1, le=1000, description="Maximum number of records to return"),
) -> ResponseEnvelope[List[InferenceDNARecord]]:
    """Retrieve runtime inference DNA records up to limit."""
    records: List[InferenceDNARecord] = []
    if default_dna_generator.storage_dir.exists():
        for rf in sorted(default_dna_generator.storage_dir.glob("*.json"), reverse=True):
            if rf.name == "state.json":
                continue
            rec = default_dna_generator.load_record(rf.stem)
            if rec:
                records.append(rec)
            if len(records) >= limit:
                break
    return ResponseEnvelope(data=records)


@router.get("/chain", response_model=ResponseEnvelope[Dict[str, Any]])
def get_inference_hash_chain() -> ResponseEnvelope[Dict[str, Any]]:
    """Retrieve the current audit hash chain tip and recorded sequence history."""
    state = default_dna_generator.get_chain_state()
    return ResponseEnvelope(data=state)

