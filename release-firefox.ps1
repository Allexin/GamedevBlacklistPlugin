param(
    [switch]$VerboseLog
)

$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$credentialsPath = Join-Path $projectRoot '.web-ext-credentials.json'
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'manifest.json') -Raw | ConvertFrom-Json
$distDir = Join-Path $projectRoot 'dist'
$stagingDir = Join-Path ([IO.Path]::GetTempPath()) ("gdbl-firefox-" + [guid]::NewGuid().ToString('N'))

if (-not (Test-Path -LiteralPath $credentialsPath -PathType Leaf)) {
    throw 'Create .web-ext-credentials.json from .web-ext-credentials.example.json first.'
}

$credentials = Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json
if (-not $credentials.api_key -or -not $credentials.api_secret) {
    throw '.web-ext-credentials.json must contain api_key and api_secret.'
}

$previousApiKey = $env:WEB_EXT_API_KEY
$previousApiSecret = $env:WEB_EXT_API_SECRET
$previousUseEnvProxy = $env:NODE_USE_ENV_PROXY

try {
    New-Item -ItemType Directory -Path $stagingDir | Out-Null
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null

    foreach ($file in @('manifest.json', 'content.js', 'content.css', 'popup.html', 'popup.js')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $stagingDir
    }
    Copy-Item -LiteralPath (Join-Path $projectRoot 'icons') -Destination $stagingDir -Recurse

    $env:WEB_EXT_API_KEY = [string]$credentials.api_key
    $env:WEB_EXT_API_SECRET = [string]$credentials.api_secret
    if ($env:HTTPS_PROXY) {
        # Node 22.21+/24+ native fetch needs this to honor HTTP(S)_PROXY.
        $env:NODE_USE_ENV_PROXY = '1'
    }

    $signArgs = @(
        '--yes',
        'web-ext@latest',
        'sign',
        '--source-dir', $stagingDir,
        '--artifacts-dir', $distDir,
        '--channel', 'unlisted'
    )
    if ($env:HTTPS_PROXY) {
        $signArgs += @('--api-proxy', $env:HTTPS_PROXY)
    }
    if ($VerboseLog) {
        $signArgs += '--verbose'
    }

    $signStartedAt = (Get-Date).AddSeconds(-2)
    & npx.cmd @signArgs

    if ($LASTEXITCODE -ne 0) {
        throw "web-ext sign failed with exit code $LASTEXITCODE."
    }

    $downloadedXpi = Get-ChildItem -LiteralPath $distDir -Filter '*.xpi' |
        Where-Object LastWriteTime -GE $signStartedAt |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $downloadedXpi) {
        throw 'Mozilla reported success, but the signed XPI was not found in dist.'
    }

    $signedPath = Join-Path $distDir "GameDevBlacklist-$($manifest.version)-firefox-signed.xpi"
    if ($downloadedXpi.FullName -ne $signedPath) {
        Remove-Item -LiteralPath $signedPath -Force -ErrorAction SilentlyContinue
        Move-Item -LiteralPath $downloadedXpi.FullName -Destination $signedPath
    }
    Write-Output "Signed release: $signedPath"
}
finally {
    $env:WEB_EXT_API_KEY = $previousApiKey
    $env:WEB_EXT_API_SECRET = $previousApiSecret
    $env:NODE_USE_ENV_PROXY = $previousUseEnvProxy

    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $resolvedStaging = [IO.Path]::GetFullPath($stagingDir)
    $safeLeaf = Split-Path -Leaf $resolvedStaging
    if ($resolvedStaging.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        $safeLeaf -match '^gdbl-firefox-[0-9a-f]{32}$' -and
        (Test-Path -LiteralPath $resolvedStaging)) {
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
}
