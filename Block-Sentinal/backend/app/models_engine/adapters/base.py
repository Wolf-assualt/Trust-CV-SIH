"""Common Model Adapter interface for TRUST-CV model assurance."""
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, List, Optional
import numpy as np

from app.crypto.canonical import hash_file
from app.schemas.model import AccessMode, ModelFormat, ModelInputSpec, ModelOutputSpec


class BaseModelAdapter(ABC):
    """Abstract base model adapter providing common interface across CV model formats."""

    def __init__(self, model_path: Path):
        self.model_path = Path(model_path)
        if not self.model_path.is_file():
            raise FileNotFoundError(f"Model file not found: {self.model_path}")
        # Always calculate SHA-256 directly from the current model artifact on disk
        self._artifact_hash = hash_file(str(self.model_path))

    @property
    def artifact_hash(self) -> str:
        """SHA-256 digest computed directly from the current model artifact on disk."""
        return self._artifact_hash

    def rehash(self) -> str:
        """Re-read and verify current artifact hash from disk."""
        self._artifact_hash = hash_file(str(self.model_path))
        return self._artifact_hash

    @property
    @abstractmethod
    def format(self) -> ModelFormat:
        """Format of the model."""
        pass

    @property
    @abstractmethod
    def access_mode(self) -> AccessMode:
        """Access mode: WHITE_BOX, BLACK_BOX, or PARTIAL."""
        pass

    @abstractmethod
    def load(self) -> None:
        """Load model binary into runtime session."""
        pass

    @abstractmethod
    def metadata(self) -> Dict[str, Any]:
        """Extract architectural information, parameter statistics, and node information."""
        pass

    @abstractmethod
    def input_schema(self) -> List[ModelInputSpec]:
        """Return list of model input specifications."""
        pass

    @abstractmethod
    def output_schema(self) -> List[ModelOutputSpec]:
        """Return list of model output specifications."""
        pass

    @abstractmethod
    def predict(self, inputs: np.ndarray) -> np.ndarray:
        """Perform real forward inference on provided input batch.

        Args:
            inputs: Numpy ndarray of shape (batch, channels, height, width) or (batch, height, width, channels)
                    or flattened features.

        Returns:
            Numpy ndarray containing model output logits or probabilities.
        """
        pass

    def batch_size(self) -> Optional[int]:
        """Return the model's fixed leading batch dimension, or None if it accepts any batch.

        Most exported vision models declare a hard batch dim of 1 (`(1, 3, 640, 640)`),
        so only 1 is reported as fixed. A leading dimension greater than 1 is deliberately
        NOT trusted: schemas inferred from a raw state_dict (rather than a real graph) can
        carry a channel count in that slot, and treating it as a batch size would reject
        perfectly valid inputs. Dynamic batch axes arrive as None/str and report None.
        """
        try:
            specs = self.input_schema()
        except Exception:
            return None
        for spec in specs or []:
            shape = getattr(spec, "shape", None)
            if not shape:
                continue
            try:
                lead = int(shape[0])
            except (TypeError, ValueError):
                continue
            return 1 if lead == 1 else None
        return None

    def predict_batch(self, inputs: np.ndarray) -> np.ndarray:
        """Run inference over a batch of samples, honouring a fixed batch dimension.

        Tries the whole batch first and falls back to per-sample forward passes if the
        runtime rejects the leading dimension, then concatenates. Callers therefore see the
        same leading sample axis either way, and no declared shape has to be trusted up
        front. Single-sample inputs are always a direct call.
        """
        inputs = np.asarray(inputs)
        if inputs.shape[0] <= 1:
            return self.predict(inputs)
        try:
            return self.predict(inputs)
        except Exception:
            # Model rejected the batch dimension (or the batch size); one at a time.
            pass
        outputs = [self.predict(inputs[i : i + 1]) for i in range(inputs.shape[0])]
        return np.concatenate([np.asarray(o) for o in outputs], axis=0)

    @abstractmethod
    def fingerprint(self) -> Dict[str, Any]:
        """Extract structural/internal parameter fingerprint."""
        pass

    @abstractmethod
    def close(self) -> None:
        """Release allocated runtime sessions, memory, and file handles."""
        pass

    def __enter__(self):
        self.load()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
