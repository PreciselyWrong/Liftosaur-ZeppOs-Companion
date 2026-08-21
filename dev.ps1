[CmdletBinding()]
param(
    [switch]$Dummy,
    [switch]$NonInteractive,
    [switch]$Plan
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$target = 'Amazfit Active 2 (Round)'

if ($Plan) {
    Write-Output 'Mode: development'
    Write-Output 'Prerequisite: Zeus CLI and a simulator connection'
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

zeus dev -t $target
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
