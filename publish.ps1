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
$version = [string]$manifest.version
$tag = "v$version"
$workoutAppId = '1125789'
$companionAsset = 'lifto-companion-qr.png'
$workoutAsset = 'lifto-workout-qr.png'
$selectedDestinations = if ($Destination.Count -eq 0) { @('github') } else { $Destination }
$unknownDestinations = @($selectedDestinations | Where-Object { $_ -ne 'github' })

function Stop-Publication([string]$Message, [int]$ExitCode) {
    Write-Error -Message $Message -ErrorAction Continue
    Write-Output 'PUBLISH_FAILED'
    exit $ExitCode
}

function Assert-NativeSuccess([string]$Message, [int]$ExitCode) {
    if ($LASTEXITCODE -ne 0) {
        Stop-Publication $Message $ExitCode
    }
}

function Convert-PreviewExpiry([object[]]$Output, [string]$Product) {
    $text = ($Output | ForEach-Object { [string]$_ }) -join "`n"
    $match = [regex]::Match($text, 'Preview expires at (?<expiry>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) local time\.')
    if (-not $match.Success) {
        Stop-Publication "Could not read the $Product QR expiry date and time." 3
    }

    try {
        $localExpiry = [datetime]::ParseExact(
            $match.Groups['expiry'].Value,
            'yyyy-MM-dd HH:mm:ss',
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::None
        )
        $offset = [TimeZoneInfo]::Local.GetUtcOffset($localExpiry)
        return ([DateTimeOffset]::new($localExpiry, $offset)).ToString(
            "yyyy-MM-dd'T'HH:mm:sszzz",
            [Globalization.CultureInfo]::InvariantCulture
        )
    } catch {
        Stop-Publication "Invalid $Product QR expiry date and time." 3
    }
}

if ($unknownDestinations.Count -gt 0) {
    Stop-Publication "Unknown destination: $($unknownDestinations -join ', ')" 2
}
if ($version -notmatch '^\d+\.\d+\.\d+$') {
    Stop-Publication "Invalid package version: $version" 2
}

$isBeta = [int]($version.Split('.')[0]) -eq 0
$releaseKind = if ($isBeta) { 'pre-release' } else { 'release' }

if ($Plan) {
    Write-Output 'Publication ready'
    Write-Output "Version : $version"
    Write-Output 'Destinations :'
    Write-Output '- GitHub'
    Write-Output "Release: $tag ($releaseKind)"
    Write-Output 'Release notes: GitHub-generated from merged pull requests'
    Write-Output 'Checks: clean main branch, audited commit, npm test, git diff --check, gitleaks'
    Write-Output 'Build: npm run build:all'
    Write-Output 'Artifacts: fresh Lifto Companion QR and Lifto Workout QR'
    Write-Output 'Release metadata: exact QR expiry date and time for each app'
    Write-Output 'Required sessions: authenticated GitHub CLI and Zeus CLI'
    Write-Output 'Activation: git push origin main, then create or refresh the GitHub release'
    Write-Output 'Verification: origin/main, release tag, notes and both QR assets'
    Write-Output 'Rollback: the previous published release remains available; rerun to repair a failed draft'
    exit 0
}

if ($NonInteractive -and -not $Confirm) {
    Stop-Publication 'Non-interactive publication requires -Confirm.' 2
}

if (-not $NonInteractive -and -not $Confirm) {
    Write-Output 'Publication ready'
    Write-Output "Version : $version"
    Write-Output 'Destinations :'
    Write-Output '- GitHub'
    Write-Output ''
    Write-Output 'Tests, both builds and both QR previews will run before publication.'
    $answer = Read-Host 'Publish now? [o/N]'
    if ($answer -notmatch '^(o|oui|y|yes)$') {
        Write-Output 'PUBLISH_FAILED'
        exit 2
    }
}

function Resolve-GitHubCli {
    $command = Get-Command gh -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $fallback = 'C:\Program Files\GitHub CLI\gh.exe'
    if (Test-Path -LiteralPath $fallback) {
        return $fallback
    }

    Stop-Publication 'GitHub CLI is required for publication.' 2
}

function Get-RemoteTagCommit([string]$TagName) {
    $lines = @(git ls-remote origin "refs/tags/$TagName" "refs/tags/$TagName^{}")
    if ($LASTEXITCODE -ne 0) {
        Stop-Publication "Could not read remote tag $TagName." 2
    }
    if ($lines.Count -eq 0) {
        return $null
    }

    $peeled = $lines | Where-Object { $_ -match '\^\{\}$' } | Select-Object -First 1
    $line = if ($peeled) { $peeled } else { $lines[0] }
    return (($line -split '\s+')[0]).Trim()
}

Set-Location -LiteralPath $projectRoot

$branch = git branch --show-current
if ($LASTEXITCODE -ne 0 -or $branch.Trim() -ne 'main') {
    Stop-Publication 'Publication requires the main branch.' 2
}

