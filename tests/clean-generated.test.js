import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cleanGenerated } from '../tools/clean-generated.js';

const root = path.resolve(import.meta.dirname, '..');

test('clean removes only reproducible output and is exposed through npm', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lifto-clean-'));

  try {
    const generatedPaths = [
      'build/workout-extension/app.json',
      'build/lifto-companion-qr.png',
      'build/lifto-workout-qr.png',
      'dist/lifto.zab',
      'tmp/session.log',
    ];
    for (const relativePath of generatedPaths) {
      const target = path.join(tempRoot, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'generated');
    }

    const auditReport = path.join(tempRoot, 'build', 'public-release-audit.md');
    fs.writeFileSync(auditReport, 'keep');

    cleanGenerated(tempRoot);

    for (const relativePath of generatedPaths) {
      assert.equal(fs.existsSync(path.join(tempRoot, relativePath)), false, relativePath);
    }
    assert.equal(fs.readFileSync(auditReport, 'utf8'), 'keep');

    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(packageJson.scripts.clean, 'node tools/clean-generated.js');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
