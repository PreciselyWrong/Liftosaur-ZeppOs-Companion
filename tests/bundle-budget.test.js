import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { MINIFY_OPTIONS } from '../tools/prepare-dev-project.js';

const root = path.resolve(import.meta.dirname, '..');

// Minified bytes of each bundle Zeus compiles, with the options every build uses. The watch keeps the
// compiled page in its 3 MiB of system memory, so raising a ceiling is a decision, not a side effect:
// measure on the watch, then raise it in the same change. Ceilings leave about 3% over the measured size.
const BUDGETS = [
  { product: 'companion', entry: 'page/common/index.js', measured: 196_490, ceiling: 202_400 },
  { product: 'workout', entry: 'data-widget/common/index.js', measured: 198_261, ceiling: 204_200 },
  { product: 'both', entry: 'app-side/index.js', measured: 101_516, ceiling: 105_000 },
  { product: 'both', entry: 'setting/index.js', measured: 20_626, ceiling: 21_300 },
  { product: 'both', entry: 'app.js', measured: 20_410, ceiling: 21_100 },
];

async function minifiedBytes(entry) {
  const result = await build({
    ...MINIFY_OPTIONS,
    entryPoints: [path.join(root, entry)],
    bundle: true,
    write: false,
    // Device modules are provided by the watch firmware at run time.
    external: ['@zos/*'],
    logLevel: 'silent',
  });
  return result.outputFiles[0].contents.length;
}

for (const { product, entry, measured, ceiling } of BUDGETS) {
  test(`${product} ${entry} stays within its minified size budget`, async (t) => {
    const bytes = await minifiedBytes(entry);
    t.diagnostic(`${entry}: ${bytes} bytes (measured ${measured}, ceiling ${ceiling})`);
    assert.ok(bytes <= ceiling, `${entry} grew to ${bytes} bytes, above its ${ceiling} byte budget`);
  });
}
