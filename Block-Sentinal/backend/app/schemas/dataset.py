"""Dataset, Batch, and Sample schemas for ingestion and integrity verification."""
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
# pyrefly: ignore [missing-import]
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import AssetStatus


class DatasetFormat(str, Enum):
    COCO = "COCO"
    YOLO = "YOLO"
    IMAGE_FOLDER = "IMAGE_FOLDER"
    BIGEARTHNET_S2 = "BIGEARTHNET_S2"
    SENTINEL_2 = "SENTINEL_2"


class SampleRecord(BaseModel):
    sample_id: str
    file_path: str
    sha256_hash: str = Field(..., min_length=64, max_length=64)
    width: Optional[int] = None
    height: Optional[int] = None
    labels: List[Dict[str, Any]] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class BatchManifest(BaseModel):
    batch_id: str
    dataset_name: str
    format: DatasetFormat
    contributor_id: str
    contributor_source: str = "UNKNOWN"  # how contributor was resolved
    sample_count: int
    merkle_root: str
    dataset_sha256: str = ""  # canonical hash of (rel_path, size, sha256) tuples
    samples: List[SampleRecord]
    signature: Optional[str] = None
    public_key_pem: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: Dict[str, Any] = Field(default_factory=dict)


class IngestDirectoryRequest(BaseModel):
    dataset_name: str = Field(..., min_length=1)
    format: DatasetFormat
    contributor_id: str = Field(..., min_length=1)
    source_path: str = Field(..., min_length=1)
    annotation_path: Optional[str] = None


class IngestResponse(BaseModel):
    batch_id: str
    dataset_name: str
    sample_count: int
    merkle_root: str
    status: AssetStatus = AssetStatus.ACCEPTED


class BatchVerificationResponse(BaseModel):
    batch_id: str
    valid: bool
    calculated_root: str
    manifest_root: str
    tampered_samples: List[str] = Field(default_factory=list)
    signature_valid: Optional[bool] = None
    label_quality_score: Optional[float] = None
    noisy_samples: List[Dict[str, Any]] = Field(default_factory=list)
    cleanlab_analysis: Optional[Dict[str, Any]] = None


# Retained for ORM entity compatibility
class SampleBase(BaseModel):
    file_path: str = Field(..., max_length=1024)
    sha256_digest: str = Field(..., min_length=64, max_length=64)
    perceptual_hash: Optional[str] = Field(None, max_length=64)
    label: Optional[str] = Field(None, max_length=255)
    split: str = Field(default="train", max_length=20)
    metadata_json: Optional[str] = None


class SampleCreate(SampleBase):
    batch_id: str
    contributor_id: str


class SampleResponse(SampleBase):
    id: str
    batch_id: str
    contributor_id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DatasetBatchBase(BaseModel):
    batch_number: int = Field(..., ge=1)
    sha256_digest: str = Field(..., min_length=64, max_length=64)
    sample_count: int = Field(default=0, ge=0)
    status: str = Field(default="INGESTED", max_length=50)


class DatasetBatchCreate(DatasetBatchBase):
    dataset_id: str


class DatasetBatchResponse(DatasetBatchBase):
    id: str
    dataset_id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DatasetBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    format: DatasetFormat
    root_path: str = Field(..., max_length=1024)
    sha256_digest: str = Field(..., min_length=64, max_length=64)
    contributor_id: str


class DatasetCreate(DatasetBase):
    pass


class DatasetResponse(DatasetBase):
    id: str
    total_samples: int
    created_at: datetime
    updated_at: datetime
    batches: List[DatasetBatchResponse] = []

    model_config = ConfigDict(from_attributes=True)
