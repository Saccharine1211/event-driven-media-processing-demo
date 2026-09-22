import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { LambdaFunctionURLEvent } from 'aws-lambda';
import {
  assertAllowedContentType,
  sanitizeFilename,
  ValidationError,
} from '../../shared/validation.js';

interface Dependencies {
  createId: () => string;
  now: () => string;
  saveJob: (item: Record<string, unknown>) => Promise<void>;
  createUploadUrl: (key: string, contentType: string) => Promise<string>;
}

interface CreateJobRequest {
  filename?: unknown;
  contentType?: unknown;
}

interface JobCreatorResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function createHandler(
  deps: Dependencies,
): (event: LambdaFunctionURLEvent) => Promise<JobCreatorResponse> {
  return async (event): Promise<JobCreatorResponse> => {
    try {
      const body = event.body ? (JSON.parse(event.body) as CreateJobRequest) : {};
      const filename = sanitizeFilename(body.filename);
      assertAllowedContentType(body.contentType);
      const jobId = deps.createId();
      const objectKey = `uploads/${jobId}/${filename}`;
      const timestamp = deps.now();

      await deps.saveJob({
        jobId,
        status: 'PENDING',
        sourceKey: objectKey,
        contentType: body.contentType,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const uploadUrl = await deps.createUploadUrl(objectKey, body.contentType);
      return {
        statusCode: 201,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId, objectKey, uploadUrl, expiresInSeconds: 900 }),
      };
    } catch (error) {
      const isClientError = error instanceof ValidationError || error instanceof SyntaxError;
      return {
        statusCode: isClientError ? 400 : 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: isClientError ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
          message: isClientError && error instanceof Error ? error.message : 'Unable to create job',
        }),
      };
    }
  };
}

const tableName = process.env.JOBS_TABLE_NAME ?? '';
const inputBucketName = process.env.INPUT_BUCKET_NAME ?? '';
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

export const handler = createHandler({
  createId: randomUUID,
  now: () => new Date().toISOString(),
  saveJob: async (item) => {
    await documentClient.send(
      new PutCommand({
        TableName: tableName,
        Item: { ...item, sourceBucket: inputBucketName },
        ConditionExpression: 'attribute_not_exists(jobId)',
      }),
    );
  },
  createUploadUrl: async (key, contentType) =>
    getSignedUrl(
      s3Client,
      new PutObjectCommand({ Bucket: inputBucketName, Key: key, ContentType: contentType }),
      { expiresIn: 900 },
    ),
});
