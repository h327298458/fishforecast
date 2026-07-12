param([string]$CacheRoot = $(if ($env:EOT20_CACHE_PATH) { $env:EOT20_CACHE_PATH } else { Join-Path $PSScriptRoot '..\data\tide-model-cache' }))
throw 'SEANOE EOT20 endpoint does not support reliable HTTP Range requests. Use install-eot20.ps1 for a full verified download.'
$ErrorActionPreference='Stop'
$url='https://www.seanoe.org/data/00683/79489/data/85762.zip'
[long]$total=2330678793
$parts=8
New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
$processes=@()
for($i=0;$i -lt $parts;$i++){
  [long]$start=[math]::Floor($total*$i/$parts);[long]$end=if($i -eq $parts-1){$total-1}else{[math]::Floor($total*($i+1)/$parts)-1}
  $path=Join-Path $CacheRoot ("85762.part{0}" -f $i);$expected=$end-$start+1
  if((Test-Path -LiteralPath $path)-and(Get-Item -LiteralPath $path).Length -eq $expected){continue}
  $processes+=Start-Process -FilePath 'curl.exe' -ArgumentList @('--fail','--silent','--show-error','--location','--retry','4','--range',"$start-$end",'--output',$path,$url) -WindowStyle Hidden -PassThru
}
if($processes.Count){$processes|Wait-Process;foreach($process in $processes){if($process.ExitCode -ne 0){throw "EOT20_PART_DOWNLOAD_FAILED:$($process.Id):$($process.ExitCode)"}}}
$complete=Join-Path $CacheRoot '85762.complete.zip';$output=[System.IO.File]::Create($complete)
try{for($i=0;$i -lt $parts;$i++){[long]$start=[math]::Floor($total*$i/$parts);[long]$end=if($i -eq $parts-1){$total-1}else{[math]::Floor($total*($i+1)/$parts)-1};$path=Join-Path $CacheRoot ("85762.part{0}" -f $i);if(-not(Test-Path -LiteralPath $path)-or(Get-Item -LiteralPath $path).Length-ne($end-$start+1)){throw "EOT20_PART_INVALID:$i"};$input=[System.IO.File]::OpenRead($path);try{$input.CopyTo($output)}finally{$input.Dispose()}}}finally{$output.Dispose()}
if((Get-Item -LiteralPath $complete).Length-ne$total){throw 'EOT20_ASSEMBLY_SIZE_INVALID'}
Move-Item -LiteralPath $complete -Destination (Join-Path $CacheRoot '85762.zip') -Force
Get-FileHash -LiteralPath (Join-Path $CacheRoot '85762.zip') -Algorithm SHA256
