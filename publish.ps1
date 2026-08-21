[CmdletBinding()]
param(
    [switch]$NonInteractive,
    [switch]$Plan,
    [switch]$Confirm,
    [string[]]$Destination = @(),
    [string]$AuditedCommit = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$manifest = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$version = $manifest.version
$selectedDestinations = if ($Destination.Count -eq 0) { @('github') } else { $Destination }
$unknownDestinations = @($selectedDestinations | Where-Object { $_ -ne 'github' })

if ($unknownDestinations.Count -gt 0) {
    Write-Error "Unknown destination: $($unknownDestinations -join ', ')"
    exit 2
}

if ($Plan) {
    Write-Output 'Publication ready'
    Write-Output "Version : $version"
    Write-Output 'Destinations :'
    Write-Output '- GitHub'
    Write-Output 'Checks: clean main branch, audited commit, npm test, git diff --check, gitleaks'
    Write-Output 'Build: zeus build'
    Write-Output 'Artifact: ignored dist/*.zab verification build'
    Write-Output 'Required secrets: none'
    Write-Output 'Activation: git push origin main'
    Write-Output 'Verification: origin/main commit equals local main'
    Write-Output 'Rollback: revert the published commit and publish the revert'
    exit 0
}

if ($NonInteractive -and -not $Confirm) {
    Write-Error 'Non-interactive publication requires -Confirm.'
    exit 2
}

if (-not $NonInteractive -and -not $Confirm) {
    Write-Output 'Publication ready'
    Write-Output "Version : $version"
    Write-Output 'Destinations :'
    Write-Output '- GitHub'
    Write-Output ''
    Write-Output 'Tests and build will run before publication.'
    $answer = Read-Host 'Publish now? [o/N]'
    if ($answer -notmatch '^(o|oui|y|yes)$') {
        Write-Output 'PUBLISH_FAILED'
        exit 2
    }
}

Set-Location -LiteralPath $projectRoot

$branch = git branch --show-current
if ($LASTEXITCODE -ne 0 -or $branch.Trim() -ne 'main') {
    Write-Error 'Publication requires the main branch.'
    exit 2
}

$head = git rev-parse HEAD
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
$head = $head.Trim()
if (-not $AuditedCommit -or $AuditedCommit.Trim() -ne $head) {
    Write-Error 'The current commit must pass public-release-audit before publication. Pass it with -AuditedCommit.'
    exit 2
}

$changes = @(git status --porcelain=v1)
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
if ($changes.Count -gt 0) {
    Write-Error 'Commit or discard every tracked and untracked change before publication.'
    exit 2
}

npm test
if ($LASTEXITCODE -ne 0) {
    Write-Output 'PUBLISH_FAILED'
    exit 3
}

git diff --check
if ($LASTEXITCODE -ne 0) {
    Write-Output 'PUBLISH_FAILED'
    exit 3
}

if (-not (Get-Command gitleaks -ErrorAction SilentlyContinue)) {
    Write-Error 'gitleaks is required for publication.'
    exit 3
}
gitleaks git --redact --no-banner
if ($LASTEXITCODE -ne 0) {
    Write-Output 'PUBLISH_FAILED'
    exit 3
}

zeus build
if ($LASTEXITCODE -ne 0) {
    Write-Output 'PUBLISH_FAILED'
    exit 3
}

git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Output 'PUBLISH_FAILED'
    exit 4
}

$remoteLine = git ls-remote origin refs/heads/main
if ($LASTEXITCODE -ne 0) {
    Write-Output 'PUBLISH_FAILED'
    exit 4
}
$remoteHead = (($remoteLine -split '\s+')[0]).Trim()
if ($remoteHead -ne $head) {
    Write-Error "GitHub verification failed: local $head, remote $remoteHead."
    Write-Output 'PUBLISH_FAILED'
    exit 4
}

Write-Output "Published commit: $head"
Write-Output 'PUBLISH_OK'
