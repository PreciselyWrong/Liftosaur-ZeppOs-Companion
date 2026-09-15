import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { transform } from 'esbuild';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'prepare-dev-project.js');

test('development staging helper survives the Zepp ES2015 source scan', async () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  await assert.doesNotReject(() => transform(source, { format: 'esm', target: 'es2015' }));
});

test('development staging minifies JavaScript and preserves assets', () => {
  const tempRoot = path.join(root, 'build', 'dev-test-source');
  const source = path.join(tempRoot, 'source');
  const destination = path.join(root, 'build', 'dev', 'test', 'destination');

  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.join(source, 'page', 'common'), { recursive: true });
    fs.mkdirSync(path.join(source, 'assets'), { recursive: true });
    const javascript = `
      export function answer() {
        const unnecessarilyLongName = 40;
        return unnecessarilyLongName + 2;
      }
    `;
    fs.writeFileSync(path.join(source, 'page', 'common', 'index.js'), javascript);
    fs.writeFileSync(path.join(source, 'app.json'), '{"app":{"appId":1123411}}');
    fs.writeFileSync(path.join(source, 'assets', 'icon.bin'), Buffer.from([0, 1, 2, 3]));

    const result = spawnSync(process.execPath, [scriptPath, source, destination], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const stagedJavascript = fs.readFileSync(
      path.join(destination, 'page', 'common', 'index.js'),
      'utf8',
    );
    assert.ok(stagedJavascript.length < javascript.length);
    assert.match(stagedJavascript, /export/);
    assert.deepEqual(
      fs.readFileSync(path.join(destination, 'assets', 'icon.bin')),
      Buffer.from([0, 1, 2, 3]),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test('development staging watch refreshes changed JavaScript', async () => {
  const source = path.join(root, 'build', 'dev-watch-source');
  const destination = path.join(root, 'build', 'dev', 'watch-test', 'destination');
  const sourceFile = path.join(source, 'app.js');
  let watcher;

  try {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(sourceFile, 'export const value = 1;');

    watcher = spawn(process.execPath, [scriptPath, source, destination, '--watch'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watcher did not become ready')), 3000);
      watcher.stdout.on('data', (chunk) => {
        if (!chunk.toString().includes('watching')) return;
        clearTimeout(timeout);
        resolve();
      });
      watcher.once('exit', (code) => reject(new Error(`watcher exited with ${code}`)));
    });

    fs.writeFileSync(sourceFile, 'export const value = 42;');
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const check = () => {
        const output = fs.readFileSync(path.join(destination, 'app.js'), 'utf8');
        if (output.includes('42')) return resolve();
        if (Date.now() >= deadline) return reject(new Error('staged source was not refreshed'));
        setTimeout(check, 50);
      };
      check();
    });
  } finally {
    watcher?.kill();
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
  }
});
