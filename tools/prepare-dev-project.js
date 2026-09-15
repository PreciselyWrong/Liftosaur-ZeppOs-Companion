import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowedDestinationRoot = path.join(projectRoot, 'build', 'dev');
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

async function copyEntry(sourcePath, destinationPath) {
  const stat = await fs.stat(sourcePath);
  if (stat.isDirectory()) {
    await fs.mkdir(destinationPath, { recursive: true });
    const entries = await fs.readdir(sourcePath);
    await Promise.all(
      entries.map((entry) =>
        copyEntry(path.join(sourcePath, entry), path.join(destinationPath, entry)),
      ),
    );
    return;
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  if (path.extname(sourcePath) !== '.js') {
    await fs.copyFile(sourcePath, destinationPath);
    return;
  }

  const source = await fs.readFile(sourcePath, 'utf8');
  const result = await transform(source, {
    charset: 'ascii',
    format: 'esm',
    legalComments: 'none',
    minify: true,
    target: 'es2018',
  });
  await fs.writeFile(destinationPath, result.code);
}

export async function prepareDevProject(source, destination) {
  const sourceRoot = path.resolve(source);
  const destinationRoot = path.resolve(destination);
  if (!isWithin(allowedDestinationRoot, destinationRoot)) {
    throw new Error(`Development output must be inside ${allowedDestinationRoot}`);
  }

  await fs.rm(destinationRoot, { recursive: true, force: true });
  await fs.mkdir(destinationRoot, { recursive: true });
  for (const entry of projectEntries) {
    const sourcePath = path.join(sourceRoot, entry);
    try {
      await copyEntry(sourcePath, path.join(destinationRoot, entry));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return destinationRoot;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , source, destination] = process.argv;
  if (!source || !destination) {
    throw new Error('Usage: node tools/prepare-dev-project.js <source> <destination>');
  }
  const watchMode = process.argv.includes('--watch');
  const skipInitial = process.argv.includes('--skip-initial');
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
