param([string]$OutputRoot = $(Join-Path $PSScriptRoot '..\data\raw\tides\bom-nsw'))
$ErrorActionPreference='Stop'
$base='https://www.bom.gov.au/ntc/IDO59001'
$stations=[ordered]@{
  'NSW_TP002'='Eden'; 'NSW_TP004'='Newcastle'; 'NSW_TP006'='Port Kembla';
  'NSW_TP007'='Sydney (Fort Denison)'; 'NSW_TP008'='Yamba'; 'NSW_TP001'='Botany Bay'
}
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$records=@()
foreach($year in 2026,2027){foreach($entry in $stations.GetEnumerator()){
  $filename="IDO59001_${year}_$($entry.Key).pdf"
  $url="$base/$filename"
  $path=Join-Path $OutputRoot $filename
  if(-not(Test-Path -LiteralPath $path)){& curl.exe --fail --silent --show-error --location --user-agent 'fishforecast/0.1 (+local personal research)' --referer 'https://www.bom.gov.au/oceanography/projects/ntc/nsw_tide_tables.shtml' --output $path $url;if($LASTEXITCODE -ne 0){throw "BOM_TIDE_DOWNLOAD_FAILED:$url"}}
  $item=Get-Item -LiteralPath $path
  if($item.Length -lt 10000){throw "BOM_TIDE_FILE_TOO_SMALL:${filename}:$($item.Length)"}
  $records += [pscustomobject]@{year=$year;stationId=$entry.Key;stationName=$entry.Value;filename=$filename;sourceUrl=$url;downloadedAtUtc=(Get-Date).ToUniversalTime().ToString('o');size=$item.Length;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
}}
$records | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $OutputRoot 'downloads-manifest.json') -Encoding utf8
$records | Format-Table year,stationId,stationName,size,sha256