$head = git rev-parse HEAD
Assert-NativeSuccess 'Could not read the current commit.' 2
$head = $head.Trim()
if (-not $AuditedCommit -or $AuditedCommit.Trim() -ne $head) {
    Stop-Publication 'The current commit must pass public-release-audit before publication. Pass it with -AuditedCommit.' 2
}

$changes = @(git status --porcelain=v1)
Assert-NativeSuccess 'Could not inspect the working tree.' 2
if ($changes.Count -gt 0) {
    Stop-Publication 'Commit or discard every tracked and untracked change before publication.' 2
}

$gh = Resolve-GitHubCli
& $gh auth status
Assert-NativeSuccess 'GitHub CLI authentication is required for publication.' 2
$repository = (& $gh repo view --json nameWithOwner --jq '.nameWithOwner').Trim()
Assert-NativeSuccess 'Could not resolve the GitHub repository.' 2

if (-not (Get-Command zeus -ErrorAction SilentlyContinue)) {
    Stop-Publication 'Zeus CLI is required for publication.' 2
}
$zeusStatus = @(zeus status 2>&1)
$zeusStatus | ForEach-Object { Write-Output $_ }
if ($LASTEXITCODE -ne 0 -or ($zeusStatus -join "`n") -match '(?i)no login|invalid token') {
    Stop-Publication 'Zeus CLI authentication is required. Run zeus login.' 2
}

$remoteTagCommit = Get-RemoteTagCommit $tag
if ($remoteTagCommit -and $remoteTagCommit -ne $head) {
    Stop-Publication "$tag already points to another commit. Bump the version before publishing this commit." 2
}

$existingRelease = $null
$existingJson = & $gh release view $tag --repo $repository --json tagName,isDraft,isImmutable,body 2>$null
if ($LASTEXITCODE -eq 0) {
    $existingRelease = $existingJson | ConvertFrom-Json
    if ($existingRelease.isImmutable) {
        Stop-Publication "$tag is immutable. Bump the version to publish fresh QR codes." 2
    }
}

npm test
Assert-NativeSuccess 'Tests failed.' 3

git diff --check
Assert-NativeSuccess 'Git whitespace checks failed.' 3

if (-not (Get-Command gitleaks -ErrorAction SilentlyContinue)) {
    Stop-Publication 'gitleaks is required for publication.' 3
}
gitleaks git --redact --no-banner
Assert-NativeSuccess 'Secret scanning failed.' 3

