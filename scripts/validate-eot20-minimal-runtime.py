"""Prove TideLine's eo-tides calculation does not require excluded extras."""

import importlib.abc
import importlib.util
import os
import pathlib
import sys
import types


class BlockUnusedExtras(importlib.abc.MetaPathFinder):
    excluded = (
        "bokeh",
        "dask",
        "distributed",
        "matplotlib",
        "odc_stac",
        "planetary_computer",
        "pyarrow",
        "pystac_client",
        "sklearn",
    )

    def find_spec(self, fullname, path=None, target=None):
        if fullname in self.excluded or fullname.startswith(tuple(f"{name}." for name in self.excluded)):
            raise ModuleNotFoundError(f"Excluded TideLine runtime extra: {fullname}")
        return None


spec = importlib.util.find_spec("eo_tides")
if not spec or not spec.submodule_search_locations:
    raise RuntimeError("EO_TIDES_NOT_INSTALLED")

# Emulate deploy/eo_tides_minimal_init.py without editing the developer venv.
package = types.ModuleType("eo_tides")
package.__path__ = list(spec.submodule_search_locations)
package.__package__ = "eo_tides"
sys.modules["eo_tides"] = package
blocker = BlockUnusedExtras()
sys.meta_path.insert(0, blocker)
original_find_spec = importlib.util.find_spec


def filtered_find_spec(name, package=None):
    if name in blocker.excluded or name.startswith(tuple(f"{item}." for item in blocker.excluded)):
        return None
    return original_find_spec(name, package)


importlib.util.find_spec = filtered_find_spec

minimal_init = pathlib.Path("deploy/eo_tides_minimal_init.py")
exec(compile(minimal_init.read_text(encoding="utf-8"), str(minimal_init), "exec"), package.__dict__)

import pandas as pd

model_tides = package.model_tides
list_models = package.list_models

directory = pathlib.Path(os.environ.get("EOT20_MODEL_PATH", "data/tide-models")).resolve()
available, _ = list_models(directory=directory, show_available=False, show_supported=False)
if "EOT20" not in available:
    raise RuntimeError("EOT20_MODEL_INVALID")

times = pd.date_range("2026-07-19T00:00:00Z", periods=3, freq="1h")
result = model_tides(x=151.2767, y=-33.8915, time=times, model="EOT20", directory=directory, output_format="wide", parallel=False)
if "EOT20" not in result.columns or len(result) != 3:
    raise RuntimeError("EOT20_MINIMAL_RUNTIME_OUTPUT_INVALID")

print("EOT20 minimal runtime OK: real eo-tides calculation completed without Arrow/Dask/STAC/plotting/ML extras")
