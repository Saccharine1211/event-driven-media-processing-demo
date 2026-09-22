import { createHash } from 'node:crypto';

export function createIdempotencyKey(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

export function resultKeyFor(jobId: string): string {
  return `results/${jobId}.json`;
}
