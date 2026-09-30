"""Model adapters package for TRUST-CV model assurance.

Adapters are resolved lazily (PEP 562). Importing the ONNX adapter must not drag in
PyTorch: ``pytorch_adapter`` and ``torchscript_adapter`` both ``import torch`` at module
level, and torch costs seconds to import. Since ``factory`` is reached from the model
upload path, eager imports here made the first ``.onnx`` upload pay a multi-second
import bill for a framework it never uses.

``from app.models_engine.adapters import ONNXAdapter`` still works exactly as before.
"""
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - import-time cost avoided at runtime
    from app.models_engine.adapters.base import BaseModelAdapter
    from app.models_engine.adapters.blackbox_adapter import BlackBoxAdapter
    from app.models_engine.adapters.factory import ModelAdapterFactory
    from app.models_engine.adapters.onnx_adapter import ONNXAdapter
    from app.models_engine.adapters.pytorch_adapter import PyTorchAdapter
    from app.models_engine.adapters.torchscript_adapter import TorchScriptAdapter

__all__ = [
    "BaseModelAdapter",
    "ONNXAdapter",
    "TorchScriptAdapter",
    "PyTorchAdapter",
    "BlackBoxAdapter",
    "ModelAdapterFactory",
]

# Attribute name -> defining submodule, so each adapter loads only when touched.
_LAZY_SUBMODULES = {
    "BaseModelAdapter": "base",
    "ONNXAdapter": "onnx_adapter",
    "TorchScriptAdapter": "torchscript_adapter",
    "PyTorchAdapter": "pytorch_adapter",
    "BlackBoxAdapter": "blackbox_adapter",
    "ModelAdapterFactory": "factory",
}


def __getattr__(name: str):
    submodule = _LAZY_SUBMODULES.get(name)
    if submodule is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    import importlib

    module = importlib.import_module(f"{__name__}.{submodule}")
    value = getattr(module, name)
    globals()[name] = value
    return value


def __dir__():
    return sorted(set(globals()) | set(_LAZY_SUBMODULES))
