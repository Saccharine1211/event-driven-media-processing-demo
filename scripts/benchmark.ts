import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import * as process from 'node:process';

interface Options {
  fileSizeMb: number;
  iterations: number;
  memoryMb: number | null;
}

function readNumberFlag(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  const raw = index >= 0 ? process.argv[index + 1] : undefined;
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function options(): Options {
  const memoryIndex = process.argv.indexOf('--memory-mb');
  return {
    fileSizeMb: readNumberFlag('--file-size-mb', 1),
    iterations: Math.floor(readNumberFlag('--iterations', 20)),
    memoryMb: memoryIndex >= 0 ? readNumberFlag('--memory-mb', 0) : null,
  };
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

const config = options();
const payload = randomBytes(Math.floor(config.fileSizeMb * 1024 * 1024));
const durationsMs: number[] = [];

for (let iteration = 0; iteration < config.iterations; iteration += 1) {
  const startedAt = performance.now();
  createHash('sha256').update(payload).digest('hex');
  durationsMs.push(performance.now() - startedAt);
}

const averageDurationMs = durationsMs.reduce((sum, value) => sum + value, 0) / durationsMs.length;
const report = {
  measuredAt: new Date().toISOString(),
  environment: 'local-node-process',
  nodeVersion: process.version,
  architecture: process.arch,
  fileSizeBytes: payload.byteLength,
  iterations: config.iterations,
  configuredLambdaMemoryMb: config.memoryMb,
  averageDurationMs,
  p95DurationMs: percentile(durationsMs, 0.95),
  estimatedCostPer1000: null,
  disclaimer:
    'Local timing is not a Lambda benchmark. Run the deployed workload and apply current regional AWS pricing before estimating cost.',
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
