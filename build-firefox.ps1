$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$manifestPath = Join-Path $projectRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$distDir = Join-Path $projectRoot 'dist'
$archiveName = "GameDevBlacklist-$($manifest.version)-firefox"
$zipPath = Join-Path $distDir "$archiveName.zip"
$xpiPath = Join-Path $distDir "$archiveName.xpi"

New-Item -ItemType Directory -Path $distDir -Force | Out-Null
Remove-Item -LiteralPath $zipPath, $xpiPath -Force -ErrorAction SilentlyContinue

$packageFiles = @(
    (Join-Path $projectRoot 'manifest.json'),
    (Join-Path $projectRoot 'content.js'),
    (Join-Path $projectRoot 'content.css'),
    (Join-Path $projectRoot 'popup.html'),
    (Join-Path $projectRoot 'popup.js'),
    (Join-Path $projectRoot 'icons')
)

Compress-Archive -LiteralPath $packageFiles -DestinationPath $zipPath -CompressionLevel Optimal
Move-Item -LiteralPath $zipPath -Destination $xpiPath

Write-Output $xpiPath
