param(
  [string]$ModelRoot = $(if ($env:EOT20_MODEL_PATH) { $env:EOT20_MODEL_PATH } else { Join-Path $PSScriptRoot '..\data\tide-models' }),
  [string]$CacheRoot = $(if ($env:EOT20_CACHE_PATH) { $env:EOT20_CACHE_PATH } else { Join-Path $PSScriptRoot '..\data\tide-model-cache' })
)
$ErrorActionPreference = 'Stop'
$sourceUrl = 'https://www.seanoe.org/data/00683/79489/data/85762.zip'
$archive = Join-Path $CacheRoot '85762.zip'
$download = Join-Path $CacheRoot '85762.downloading.zip'
$outer = Join-Path $CacheRoot '85762-extracted'
$modelDir = Join-Path $ModelRoot 'EOT20'
$oceanDir = Join-Path $modelDir 'ocean_tides'
New-Item -ItemType Directory -Force -Path $CacheRoot,$ModelRoot | Out-Null
$lockPath=Join-Path $CacheRoot 'install.lock'
try{$lock=[System.IO.File]::Open($lockPath,[System.IO.FileMode]::OpenOrCreate,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None)}catch{throw 'EOT20_INSTALL_ALREADY_RUNNING'}
try {
if (-not (Test-Path -LiteralPath $archive) -or (Get-Item -LiteralPath $archive).Length -ne 2330678793) {
  & curl.exe --fail --silent --show-error --location --output $download $sourceUrl
  if ($LASTEXITCODE -ne 0) { throw "EOT20_DOWNLOAD_FAILED:$LASTEXITCODE" }
  if ((Get-Item -LiteralPath $download).Length -ne 2330678793) { throw "EOT20_DOWNLOAD_SIZE_INVALID:$((Get-Item -LiteralPath $download).Length)" }
  Move-Item -LiteralPath $download -Destination $archive -Force
}
$archiveSize = (Get-Item -LiteralPath $archive).Length
if ($archiveSize -lt 2000000000) { throw "EOT20_ARCHIVE_INCOMPLETE:$archiveSize" }
$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if (-not (Test-Path -LiteralPath $outer)) {
  Expand-Archive -LiteralPath $archive -DestinationPath $outer
}
$oceanArchive = Get-ChildItem -LiteralPath $outer -Recurse -Filter 'ocean_tides.zip' -File | Select-Object -First 1
if (-not $oceanArchive) { throw 'EOT20_OCEAN_ARCHIVE_MISSING' }
if (-not (Test-Path -LiteralPath $oceanDir)) {
  New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
  Expand-Archive -LiteralPath $oceanArchive.FullName -DestinationPath $modelDir
}
$files = @(Get-ChildItem -LiteralPath $oceanDir -Filter '*_ocean_eot20.nc' -File)
if ($files.Count -lt 17) { throw "EOT20_MODEL_INVALID:$($files.Count)" }
$manifest = $files | Sort-Object Name | ForEach-Object { [pscustomobject]@{ name=$_.Name; size=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } }
$metadata = [ordered]@{ model='EOT20'; version='EOT20-85762'; sourceUrl=$sourceUrl; doi='10.17882/79489'; installedAtUtc=(Get-Date).ToUniversalTime().ToString('o'); archiveSha256=$archiveHash; archiveSize=$archiveSize; fileCount=$files.Count; files=$manifest }
$metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $modelDir 'manifest.json') -Encoding utf8
$metadata | ConvertTo-Json -Depth 2
} finally { $lock.Dispose() }
