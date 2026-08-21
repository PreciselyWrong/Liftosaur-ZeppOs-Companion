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
