import { Readable } from 'node:stream';
import type { SQSEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createHandler } from '../../services/worker/handler.js';

const jobId = '123e4567-e89b-42d3-a456-426614174000';
const sourceKey = `uploads/${jobId}/photo.png`;

function event(body: string, messageId = 'message-1'): SQSEvent {
  return {
    Records: [{ messageId, body }],
  } as unknown as SQSEvent;
}

function validBody(): string {
  return JSON.stringify({
    schemaVersion: 1,
    jobId,
    sourceBucket: 'input-bucket',
    sourceKey,
    contentType: 'image/png',
  });
}

function dependencies() {
  return {
    now: () => '2026-01-01T00:00:00.000Z',
    getJob: vi.fn().mockResolvedValue({ status: 'QUEUED' }),
    markProcessing: vi.fn().mockResolvedValue(undefined),
    getSource: vi.fn().mockResolvedValue({
      body: Readable.from([Buffer.from('hello')]),
      contentLength: 5,
      contentType: 'image/png',
    }),
    putResult: vi.fn().mockResolvedValue(undefined),
    markCompleted: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
}

describe('worker', () => {
  it('writes deterministic metadata and completes a normal message', async () => {
    const deps = dependencies();
    const handler = createHandler(deps);

    const response = await handler(event(validBody()));

    expect(response.batchItemFailures).toEqual([]);
    expect(deps.putResult).toHaveBeenCalledWith(
      `results/${jobId}.json`,
      expect.objectContaining({
        jobId,
        sizeBytes: 5,
        checksumSha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      }),
    );
    expect(deps.markCompleted).toHaveBeenCalledOnce();
  });

  it('acknowledges an already completed job without processing it again', async () => {
    const deps = dependencies();
    deps.getJob.mockResolvedValue({ status: 'COMPLETED' });
    const response = await createHandler(deps)(event(validBody()));

    expect(response.batchItemFailures).toEqual([]);
    expect(deps.getSource).not.toHaveBeenCalled();
    expect(deps.putResult).not.toHaveBeenCalled();
  });

  it('returns only malformed records as batch failures', async () => {
    const deps = dependencies();
    const response = await createHandler(deps)({
      Records: [event(validBody(), 'good').Records[0]!, event('{bad-json', 'bad').Records[0]!],
    });

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: 'bad' }]);
    expect(deps.markCompleted).toHaveBeenCalledOnce();
  });

  it('records a retryable failure and returns the item for SQS retry', async () => {
    const deps = dependencies();
    deps.getSource.mockRejectedValue(new Error('temporary S3 failure'));
    const response = await createHandler(deps)(event(validBody()));

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: 'message-1' }]);
    expect(deps.markFailed).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ message: 'temporary S3 failure' }),
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('treats a conditional state conflict as a retryable failure', async () => {
    const deps = dependencies();
    deps.markProcessing.mockRejectedValue(
      Object.assign(new Error('state changed'), { name: 'ConditionalCheckFailedException' }),
    );
    const response = await createHandler(deps)(event(validBody()));

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: 'message-1' }]);
    expect(deps.markFailed).toHaveBeenCalledOnce();
  });
});
