import fs, { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Development, release and preview builds all compile the same minified copy, so timings and
// memory measured during development describe the shipped bytecode.
const allowedDestinationRoots = [path.join(projectRoot, 'build', 'dev'), path.join(projectRoot, 'build', 'release')];
export const MINIFY_OPTIONS = Object.freeze({
  charset: 'ascii',
  format: 'esm',
  legalComments: 'none',
  minify: true,
  target: 'es2018',
});
const projectEntries = [
  'app-side',
  'assets',
  'data-widget',
  'page',
  'setting',
  'shared',
  'app.js',
  'app.json',
  'global.d.ts',
  'jsconfig.json',
  'package.json',
];

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function minifyModule(source) {
  return transformSync(source, MINIFY_OPTIONS).code;
}

function copyEntry(sourcePath, destinationPath) {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.mkdirSync(destinationPath, { recursive: true });
    for (const entry of fs.readdirSync(sourcePath)) {
      copyEntry(path.join(sourcePath, entry), path.join(destinationPath, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  if (path.extname(sourcePath) !== '.js') {
    fs.copyFileSync(sourcePath, destinationPath);
    return;
  }
  fs.writeFileSync(destinationPath, minifyModule(fs.readFileSync(sourcePath, 'utf8')));
}

export function prepareProjectSync(source, destination) {
  const sourceRoot = path.resolve(source);
  const destinationRoot = path.resolve(destination);
  if (!allowedDestinationRoots.some((root) => isWithin(root, destinationRoot))) {
    throw new Error(`Prepared output must be inside ${allowedDestinationRoots.join(' or ')}`);
  }

  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const entry of projectEntries) {
    const sourcePath = path.join(sourceRoot, entry);
    try {
      copyEntry(sourcePath, path.join(destinationRoot, entry));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return destinationRoot;
}

export async function prepareDevProject(source, destination) {
  return prepareProjectSync(source, destination);
}

async function main(args = process.argv.slice(2)) {
  const [source, destination] = args;
  if (!source || !destination) {
    throw new Error('Usage: node tools/prepare-dev-project.js <source> <destination>');
  }
  const watchMode = args.includes('--watch');
  const skipInitial = args.includes('--skip-initial');
  if (!skipInitial) {
    const prepared = await prepareDevProject(source, destination);
    console.log(`Development project prepared: ${prepared}`);
  }

  if (watchMode) {
    let timer;
    let rebuilding = false;
    let pending = false;
    const rebuild = async () => {
      if (rebuilding) {
        pending = true;
        return;
      }
      rebuilding = true;
      try {
        await prepareDevProject(source, destination);
      } catch (error) {
        console.error(`Development project refresh failed: ${error.message}`);
      } finally {
        rebuilding = false;
        if (pending) {
          pending = false;
          void rebuild();
        }
      }
    };
    const sourceWatcher = watch(source, { recursive: true }, (_event, filename) => {
      const topLevel = String(filename || '').split(/[\\/]/, 1)[0];
      if (!projectEntries.includes(topLevel)) return;
      clearTimeout(timer);
      timer = setTimeout(() => void rebuild(), 75);
    });
    const close = () => sourceWatcher.close();
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    console.log(`Development project watching: ${path.resolve(source)}`);
    await new Promise((resolve, reject) => {
      sourceWatcher.once('close', resolve);
      sourceWatcher.once('error', reject);
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
