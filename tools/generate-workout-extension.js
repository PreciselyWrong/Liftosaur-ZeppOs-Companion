import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkoutExtensionManifest } from '../shared/workout-extension-manifest.js';

export function parseWorkoutExtensionAppId(appIdInput = process.env.ZEPP_WORKOUT_EXTENSION_APP_ID) {
  if (appIdInput === undefined || appIdInput === null || appIdInput === '') {
    throw new Error('Missing or invalid Workout Extension App ID: ZEPP_WORKOUT_EXTENSION_APP_ID must be set');
  }

  const numericId = typeof appIdInput === 'number' ? appIdInput : Number(appIdInput);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error('Missing or invalid Workout Extension App ID: must be a positive integer');
  }

  return numericId;
}

const GENERATED_PATHS = [
  'app.json',
  'app.js',
  'package.json',
  'data-widget',
  'app-side',
  'setting',
  'shared',
  'assets',
  'dist',
];

function cleanGeneratedTarget(targetDir) {
  if (!fs.existsSync(targetDir)) return;
  const entries = fs.readdirSync(targetDir);
  if (entries.length === 0) return;

  let isGeneratedWorkoutProject = false;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'app.json'), 'utf8'));
    isGeneratedWorkoutProject = manifest?.app?.extType === 'workout';
  } catch (err) {
    isGeneratedWorkoutProject = false;
  }

  if (!isGeneratedWorkoutProject) {
    throw new Error(`Target directory is not a generated Workout Extension project: ${targetDir}`);
  }

  for (const generatedPath of GENERATED_PATHS) {
    fs.rmSync(path.join(targetDir, generatedPath), { recursive: true, force: true });
  }
}

export function generateWorkoutExtensionProject({
  appId = process.env.ZEPP_WORKOUT_EXTENSION_APP_ID,
  targetDir = null,
  rootDir = null,
} = {}) {
  const parsedAppId = parseWorkoutExtensionAppId(appId);
  const resolvedRootDir = rootDir || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const resolvedTargetDir = targetDir || path.join(resolvedRootDir, 'build', 'workout-extension');

  const rootPkg = JSON.parse(fs.readFileSync(path.join(resolvedRootDir, 'package.json'), 'utf8'));
  const rootAppJson = JSON.parse(fs.readFileSync(path.join(resolvedRootDir, 'app.json'), 'utf8'));

  const version = rootPkg.version;
  const versionCode = rootAppJson.app?.version?.code;

  const manifest = createWorkoutExtensionManifest({
    appId: parsedAppId,
    version,
    versionCode,
  });

  cleanGeneratedTarget(resolvedTargetDir);
  fs.mkdirSync(resolvedTargetDir, { recursive: true });

  fs.writeFileSync(
    path.join(resolvedTargetDir, 'app.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );

  const appJsContent = `import { BaseApp } from '@zeppos/zml/base-app';

App(
  BaseApp({
    onCreate(options) {
      console.log('[lifto-ext] app onCreate');
    },
    onDestroy(options) {
      console.log('[lifto-ext] app onDestroy');
    },
  })
);
`;
  fs.writeFileSync(path.join(resolvedTargetDir, 'app.js'), appJsContent, 'utf8');

  const extPkg = {
    name: 'liftosaur-zepp-os-workout-extension',
    version,
    releaseStage: rootPkg.releaseStage || 'beta',
    description: 'Liftosaur Strength Training Workout Extension for Zepp OS',
    main: 'app.js',
    license: rootPkg.license || 'MIT',
    devDependencies: rootPkg.devDependencies || {
      '@zeppos/device-types': '^3.0.0',
    },
    type: 'module',
    dependencies: rootPkg.dependencies || {
      '@zeppos/zml': '^0.0.43',
    },
  };
  fs.writeFileSync(
    path.join(resolvedTargetDir, 'package.json'),
    JSON.stringify(extPkg, null, 2) + '\n',
    'utf8',
  );

  function copyDirRecursive(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return;
    fs.mkdirSync(destDir, { recursive: true });
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        copyDirRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDirRecursive(path.join(resolvedRootDir, 'data-widget'), path.join(resolvedTargetDir, 'data-widget'));
  copyDirRecursive(path.join(resolvedRootDir, 'app-side'), path.join(resolvedTargetDir, 'app-side'));
  copyDirRecursive(path.join(resolvedRootDir, 'setting'), path.join(resolvedTargetDir, 'setting'));
  copyDirRecursive(path.join(resolvedRootDir, 'shared'), path.join(resolvedTargetDir, 'shared'));
  copyDirRecursive(path.join(resolvedRootDir, 'assets'), path.join(resolvedTargetDir, 'assets'));

  const requiredPaths = [
    'app.json',
    'app.js',
    'package.json',
    'data-widget/common/index.js',
    'app-side/index.js',
    'setting/index.js',
    'shared/protocol.js',
    'assets/common.r/icon.png',
    'assets/square.s/icon.png',
  ];
  for (const requiredPath of requiredPaths) {
    if (!fs.existsSync(path.join(resolvedTargetDir, requiredPath))) {
      throw new Error(`Generated Workout Extension is missing ${requiredPath}`);
    }
  }

  return {
    appId: parsedAppId,
    targetDir: resolvedTargetDir,
    manifest,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const targetDirArg = process.argv[2] || undefined;
    const result = generateWorkoutExtensionProject({ targetDir: targetDirArg });
    console.log(`[lifto-ext] generated workout extension project in ${result.targetDir}`);
  } catch (err) {
    console.error(`[lifto-ext] generation failed: ${err.message}`);
    process.exit(1);
  }
}
