import type { S3Event } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createHandler } from '../../services/coordinator/handler.js';
import type { JobRecord } from '../../shared/job-state.js';

const jobId = '123e4567-e89b-42d3-a456-426614174000';

function s3Event(): S3Event {
  return {
    Records: [
      {
        s3: {
          bucket: { name: 'input-bucket' },
          object: {
            key: `uploads%2F${jobId}%2Fmy+photo.png`,
            eTag: 'etag-1',
            sequencer: '001',
            size: 12,
          },
        },
      },
    ],
  } as unknown as S3Event;
}

describe('coordinator', () => {
  it('enqueues and marks a pending job as queued', async () => {
    const job: JobRecord = {
      jobId,
      status: 'PENDING',
      sourceBucket: 'input-bucket',
      sourceKey: `uploads/${jobId}/my photo.png`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const markQueued = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler({
      now: () => '2026-01-01T00:00:00.000Z',
      ensureJob: vi.fn().mockResolvedValue(undefined),
      getJob: vi.fn().mockResolvedValue(job),
      enqueue,
      markQueued,
    });

    await handler(s3Event());

    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({ jobId, schemaVersion: 1 });
    expect(enqueue.mock.calls[0]?.[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(markQueued).toHaveBeenCalledWith(jobId, '2026-01-01T00:00:00.000Z');
  });

  it('does not dispatch an already completed duplicate event', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler({
      now: () => '2026-01-01T00:00:00.000Z',
      ensureJob: vi.fn().mockResolvedValue(undefined),
      getJob: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
      enqueue,
      markQueued: vi.fn().mockResolvedValue(undefined),
    });

    await handler(s3Event());

    expect(enqueue).not.toHaveBeenCalled();
  });
});
