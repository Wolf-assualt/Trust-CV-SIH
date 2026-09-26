"""Dataset Ingestion Engine: parses, computes Merkle trees, and persists batch manifests."""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session

from app.core.config import settings
from app.crypto.canonical import canonical_json_dumps, canonical_json_hash, hash_file
from app.crypto.merkle import MerkleTree
from app.crypto.signer import KeyManager, default_key_manager
from app.datasets.parsers import (
    BaseParser,
    BigEarthNetS2Parser,
    COCOParser,
    DirectoryParser,
    YOLOParser,
)
from app.models.contributor import Contributor
from app.models.dataset import Dataset, DatasetBatch
from app.models.audit import MerkleRoot
from app.models.sample import Sample
from app.schemas.dataset import (
    BatchManifest,
    BatchVerificationResponse,
    DatasetFormat,
)


class DatasetIngestionEngine:
    """Orchestrates dataset parsing, cryptographic manifest generation, and integrity verification."""

    def __init__(self, manifests_dir: Optional[Path] = None, key_manager: Optional[KeyManager] = None):
        if manifests_dir:
            self.manifests_dir = Path(manifests_dir)
        else:
            self.manifests_dir = Path(settings.DATA_DIR) / "manifests"
        self.manifests_dir.mkdir(parents=True, exist_ok=True)
        self.key_manager = key_manager or default_key_manager

    def _get_parser(self, dataset_format: DatasetFormat) -> BaseParser:
        if dataset_format == DatasetFormat.COCO:
            return COCOParser()
        elif dataset_format == DatasetFormat.YOLO:
            return YOLOParser()
        elif dataset_format == DatasetFormat.IMAGE_FOLDER:
            return DirectoryParser()
        elif dataset_format in (DatasetFormat.BIGEARTHNET_S2, DatasetFormat.SENTINEL_2):
            return BigEarthNetS2Parser()
        raise ValueError(f"Unsupported dataset format: {dataset_format}")

    def compute_dataset_sha256(self, source_dir: Path, records: list) -> str:
        """Compute deterministic dataset_sha256.

        Definition:
          1. For every original file in the dataset, collect a tuple of:
             (deterministic_relative_path, file_size_bytes, file_sha256)
          2. Sort entries by deterministic_relative_path
          3. Serialize to canonical JSON
          4. SHA-256 hash the canonical serialized manifest

        This produces a content-addressable dataset identity that does not
        depend on directory location, filesystem metadata, or file order.
        """
        entries = []
        for record in records:
            file_path = Path(record.file_path)
            try:
                rel_path = file_path.relative_to(source_dir).as_posix()
            except ValueError:
                rel_path = file_path.name
            try:
                file_size = file_path.stat().st_size
            except OSError:
                file_size = 0
            entries.append({
                "relative_path": rel_path,
                "file_size": file_size,
                "sha256": record.sha256_hash,
            })

        # Sort deterministically by relative_path
        entries.sort(key=lambda e: e["relative_path"])

        return canonical_json_hash({"files": entries})

    def ingest(
        self,
        dataset_name: str,
        format: DatasetFormat,
        contributor_id: str,
        source_path: str,
        annotation_path: Optional[str] = None,
        contributor_source: str = "UNKNOWN",
    ) -> BatchManifest:
        """Parse directory, compute Merkle inclusion tree, and persist BatchManifest."""
        source_dir = Path(source_path)
        ann_path = Path(annotation_path) if annotation_path else None

        parser = self._get_parser(format)
        records = parser.parse(source_dir, ann_path)

        if not records:
            raise ValueError(f"Empty dataset: no valid sample records found in {source_path}")

        # Sort records deterministically by sample_id
        records.sort(key=lambda r: r.sample_id)

        # Compute deterministic leaf hash for each sample record
        leaf_hashes = [
            canonical_json_hash({
                "sample_id": s.sample_id,
                "sha256": s.sha256_hash,
                "labels": s.labels,
            })
            for s in records
        ]

        # Build Merkle tree from leaf hashes
        tree = MerkleTree(leaf_hashes)
        merkle_root = tree.get_root()

        # Phase 3: Compute deterministic dataset_sha256
        dataset_sha256 = self.compute_dataset_sha256(source_dir, records)

        batch_id = str(uuid.uuid4())

        # Cryptographically sign the manifest identity
        manifest_digest_payload = {
            "batch_id": batch_id,
            "dataset_name": dataset_name,
            "format": format.value,
            "contributor_id": contributor_id,
            "sample_count": len(records),
            "merkle_root": merkle_root,
        }
        manifest_digest = canonical_json_hash(manifest_digest_payload)
        signature = self.key_manager.sign_hash(manifest_digest)
        pubkey_pem = self.key_manager.export_public_key_pem().decode("utf-8")

        manifest = BatchManifest(
            batch_id=batch_id,
            dataset_name=dataset_name,
            format=format,
            contributor_id=contributor_id,
            contributor_source=contributor_source,
            sample_count=len(records),
            merkle_root=merkle_root,
            dataset_sha256=dataset_sha256,
            samples=records,
            signature=signature,
            public_key_pem=pubkey_pem,
        )

        # Persist manifest to disk using canonical JSON
        manifest_file = self.manifests_dir / f"{batch_id}.json"
        manifest_dict = manifest.model_dump(mode="json")
        with open(manifest_file, "w", encoding="utf-8") as f:
            f.write(canonical_json_dumps(manifest_dict))

        return manifest

    def load_manifest(self, batch_id: str) -> Optional[BatchManifest]:
        """Load and deserialize a BatchManifest from disk by batch_id."""
        manifest_file = self.manifests_dir / f"{batch_id}.json"
        if not manifest_file.is_file():
            return None

        with open(manifest_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        return BatchManifest(**data)

    def verify_manifest(self, batch_id: str) -> BatchVerificationResponse:
        """Audit sample files against manifest and verify Merkle root and ECDSA signature."""
        manifest = self.load_manifest(batch_id)
        if not manifest:
            raise FileNotFoundError(f"Manifest for batch {batch_id} not found.")

        tampered_samples = []
        recalculated_leaves = []

        for sample in manifest.samples:
            sample_file = Path(sample.file_path)
            if not sample_file.exists():
                tampered_samples.append(sample.sample_id)
                current_sha256 = "FILE_NOT_FOUND"
            elif sample_file.is_dir():
                from app.datasets.bigearthnet import BigEarthNetS2Adapter
                hash_info = BigEarthNetS2Adapter.hash_sample(sample_file)
                current_sha256 = hash_info["compound_sha256"]
                if current_sha256 != sample.sha256_hash:
                    tampered_samples.append(sample.sample_id)
            else:
                current_sha256 = hash_file(str(sample_file))
                if current_sha256 != sample.sha256_hash:
                    tampered_samples.append(sample.sample_id)

            leaf_hash = canonical_json_hash({
                "sample_id": sample.sample_id,
                "sha256": current_sha256,
                "labels": sample.labels,
            })
            recalculated_leaves.append(leaf_hash)

        recomputed_tree = MerkleTree(recalculated_leaves)
        calculated_root = recomputed_tree.get_root()

        signature_valid = None
        if manifest.signature and manifest.public_key_pem:
            manifest_digest_payload = {
                "batch_id": manifest.batch_id,
                "dataset_name": manifest.dataset_name,
                "format": manifest.format.value,
                "contributor_id": manifest.contributor_id,
                "sample_count": manifest.sample_count,
                "merkle_root": manifest.merkle_root,
            }
            manifest_digest = canonical_json_hash(manifest_digest_payload)
            signature_valid = KeyManager.verify_signature(
                public_key_pem=manifest.public_key_pem.encode("utf-8"),
                digest_hex=manifest_digest,
                signature_hex=manifest.signature,
            )

        is_valid = (
            (len(tampered_samples) == 0)
            and (calculated_root == manifest.merkle_root)
            and (signature_valid is not False)
        )

        # 3. Cleanlab Confident Learning label quality scoring and anomaly detection
        cleanlab_result = self.analyze_label_quality(manifest.samples)
        label_quality_score = cleanlab_result.get("overall_score")
        noisy_samples = cleanlab_result.get("noisy_samples", [])

        return BatchVerificationResponse(
            batch_id=batch_id,
            valid=is_valid,
            calculated_root=calculated_root,
            manifest_root=manifest.merkle_root,
            tampered_samples=tampered_samples,
            signature_valid=signature_valid,
            label_quality_score=label_quality_score,
            noisy_samples=noisy_samples,
            cleanlab_analysis=cleanlab_result,
        )

    def analyze_label_quality(self, samples: List) -> dict:
        """Score label quality and identify noisy/anomalous samples using Cleanlab confident learning."""
        if not samples:
            return {"overall_score": 1.0, "noisy_samples": [], "sample_count": 0, "status": "NO_SAMPLES"}

        # Resolve primary labels
        sample_entries = []
        label_set = set()
        for s in samples:
            lbl = None
            if s.labels:
                first = s.labels[0]
                if isinstance(first, dict):
                    for k in ("class", "category", "class_id", "spectral_band"):
                        if k in first and first[k] is not None:
                            lbl = str(first[k])
                            break
            if not lbl and s.metadata and "class" in s.metadata:
                lbl = str(s.metadata["class"])
            if not lbl:
                p = Path(s.file_path)
                if p.parent.name and p.parent.name not in (".", "images", "data", "uploads"):
                    lbl = p.parent.name

            if lbl:
                label_set.add(lbl)
                sample_entries.append((s, lbl))

        if len(label_set) < 2 or len(sample_entries) < 2:
            return {
                "overall_score": 1.0,
                "noisy_samples": [],
                "sample_count": len(samples),
                "status": "INSUFFICIENT_LABELED_DATA",
            }

        label_to_idx = {l: i for i, l in enumerate(sorted(label_set))}
        idx_to_label = {i: l for l, i in label_to_idx.items()}
        features_list = []
        labels_list = []
        valid_samples = []

        from PIL import Image
        import numpy as np

        for s, lbl in sample_entries:
            img_path = Path(s.file_path)
            feat = None
            if img_path.is_file():
                try:
                    with Image.open(img_path) as img:
                        thumb = img.convert("L").resize((16, 16))
                        feat = np.array(thumb, dtype=np.float32).flatten() / 255.0
                except Exception:
                    feat = None
            if feat is None:
                try:
                    h_bytes = bytes.fromhex(s.sha256_hash)[:32]
                    feat = np.frombuffer(h_bytes, dtype=np.uint8).astype(np.float32) / 255.0
                    feat = np.pad(feat, (0, 256 - len(feat)), mode='wrap')
                except Exception:
                    feat = np.zeros(256, dtype=np.float32)

            features_list.append(feat)
            labels_list.append(label_to_idx[lbl])
            valid_samples.append((s, lbl))

        if len(valid_samples) < 2 or len(set(labels_list)) < 2:
            return {
                "overall_score": 1.0,
                "noisy_samples": [],
                "sample_count": len(samples),
                "status": "INSUFFICIENT_FEATURES",
            }

        try:
            # pyrefly: ignore [missing-import]
            import cleanlab
            # pyrefly: ignore [missing-import]
            from cleanlab.filter import find_label_issues
            # pyrefly: ignore [missing-import]
            from cleanlab.rank import get_label_quality_scores
            from sklearn.neighbors import KNeighborsClassifier

            X = np.array(features_list)
            y = np.array(labels_list)

            class_counts = np.bincount(y)
            min_count = int(np.min(class_counts[class_counts > 0]))
            k = max(1, min(3, min_count))

            clf = KNeighborsClassifier(n_neighbors=k)
            clf.fit(X, y)
            probs = clf.predict_proba(X)
            probs = np.clip(probs, 1e-4, 1.0 - 1e-4)
            probs = probs / probs.sum(axis=1, keepdims=True)

            quality_scores = get_label_quality_scores(labels=y, pred_probs=probs)
            label_issues = find_label_issues(labels=y, pred_probs=probs)

            noisy = []
            for i, (is_issue, score) in enumerate(zip(label_issues, quality_scores)):
                sample, given_lbl = valid_samples[i]
                pred_idx = int(np.argmax(probs[i]))
                suggested_lbl = idx_to_label.get(pred_idx, "Unknown")
                if is_issue or score < 0.50:
                    noisy.append({
                        "sample_id": sample.sample_id,
                        "file_path": sample.file_path,
                        "given_label": given_lbl,
                        "suggested_label": suggested_lbl,
                        "quality_score": round(float(score), 4),
                        "is_issue": bool(is_issue),
                    })

            overall_score = round(float(np.mean(quality_scores)), 4) if len(quality_scores) > 0 else 1.0

            return {
                "overall_score": overall_score,
                "noisy_samples": noisy,
                "total_scored": len(valid_samples),
                "issues_count": len(noisy),
                "status": "COMPLETED",
            }
        except Exception as e:
            return {
                "overall_score": 1.0,
                "noisy_samples": [],
                "sample_count": len(samples),
                "status": f"CLEANLAB_ERROR: {str(e)}",
            }

    def register_batch_to_database(
        self,
        manifest: BatchManifest,
        db: Session,
        root_path: str,
    ) -> DatasetBatch:
        """Persist ingested manifest records into relational DB schemas."""
        # 1. Ensure Contributor exists
        contributor = db.query(Contributor).filter(Contributor.id == manifest.contributor_id).first()
        if not contributor:
            contributor = Contributor(
                id=manifest.contributor_id,
                name=f"Contributor-{manifest.contributor_id[:8]}",
                organization="Defense Tactical Ingestion",
                trust_score=1.0,
                total_samples=manifest.sample_count,
                suspicious_samples=0,
                risk_level="Low Risk",
            )
            db.add(contributor)
            db.flush()

        # 2. Check/create Dataset
        dataset = (
            db.query(Dataset)
            .filter(Dataset.name == manifest.dataset_name, Dataset.contributor_id == contributor.id)
            .first()
        )
        if not dataset:
            dataset = Dataset(
                id=str(uuid.uuid4()),
                name=manifest.dataset_name,
                format=manifest.format.value,
                root_path=root_path,
                sha256_digest=manifest.merkle_root,
                total_samples=manifest.sample_count,
                contributor_id=contributor.id,
            )
            db.add(dataset)
            db.flush()
        else:
            dataset.total_samples += manifest.sample_count

        # 3. Create DatasetBatch
        existing_batch = db.query(DatasetBatch).filter(DatasetBatch.id == manifest.batch_id).first()
        if not existing_batch:
            batch_count = db.query(DatasetBatch).filter(DatasetBatch.dataset_id == dataset.id).count()
            batch = DatasetBatch(
                id=manifest.batch_id,
                dataset_id=dataset.id,
                batch_number=batch_count + 1,
                sha256_digest=manifest.merkle_root,
                sample_count=manifest.sample_count,
                status="INGESTED",
            )
            db.add(batch)
            db.flush()
        else:
            batch = existing_batch

        # 4. Create Samples
        for s in manifest.samples:
            label_str = None
            if s.labels:
                first_label = s.labels[0]
                label_str = first_label.get("class") or first_label.get("category") or str(first_label.get("class_id"))

            sample_entity = Sample(
                id=str(uuid.uuid4()),
                batch_id=batch.id,
                contributor_id=contributor.id,
                file_path=s.file_path,
                sha256_digest=s.sha256_hash,
                label=label_str,
                split=s.metadata.get("split", "train"),
            )
            db.add(sample_entity)

        # 5. Create MerkleRoot anchor (idempotent for identical root_hash)
        existing_root = db.query(MerkleRoot).filter(MerkleRoot.root_hash == manifest.merkle_root).first()
        if not existing_root:
            existing_roots_count = db.query(MerkleRoot).count()
            merkle_record = MerkleRoot(
                batch_id=batch.id,
                root_hash=manifest.merkle_root,
                leaf_count=manifest.sample_count,
                block_height=existing_roots_count + 1,
            )
            db.add(merkle_record)
        else:
            existing_root.batch_id = batch.id

        db.commit()

        return batch

    def list_manifests(self) -> List[BatchManifest]:
        """List all stored batch manifests ordered by created timestamp descending."""
        manifests = []
        if self.manifests_dir.exists():
            for p in self.manifests_dir.glob("*.json"):
                m = self.load_manifest(p.stem)
                if m:
                    manifests.append(m)
        manifests.sort(key=lambda x: getattr(x, "created_at", datetime.now(timezone.utc)), reverse=True)
        return manifests


default_ingestion_engine = DatasetIngestionEngine()
