import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GENERATED_PATHS = Object.freeze([
  'build/workout-extension',
  'build/lifto-companion-qr.png',
  'build/lifto-workout-qr.png',
  'dist',
  'tmp',
]);

export function cleanGenerated(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  const rootPrefix = `${resolvedRoot}${path.sep}`;
  let removed = 0;

  for (const relativePath of GENERATED_PATHS) {
    const target = path.resolve(resolvedRoot, relativePath);
    if (!target.startsWith(rootPrefix)) {
      throw new Error(`Refusing to clean outside the project: ${relativePath}`);
    }
    if (!fs.existsSync(target)) continue;

    fs.rmSync(target, { recursive: true, force: true });
    removed += 1;
  }

  return removed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const removed = cleanGenerated(rootDir);
  console.log('[clean] Removed generated output', { removed });
}
