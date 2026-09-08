[CmdletBinding()]
param(
    [switch]$Dummy,
    [switch]$NonInteractive,
    [switch]$Plan,
    [ValidateSet('companion', 'workout')]
    [string]$Product = 'companion'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$target = 'Amazfit Active 2 (Round)'
$devRoot = if ($Product -eq 'workout') { Join-Path $projectRoot 'build/workout-extension' } else { $projectRoot }

if ($Plan) {
    Write-Output 'Mode: development'
    Write-Output 'Prerequisite: Zeus CLI and a simulator connection'
    Write-Output "Product: $Product"
    Write-Output "Project: $devRoot"
    if ($Product -eq 'workout') {
        Write-Output 'Generate: ZEPP_WORKOUT_EXTENSION_APP_ID=1125789 node tools/generate-workout-extension.js'
    }
    Write-Output "Target: $target"
    Write-Output "Command: zeus dev -t `"$target`""
    Write-Output 'Readiness: Zeus confirms the simulator connection and watches the project'
    exit 0
}

if ($Dummy) {
    throw 'Demo mode is selected by leaving the API key empty in the Zepp settings.'
}

Set-Location -LiteralPath $projectRoot

zeus status
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

if ($Product -eq 'workout') {
    $previousAppId = $env:ZEPP_WORKOUT_EXTENSION_APP_ID
    try {
        $env:ZEPP_WORKOUT_EXTENSION_APP_ID = '1125789'
        node (Join-Path $projectRoot 'tools/generate-workout-extension.js')
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        $env:ZEPP_WORKOUT_EXTENSION_APP_ID = $previousAppId
    }
}

Set-Location -LiteralPath $devRoot
zeus dev -t $target
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
