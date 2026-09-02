import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseWorkoutExtensionAppId,
  generateWorkoutExtensionProject,
} from './generate-workout-extension.js';

export const SUPPORTED_PRODUCTS = ['companion', 'workout', 'all'];

export function normalizeProduct(product) {
  if (typeof product !== 'string') {
    throw new Error(`Invalid product: ${product}. Must be one of: ${SUPPORTED_PRODUCTS.join(', ')}`);
  }

  const normalized = product.trim().toLowerCase();
  if (!SUPPORTED_PRODUCTS.includes(normalized)) {
    throw new Error(`Invalid product: "${product}". Must be one of: ${SUPPORTED_PRODUCTS.join(', ')}`);
  }

  return normalized;
}

export function planBuild(productInput, {
  appId = undefined,
  rootDir = null,
  targetDir = null,
  env = process.env,
} = {}) {
  const product = normalizeProduct(productInput);
  const resolvedRootDir = rootDir || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const resolvedTargetDir = targetDir || path.join(resolvedRootDir, 'build', 'workout-extension');
  const resolvedAppId = appId !== undefined ? appId : env?.ZEPP_WORKOUT_EXTENSION_APP_ID;

  let parsedAppId = null;
  if (product === 'workout' || product === 'all') {
    parsedAppId = parseWorkoutExtensionAppId(resolvedAppId);
  }

  const steps = [];

  if (product === 'companion' || product === 'all') {
    steps.push({
      product: 'companion',
      command: 'zeus',
      args: ['build'],
      cwd: resolvedRootDir,
      generate: false,
    });
  }

  if (product === 'workout' || product === 'all') {
    steps.push({
      product: 'workout',
      command: 'zeus',
      args: ['build'],
      cwd: resolvedTargetDir,
      generate: true,
      appId: parsedAppId,
      rootDir: resolvedRootDir,
      targetDir: resolvedTargetDir,
    });
  }

  return {
    product,
    rootDir: resolvedRootDir,
    targetDir: resolvedTargetDir,
    steps,
  };
}

export function executeBuild(productInput, {
  appId = undefined,
  rootDir = null,
  targetDir = null,
  env = process.env,
  spawn = spawnSync,
  generator = generateWorkoutExtensionProject,
  stdio = 'inherit',
  spawnOptions = {},
  platform = process.platform,
} = {}) {
  const plan = planBuild(productInput, { appId, rootDir, targetDir, env });

  for (const step of plan.steps) {
    if (step.generate) {
      generator({
        appId: step.appId,
        targetDir: step.targetDir,
        rootDir: step.rootDir,
      });
    }

    const usesWindowsShim = platform === 'win32';
    const command = usesWindowsShim ? `${step.command} ${step.args.join(' ')}` : step.command;
    const args = usesWindowsShim ? [] : step.args;
    const options = {
      cwd: step.cwd,
      stdio,
      shell: usesWindowsShim,
      ...spawnOptions,
    };

    const result = spawn(command, args, options);

    if (result.error) {
      throw result.error;
    }

    const status = result.status;
    if (status !== 0) {
      const exitDescription = Number.isInteger(status) ? `exit code ${status}` : 'no exit code';
      const error = new Error(`Build failed for ${step.product} with ${exitDescription}`);
      error.status = Number.isInteger(status) ? status : 1;
      error.product = step.product;
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
  const product = args[0];
  try {
    const result = executeBuild(product, options);
    return result;
  } catch (err) {
    console.error(`[build] ${err.message}`);
    exit(typeof err.status === 'number' && err.status !== 0 ? err.status : 1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
