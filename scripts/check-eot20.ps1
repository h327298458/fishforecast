$ErrorActionPreference = 'Stop'
$modelRoot = if ($env:EOT20_MODEL_PATH) { $env:EOT20_MODEL_PATH } elseif ($env:EO_TIDES_TIDE_MODELS) { $env:EO_TIDES_TIDE_MODELS } else { Join-Path $PSScriptRoot '..\data\tide-models' }
$expected = Join-Path $modelRoot 'EOT20\ocean_tides'
Write-Host "Expected EOT20 files: $expected"
if (-not (Test-Path -LiteralPath $expected)) { Write-Error 'EOT20_MODEL_FILES_MISSING. Download 85762.zip from https://doi.org/10.17882/79489, then extract ocean_tides.zip to the path above. The upstream archive is about 2.3 GB and is intentionally not committed or silently downloaded.' }
$files = @(Get-ChildItem -LiteralPath $expected -Filter '*_ocean_eot20.nc' -File)
if ($files.Count -lt 10) { Write-Error "EOT20_MODEL_INVALID: only $($files.Count) constituent files found" }
Write-Host "EOT20 ready: $($files.Count) NetCDF constituent files"
