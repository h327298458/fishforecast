"""JSON bridge to Geoscience Australia's eo-tides; never generates fallback curves."""
import contextlib, json, os, sys
import pandas as pd
from eo_tides.model import model_tides
from eo_tides.utils import list_models

request = json.loads(sys.stdin.read())
directory = request.get("modelPath") or os.environ.get("EOT20_MODEL_PATH") or os.environ.get("EO_TIDES_TIDE_MODELS")
if not directory or not os.path.isdir(os.path.join(directory, "EOT20", "ocean_tides")):
    raise RuntimeError("EOT20_MODEL_FILES_MISSING")
available, _ = list_models(directory=directory, show_available=False, show_supported=False)
if "EOT20" not in available:
    raise RuntimeError("EOT20_MODEL_INVALID")
times = pd.date_range(request["startUtc"], request["endUtc"], freq=f'{int(request["intervalMinutes"])}min', inclusive="left")
with contextlib.redirect_stdout(sys.stderr):
    result = model_tides(
        x=float(request["longitude"]),
        y=float(request["latitude"]),
        time=times,
        model="EOT20",
        directory=directory,
        output_format="wide",
        parallel=False,
    )
if not isinstance(result, pd.DataFrame) or "EOT20" not in result.columns:
    raise RuntimeError("EOT20_OUTPUT_INVALID")
values = result["EOT20"].tolist()
if len(values) != len(times) or any(pd.isna(value) for value in values):
    raise RuntimeError("EOT20_OUTPUT_INCOMPLETE")
print(json.dumps({"model": "EOT20", "values": [{"timestampUtc": t.isoformat().replace("+00:00", "Z"), "heightM": float(v)} for t, v in zip(times, values)]}))
