import { describe, expect, it } from 'vitest';
import {
  parseJobIdFromObjectKey,
  parseWorkMessage,
  sanitizeFilename,
} from '../../shared/validation.js';

const jobId = '123e4567-e89b-42d3-a456-426614174000';

describe('validation', () => {
  it('parses a valid work message', () => {
    expect(
      parseWorkMessage(
        JSON.stringify({
          schemaVersion: 1,
          jobId,
          sourceBucket: 'input-bucket',
          sourceKey: `uploads/${jobId}/photo.png`,
          contentType: 'image/png',
        }),
      ),
    ).toMatchObject({ jobId, contentType: 'image/png' });
  });

  it('rejects malformed messages', () => {
    expect(() => parseWorkMessage('{not-json')).toThrow('valid JSON');
    expect(() => parseWorkMessage(JSON.stringify({ schemaVersion: 2 }))).toThrow(
      'Unsupported schemaVersion',
    );
  });

  it('accepts only the documented object-key layout', () => {
    expect(parseJobIdFromObjectKey(`uploads/${jobId}/image.jpg`)).toBe(jobId);
    expect(() => parseJobIdFromObjectKey(`private/${jobId}/image.jpg`)).toThrow('uploads');
  });

  it('sanitizes safe basename characters', () => {
    expect(sanitizeFilename('my photo (1).png')).toBe('my_photo__1_.png');
    expect(() => sanitizeFilename('../secret')).toThrow('basename');
  });
});
