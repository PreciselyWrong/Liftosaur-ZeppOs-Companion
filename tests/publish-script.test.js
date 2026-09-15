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
  assert.match(source, /npm run preview:companion/);
  assert.match(source, /npm run preview:workout/);
  assert.match(source, /['"]release['"], ['"]create['"]/);
  assert.match(source, /& \$gh release upload/);
  assert.match(source, /& \$gh release view/);
  assert.match(source, /zeus status/);
  assert.match(source, /PUBLISH_OK/);
});

test('publish.ps1 plan is side effect free and describes the complete GitHub release', () => {
  const before = spawnSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' }).stdout;
  const result = spawnSync(
    'pwsh',
    ['-NoProfile', '-File', scriptPath, '-Plan', '-NonInteractive'],
    { cwd: path.dirname(root), encoding: 'utf8' },
  );
  const after = spawnSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' }).stdout;

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`Version : ${packageJson.version.replaceAll('.', '\\.')}`));
  assert.match(result.stdout, /GitHub/);
  assert.match(result.stdout, new RegExp(`v${packageJson.version.replaceAll('.', '\\.')}`));
  assert.match(result.stdout, /pre-release/i);
  assert.match(result.stdout, /GitHub-generated/i);
  assert.match(result.stdout, /Lifto Companion QR/i);
  assert.match(result.stdout, /Lifto Workout QR/i);
  assert.match(result.stdout, /exact QR expiry date and time/i);
  assert.match(result.stdout, /npm test/);
  assert.match(result.stdout, /npm run build:all/);
  assert.match(result.stdout, /git push origin main/);
  assert.match(result.stdout, /GitHub release/i);
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
  assert.match(result.stdout, /PUBLISH_FAILED/);
});

test('GitHub owns generated release notes without repository note configuration', () => {
  assert.equal(fs.existsSync(path.join(root, '.github', 'release.yml')), false);
  assert.equal(fs.existsSync(path.join(root, 'CHANGELOG.md')), false);
  const source = fs.readFileSync(scriptPath, 'utf8');

  assert.match(source, /--generate-notes/);
  assert.match(source, /--notes/);
  assert.doesNotMatch(source, /CHANGELOG\.md/);
  assert.match(source, /does not contain the expected QR metadata block/);
  assert.match(source, /\$actualNotes -eq \$expectedReleaseNotes/);
  assert.match(source, /releases\/generate-notes/);
  assert.match(source, /\$existingRelease\.isDraft/);
});

test('release metadata contains the exact validity of both generated QR codes', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');

  assert.match(source, /Preview expires at/);
  assert.match(source, /DateTimeOffset/);
  assert.match(source, /<!-- lifto-qr:start -->/);
  assert.match(source, /<!-- lifto-qr:end -->/);
  assert.match(source, /\$companionExpiry/);
  assert.match(source, /\$workoutExpiry/);
  assert.match(source, /QR valid until/);
  assert.match(source, /Lifto Companion QR valid until/);
  assert.match(source, /Lifto Workout QR valid until/);
  assert.doesNotMatch(source, /expire about seven days/);
});

test('the project release skill owns the complete agent workflow', () => {
  const skillPath = path.join(root, '.agents', 'skills', 'lifto-release', 'SKILL.md');
  const metadataPath = path.join(root, '.agents', 'skills', 'lifto-release', 'agents', 'openai.yaml');

  assert.equal(fs.existsSync(skillPath), true);
  assert.equal(fs.existsSync(metadataPath), true);

  const skill = fs.readFileSync(skillPath, 'utf8');
  assert.match(skill, /^name: lifto-release$/m);
  assert.match(skill, /publish\.ps1/);
  assert.match(skill, /public-release-audit/);
  assert.match(skill, /PUBLISH_OK/);
  assert.match(skill, /refresh/i);
  assert.match(skill, /GitHub Releases/);
  assert.match(skill, /CHANGELOG\.md/);
  assert.match(skill, /validity date and time/i);
});