$previousWorkoutAppId = $env:ZEPP_WORKOUT_EXTENSION_APP_ID
$env:ZEPP_WORKOUT_EXTENSION_APP_ID = $workoutAppId
npm run build:all
Assert-NativeSuccess 'Build failed.' 3

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempDir = [IO.Path]::GetFullPath((Join-Path $tempRoot "lifto-release-$([guid]::NewGuid().ToString('N'))"))
if (-not $tempDir.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Stop-Publication 'Invalid release temporary directory.' 3
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
    $companionQr = Join-Path $tempDir $companionAsset
    $workoutQr = Join-Path $tempDir $workoutAsset
    $companionOutput = @()
    npm run preview:companion -- $companionQr 2>&1 | Tee-Object -Variable companionOutput
    Assert-NativeSuccess 'Lifto Companion QR generation failed.' 3
    $companionExpiry = Convert-PreviewExpiry $companionOutput 'Lifto Companion'

    $workoutOutput = @()
    npm run preview:workout -- $workoutQr 2>&1 | Tee-Object -Variable workoutOutput
    Assert-NativeSuccess 'Lifto Workout QR generation failed.' 3
    $workoutExpiry = Convert-PreviewExpiry $workoutOutput 'Lifto Workout'

    foreach ($assetPath in @($companionQr, $workoutQr)) {
        if (-not (Test-Path -LiteralPath $assetPath) -or (Get-Item -LiteralPath $assetPath).Length -eq 0) {
            Stop-Publication "Missing release asset: $assetPath" 3
        }
    }

    $postBuildChanges = @(git status --porcelain=v1)
    Assert-NativeSuccess 'Could not inspect the working tree after the build.' 3
    if ($postBuildChanges.Count -gt 0) {
        Stop-Publication 'The build changed the working tree. Restore it before publication.' 3
    }

    git push origin main
    Assert-NativeSuccess 'Git push failed.' 4

    $remoteLine = git ls-remote origin refs/heads/main
    Assert-NativeSuccess 'Could not verify origin/main.' 4
    $remoteHead = (($remoteLine -split '\s+')[0]).Trim()
    if ($remoteHead -ne $head) {
        Stop-Publication "GitHub verification failed: local $head, remote $remoteHead." 4
    }

    $assetBase = "https://github.com/$repository/releases/download/$tag"
    $releaseTitle = if ($isBeta) { "Lifto $version beta" } else { "Lifto $version" }
    $qrBlockStart = '<!-- lifto-qr:start -->'
    $qrBlockEnd = '<!-- lifto-qr:end -->'
    $installNotes = @"
$qrBlockStart
## Install

Enable Developer Mode in the Zepp app, then scan the QR code for the app you want.

| App | QR code | QR valid until |
| --- | --- | --- |
| Lifto Companion | ![Lifto Companion QR]($assetBase/$companionAsset) | $companionExpiry |
| Lifto Workout Extension | ![Lifto Workout QR]($assetBase/$workoutAsset) | $workoutExpiry |
$qrBlockEnd
"@
    $installNotes = $installNotes.Trim() -replace "`r`n", "`n"

    if ($existingRelease) {
        $existingNotes = ([string]$existingRelease.body).Trim() -replace "`r`n", "`n"
        if ($existingRelease.isDraft) {
            $generatedJson = & $gh api --method POST "repos/$repository/releases/generate-notes" -f "tag_name=$tag" -f "target_commitish=$head"
            Assert-NativeSuccess 'GitHub release-note generation failed.' 4
            $generatedNotes = [string]($generatedJson | ConvertFrom-Json).body
            $draftNotes = @($installNotes, $generatedNotes.Trim()) | Where-Object { $_ }
            $expectedReleaseNotes = ($draftNotes -join "`n`n").Trim() -replace "`r`n", "`n"
        } else {
            $qrPattern = "(?s)$([regex]::Escape($qrBlockStart)).*?$([regex]::Escape($qrBlockEnd))"
            $qrMatch = [regex]::Match($existingNotes, $qrPattern)
            if (-not $qrMatch.Success) {
                Stop-Publication "$tag does not contain the expected QR metadata block. Bump the version instead of rewriting its release notes." 4
            }
            $expectedReleaseNotes = (
                $existingNotes.Substring(0, $qrMatch.Index) +
                $installNotes +
                $existingNotes.Substring($qrMatch.Index + $qrMatch.Length)
            ).Trim()
        }

        & $gh release upload $tag $companionQr $workoutQr --clobber --repo $repository
        Assert-NativeSuccess 'GitHub release asset upload failed.' 4

        if ($existingRelease.isDraft) {
            $editArgs = @('release', 'edit', $tag, '--repo', $repository, '--title', $releaseTitle, '--notes', $expectedReleaseNotes, '--draft=false')
            if ($isBeta) {
                $editArgs += @('--prerelease', '--latest=false')
            } else {
                $editArgs += @('--prerelease=false', '--latest')
            }
            & $gh @editArgs
            Assert-NativeSuccess 'GitHub release publication failed.' 4
        } else {
            & $gh release edit $tag --repo $repository --notes $expectedReleaseNotes
            Assert-NativeSuccess 'GitHub release QR metadata update failed.' 4
        }
    } else {
        $createArgs = @('release', 'create', $tag, $companionQr, $workoutQr, '--repo', $repository, '--target', $head, '--title', $releaseTitle, '--notes', $installNotes, '--generate-notes')
        if ($isBeta) {
            $createArgs += @('--prerelease', '--latest=false')
        } else {
            $createArgs += '--latest'
        }
        & $gh @createArgs
        Assert-NativeSuccess 'GitHub release creation failed.' 4
    }

    $releaseJson = & $gh release view $tag --repo $repository --json tagName,isDraft,isPrerelease,body,url,assets
    Assert-NativeSuccess 'Could not read back the GitHub release.' 4
    $release = $releaseJson | ConvertFrom-Json
    $actualAssets = @($release.assets)
    $expectedInstallNotes = $installNotes -replace "`r`n", "`n"
    $actualNotes = ([string]$release.body).Trim() -replace "`r`n", "`n"

    $notesValid = if ($existingRelease) {
        $actualNotes -eq $expectedReleaseNotes
    } else {
        $actualNotes.StartsWith($expectedInstallNotes)
    }
    if ($release.tagName -ne $tag -or $release.isDraft -or $release.isPrerelease -ne $isBeta -or -not $notesValid) {
        Stop-Publication 'GitHub release metadata verification failed.' 4
    }
    foreach ($assetName in @($companionAsset, $workoutAsset)) {
        $asset = $actualAssets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
        if (-not $asset -or [int64]$asset.size -le 0) {
            Stop-Publication "GitHub release asset verification failed: $assetName" 4
        }
    }

    $publishedTagCommit = Get-RemoteTagCommit $tag
    if ($publishedTagCommit -ne $head) {
        Stop-Publication "GitHub release tag verification failed: expected $head, received $publishedTagCommit." 4
    }

    Write-Output "Release: $($release.url)"
    Write-Output "Lifto Companion QR valid until: $companionExpiry"
    Write-Output "Lifto Workout QR valid until: $workoutExpiry"
    Write-Output 'PUBLISH_OK'
} finally {
    if ($null -eq $previousWorkoutAppId) {
        Remove-Item Env:ZEPP_WORKOUT_EXTENSION_APP_ID -ErrorAction SilentlyContinue
    } else {
        $env:ZEPP_WORKOUT_EXTENSION_APP_ID = $previousWorkoutAppId
    }
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}
