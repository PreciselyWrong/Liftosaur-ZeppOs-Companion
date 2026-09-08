import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const scriptPath = path.join(root, 'dev.ps1');

test('dev.ps1 exposes the standard safe interface', () => {
  assert.equal(fs.existsSync(scriptPath), true);
  const source = fs.readFileSync(scriptPath, 'utf8');

  assert.match(source, /\[CmdletBinding\(\)\]/);
  assert.match(source, /\[switch\]\$Dummy/);
  assert.match(source, /\[switch\]\$NonInteractive/);
  assert.match(source, /\[switch\]\$Plan/);
  assert.match(source, /Set-StrictMode -Version Latest/);
  assert.match(source, /\$PSScriptRoot/);
  assert.match(source, /zeus dev -t \$target/);
  assert.match(source, /\$LASTEXITCODE/);
});

test('dev.ps1 plan is side effect free and documents the real command', () => {
  const result = spawnSync(
    'pwsh',
    ['-NoProfile', '-File', scriptPath, '-Plan', '-NonInteractive'],
    { cwd: path.dirname(root), encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Amazfit Active 2 \(Round\)/);
  assert.match(result.stdout, /zeus dev/);
  assert.match(result.stdout, /simulator connection/);
});

function runMockedDev(args, nodeExit = 0) {
  const command = `
    function Set-Location { param($LiteralPath) $global:devDirectory = $LiteralPath }
    function node { Write-Output "GENERATE:$($env:ZEPP_WORKOUT_EXTENSION_APP_ID):$args"; $global:LASTEXITCODE = ${nodeExit} }
    function zeus { Write-Output "ZEUS:$args DIRECTORY:$global:devDirectory"; $global:LASTEXITCODE = 0 }
    & '${scriptPath.replaceAll("'", "''")}' ${args}
    exit $LASTEXITCODE
  `;
  return spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
}

test('workout plan names generation and generated project without running either command', () => {
  const result = runMockedDev('-Product workout -Plan -NonInteractive');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1125789/);
  assert.match(result.stdout, /generate-workout-extension\.js/);
  assert.match(result.stdout, /build[\\/]workout-extension/);
  assert.doesNotMatch(result.stdout, /GENERATE:|ZEUS:/);
});

test('workout dev generates the real app and runs one foreground watcher in its project', () => {
  const result = runMockedDev('-Product workout -NonInteractive');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GENERATE:1125789.*generate-workout-extension\.js/);
  assert.match(result.stdout, /ZEUS:dev -t Amazfit Active 2 \(Round\) DIRECTORY:.*build[\\/]workout-extension/);
  assert.equal((result.stdout.match(/ZEUS:dev/g) || []).length, 1);
});

test('companion stays default and generation failure prevents workout watcher startup', () => {
  const companion = runMockedDev('-NonInteractive');
  assert.equal(companion.status, 0, companion.stderr);
  assert.doesNotMatch(companion.stdout, /GENERATE:/);
  assert.match(companion.stdout, /ZEUS:dev/);
  const failed = runMockedDev('-Product workout -NonInteractive', 7);
  assert.equal(failed.status, 7, failed.stderr);
  assert.doesNotMatch(failed.stdout, /ZEUS:dev/);
});
