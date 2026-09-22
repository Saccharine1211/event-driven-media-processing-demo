import { describe, expect, it, vi } from 'vitest';
import { createHandler } from '../../services/completion-handler/handler.js';

describe('completion handler', () => {
  it('emits once only when a job enters COMPLETED', async () => {
    const recordCompletion = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler({ recordCompletion });
    await handler({
      Records: [
        {
          eventName: 'MODIFY',
          dynamodb: {
            OldImage: { status: { S: 'PROCESSING' } },
            NewImage: { jobId: { S: 'job-1' }, status: { S: 'COMPLETED' } },
          },
        },
        {
          eventName: 'MODIFY',
          dynamodb: {
            OldImage: { status: { S: 'COMPLETED' } },
            NewImage: { jobId: { S: 'job-1' }, status: { S: 'COMPLETED' } },
          },
        },
      ],
    });

    expect(recordCompletion).toHaveBeenCalledOnce();
    expect(recordCompletion).toHaveBeenCalledWith('job-1');
  });
});
