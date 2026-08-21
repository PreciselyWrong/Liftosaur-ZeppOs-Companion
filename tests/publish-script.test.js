import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const scriptPath = path.join(root, 'publish.ps1');

test('publish.ps1 exposes the standard fail-closed GitHub interface', () => {
  assert.equal(fs.existsSync(scriptPath), true);
  const source = fs.readFileSync(scriptPath, 'utf8');

  assert.match(source, /\[CmdletBinding\(\)\]/);
  assert.match(source, /\[switch\]\$NonInteractive/);
  assert.match(source, /\[switch\]\$Plan/);
  assert.match(source, /\[switch\]\$Confirm/);
  assert.match(source, /\[string\[\]\]\$Destination/);
  assert.match(source, /Set-StrictMode -Version Latest/);
  assert.match(source, /\$PSScriptRoot/);
  assert.match(source, /git push origin main/);
  assert.match(source, /PUBLISH_OK/);
});

test('publish.ps1 plan is side effect free and describes GitHub publication', () => {
  const before = spawnSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' }).stdout;
  const result = spawnSync(
    'pwsh',
    ['-NoProfile', '-File', scriptPath, '-Plan', '-NonInteractive'],
    { cwd: path.dirname(root), encoding: 'utf8' },
  );
  const after = spawnSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' }).stdout;

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Version : 0\.3\.0/);
  assert.match(result.stdout, /GitHub/);
  assert.match(result.stdout, /npm test/);
  assert.match(result.stdout, /zeus build/);
  assert.match(result.stdout, /git push origin main/);
  assert.equal(after, before);
});

test('publish.ps1 rejects non-interactive publication without confirmation', () => {
  const result = spawnSync(
    'pwsh',
    ['-NoProfile', '-File', scriptPath, '-NonInteractive'],
    { cwd: root, encoding: 'utf8' },
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Confirm/);
});
