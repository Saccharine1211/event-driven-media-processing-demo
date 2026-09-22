import type { LambdaFunctionURLEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createHandler } from '../../services/job-creator/handler.js';

const jobId = '123e4567-e89b-42d3-a456-426614174000';

describe('job creator', () => {
  it('creates a pending job and returns a presigned upload URL', async () => {
    const saveJob = vi.fn().mockResolvedValue(undefined);
    const createUploadUrl = vi.fn().mockResolvedValue('https://example.invalid/upload');
    const handler = createHandler({
      createId: () => jobId,
      now: () => '2026-01-01T00:00:00.000Z',
      saveJob,
      createUploadUrl,
    });

    const response = await handler({
      body: JSON.stringify({ filename: 'photo.png', contentType: 'image/png' }),
    } as LambdaFunctionURLEvent);

    expect(response.statusCode).toBe(201);
    expect(saveJob).toHaveBeenCalledWith(expect.objectContaining({ jobId, status: 'PENDING' }));
    expect(createUploadUrl).toHaveBeenCalledWith(`uploads/${jobId}/photo.png`, 'image/png');
  });

  it('returns 400 for unsupported media types', async () => {
    const handler = createHandler({
      createId: () => jobId,
      now: () => '2026-01-01T00:00:00.000Z',
      saveJob: vi.fn(),
      createUploadUrl: vi.fn(),
    });
    const response = await handler({
      body: JSON.stringify({ filename: 'payload.exe', contentType: 'application/x-msdownload' }),
    } as LambdaFunctionURLEvent);

    expect(response.statusCode).toBe(400);
  });
});
