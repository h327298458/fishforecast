"""Minimal eo-tides package surface for TideLine's point-tide worker.

The upstream package imports satellite STAC, plotting and validation modules
from ``__init__``. TideLine only calls the supported model and model-discovery
APIs, so importing those unrelated modules wastes hundreds of MB in a small
container. The actual model implementation remains upstream eo-tides/pyTMD.
"""

from importlib.metadata import version

from .model import ensemble_tides, model_phases, model_tides
from .utils import list_models

__all__ = [
    "ensemble_tides",
    "list_models",
    "model_phases",
    "model_tides",
]

__version__ = version("eo-tides")
