import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseWorkoutExtensionAppId,
  generateWorkoutExtensionProject,
} from './generate-workout-extension.js';

export const SUPPORTED_PREVIEW_PRODUCTS = ['companion', 'workout'];

export const DEFAULT_PREVIEW_OUTPUTS = {
  companion: 'docs/test-build-qr.png',
  workout: 'docs/workout-extension-preview-qr.png',
};

export const DEFAULT_PREVIEW_SCALE = 10;

export function normalizePreviewProduct(product) {
  if (typeof product !== 'string') {
    throw new Error(`Invalid product: ${product}. Must be one of: ${SUPPORTED_PREVIEW_PRODUCTS.join(', ')}`);
  }

  const normalized = product.trim().toLowerCase();
  if (!SUPPORTED_PREVIEW_PRODUCTS.includes(normalized)) {
    throw new Error(`Invalid product: "${product}". Must be one of: ${SUPPORTED_PREVIEW_PRODUCTS.join(', ')}`);
  }

  return normalized;
}

export function planPreview(productInput, {
  appId = undefined,
  rootDir = null,
  targetDir = null,
  outPath = null,
  scale = DEFAULT_PREVIEW_SCALE,
  env = process.env,
  builderScript = null,
  execPath = process.execPath,
} = {}) {
  const product = normalizePreviewProduct(productInput);
  const resolvedRootDir = rootDir || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const resolvedTargetDir = targetDir || path.join(resolvedRootDir, 'build', 'workout-extension');
  const resolvedBuilderScript = builderScript || path.join(resolvedRootDir, 'tools', 'build-preview.mjs');
  const resolvedScale = Number(scale);
  if (!Number.isFinite(resolvedScale) || resolvedScale <= 0) {
    throw new Error('Preview scale must be a positive number');
  }

  const defaultRelativeOut = DEFAULT_PREVIEW_OUTPUTS[product];
  const resolvedOutPath = outPath
    ? (path.isAbsolute(outPath) ? outPath : path.resolve(resolvedRootDir, outPath))
    : path.join(resolvedRootDir, defaultRelativeOut);

  let parsedAppId = null;
  if (product === 'workout') {
    const resolvedAppId = appId !== undefined ? appId : env?.ZEPP_WORKOUT_EXTENSION_APP_ID;
    parsedAppId = parseWorkoutExtensionAppId(resolvedAppId);
  }

  const steps = [];
  if (product === 'companion') {
    steps.push({
      product: 'companion',
      command: execPath,
      args: [resolvedBuilderScript, resolvedOutPath, String(resolvedScale)],
      cwd: resolvedRootDir,
      generate: false,
      outPath: resolvedOutPath,
      scale: resolvedScale,
    });
  } else if (product === 'workout') {
    steps.push({
      product: 'workout',
      command: execPath,
      args: [resolvedBuilderScript, resolvedOutPath, String(resolvedScale)],
      cwd: resolvedTargetDir,
      generate: true,
      appId: parsedAppId,
      rootDir: resolvedRootDir,
      targetDir: resolvedTargetDir,
      outPath: resolvedOutPath,
      scale: resolvedScale,
    });
  }

  return {
    product,
    rootDir: resolvedRootDir,
    targetDir: resolvedTargetDir,
    steps,
  };
}

export function executePreview(productInput, {
  appId = undefined,
  rootDir = null,
  targetDir = null,
  outPath = null,
  scale = DEFAULT_PREVIEW_SCALE,
  env = process.env,
  builderScript = null,
  execPath = process.execPath,
  spawn = spawnSync,
  generator = generateWorkoutExtensionProject,
  stdio = 'inherit',
  spawnOptions = {},
} = {}) {
  const plan = planPreview(productInput, {
    appId,
    rootDir,
    targetDir,
    outPath,
    scale,
    env,
    builderScript,
    execPath,
  });

  for (const step of plan.steps) {
    if (step.generate) {
      generator({
        appId: step.appId,
        targetDir: step.targetDir,
        rootDir: step.rootDir,
      });
    }

    const options = {
      cwd: step.cwd,
      stdio,
      shell: false,
      ...spawnOptions,
    };

    const result = spawn(step.command, step.args, options);

    if (result.error) {
      throw result.error;
    }

    const status = result.status;
    if (status !== 0) {
      const exitDescription = Number.isInteger(status)
        ? `exit code ${status}`
        : (result.signal ? `signal ${result.signal}` : 'no exit code');
      const error = new Error(`Preview failed for ${step.product} with ${exitDescription}`);
      error.status = Number.isInteger(status) ? status : 1;
      error.product = step.product;
      if (result.signal) error.signal = result.signal;
      throw error;
    }
  }

  return {
    product: plan.product,
    plan,
    completed: true,
  };
}

export function main(args = process.argv.slice(2), {
  exit = process.exit,
  ...options
} = {}) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node tools/preview-targets.js <companion|workout> [out-path] [scale]

Orchestrate Zepp preview QR generation for Lifto Companion or Lifto Workout.`);
    return;
  }

  const product = args[0];
  const outPath = args[1] || undefined;
  const scale = args[2] ? Number(args[2]) : undefined;

  try {
    const result = executePreview(product, {
      ...options,
      ...(outPath !== undefined ? { outPath } : {}),
      ...(scale !== undefined ? { scale } : {}),
    });
    return result;
  } catch (err) {
    console.error(`[preview] ${err.message}`);
    exit(typeof err.status === 'number' && err.status !== 0 ? err.status : 1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
