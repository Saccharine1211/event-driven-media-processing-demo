import type { WorkMessage } from './job-state.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export class ValidationError extends Error {
  readonly code = 'INVALID_INPUT';
}

export function assertUuid(value: unknown, fieldName = 'jobId'): asserts value is string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ValidationError(`${fieldName} must be a valid UUID`);
  }
}

export function parseJobIdFromObjectKey(key: string): string {
  const [prefix, jobId] = key.split('/');
  if (prefix !== 'uploads' || !jobId) {
    throw new ValidationError('Object key must match uploads/{jobId}/{filename}');
  }
  assertUuid(jobId);
  return jobId;
}

export function sanitizeFilename(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('filename must be a string');
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 180 || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new ValidationError('filename must be a non-empty basename up to 180 characters');
  }
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function assertAllowedContentType(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SAFE_CONTENT_TYPES.has(value)) {
    throw new ValidationError('contentType is not allowed');
  }
}

export function parseWorkMessage(body: string): WorkMessage {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new ValidationError('Message body must be valid JSON');
  }

  if (!value || typeof value !== 'object') {
    throw new ValidationError('Message body must be an object');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) {
    throw new ValidationError('Unsupported schemaVersion');
  }
  assertUuid(candidate.jobId);
  if (typeof candidate.sourceBucket !== 'string' || !candidate.sourceBucket) {
    throw new ValidationError('sourceBucket is required');
  }
  if (typeof candidate.sourceKey !== 'string' || !candidate.sourceKey.startsWith('uploads/')) {
    throw new ValidationError('sourceKey must use the uploads/ prefix');
  }
  if (candidate.contentType !== undefined) {
    assertAllowedContentType(candidate.contentType);
  }

  return {
    schemaVersion: 1,
    jobId: candidate.jobId,
    sourceBucket: candidate.sourceBucket,
    sourceKey: candidate.sourceKey,
    ...(candidate.contentType ? { contentType: candidate.contentType } : {}),
  };
}
