param(
  [string]$Python = $(if ($env:EOT20_BOOTSTRAP_PYTHON) { $env:EOT20_BOOTSTRAP_PYTHON } else { 'python' }),
  [string]$VenvPath = $(Join-Path $PSScriptRoot '..\.venv-eot20')
)
$ErrorActionPreference='Stop'
& $Python -c "import sys; assert sys.version_info[:2] in [(3,11),(3,12),(3,13)], 'eo-tides bootstrap requires Python 3.11-3.13'; print(sys.version)"
if($LASTEXITCODE-ne 0){throw 'EOT20_PYTHON_VERSION_UNSUPPORTED'}
if(-not(Test-Path -LiteralPath (Join-Path $VenvPath 'Scripts\python.exe'))){& $Python -m venv $VenvPath;if($LASTEXITCODE-ne 0){throw 'EOT20_VENV_CREATE_FAILED'}}
$venvPython=Join-Path $VenvPath 'Scripts\python.exe'
& $venvPython -m pip install --disable-pip-version-check 'eo-tides==0.10.4'
if($LASTEXITCODE-ne 0){throw 'EOT20_DEPENDENCY_INSTALL_FAILED'}
& $venvPython -c "import importlib.metadata; print(importlib.metadata.version('eo-tides'))"
Write-Output "Set EOT20_PYTHON=$venvPython"
