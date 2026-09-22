import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { resultKeyFor } from '../../shared/idempotency.js';
import type { JobRecord, ProcessingResult, WorkMessage } from '../../shared/job-state.js';
import { parseWorkMessage, ValidationError } from '../../shared/validation.js';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

interface SourceObject {
  body: AsyncIterable<Uint8Array>;
  contentLength?: number;
  contentType?: string;
}

interface WorkerDependencies {
  now: () => string;
  getJob: (jobId: string) => Promise<JobRecord | undefined>;
  markProcessing: (jobId: string, timestamp: string) => Promise<void>;
  getSource: (message: WorkMessage) => Promise<SourceObject>;
  putResult: (key: string, result: ProcessingResult) => Promise<void>;
  markCompleted: (
    jobId: string,
    result: ProcessingResult,
    resultKey: string,
    timestamp: string,
  ) => Promise<void>;
  markFailed: (jobId: string, error: Error, timestamp: string) => Promise<void>;
}

export function createHandler(deps: WorkerDependencies) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: { itemIdentifier: string }[] = [];
    for (const record of event.Records) {
      try {
        await processRecord(record, deps);
      } catch {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

async function processRecord(record: SQSRecord, deps: WorkerDependencies): Promise<void> {
  const message = parseWorkMessage(record.body);

  const existing = await deps.getJob(message.jobId);
  if (existing?.status === 'COMPLETED') {
    return;
  }

  const timestamp = deps.now();
  try {
    await deps.markProcessing(message.jobId, timestamp);
    const source = await deps.getSource(message);
    if (source.contentLength !== undefined && source.contentLength > MAX_FILE_SIZE_BYTES) {
      throw new ValidationError('Source object exceeds the 20 MiB limit');
    }
    const { checksumSha256, sizeBytes } = await checksumStream(source.body);
    const contentType = source.contentType ?? message.contentType ?? 'application/octet-stream';
    const result: ProcessingResult = {
      schemaVersion: 1,
      jobId: message.jobId,
      source: { bucket: message.sourceBucket, key: message.sourceKey },
      checksumSha256,
      sizeBytes,
      contentType,
    };
    const resultKey = resultKeyFor(message.jobId);
    await deps.putResult(resultKey, result);
    await deps.markCompleted(message.jobId, result, resultKey, deps.now());
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error('Unknown processing error');
    await deps.markFailed(message.jobId, normalized, deps.now());
    throw normalized;
  }
}

async function checksumStream(
  body: AsyncIterable<Uint8Array>,
): Promise<{ checksumSha256: string; sizeBytes: number }> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of body) {
    sizeBytes += chunk.byteLength;
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      throw new ValidationError('Source object exceeds the 20 MiB limit');
    }
    hash.update(chunk);
  }
  return { checksumSha256: hash.digest('hex'), sizeBytes };
}

const tableName = process.env.JOBS_TABLE_NAME ?? '';
const outputBucketName = process.env.OUTPUT_BUCKET_NAME ?? '';
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

export const handler = createHandler({
  now: () => new Date().toISOString(),
  getJob: async (jobId) => {
    const response = await documentClient.send(
      new GetCommand({ TableName: tableName, Key: { jobId }, ConsistentRead: true }),
    );
    return response.Item as JobRecord | undefined;
  },
  markProcessing: async (jobId, timestamp) => {
    await documentClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { jobId },
        UpdateExpression:
          'SET #status = :processing, updatedAt = :updatedAt REMOVE errorCode, errorMessage',
        ConditionExpression:
          'attribute_exists(jobId) AND (#status = :pending OR #status = :queued OR #status = :failed OR #status = :processing)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':pending': 'PENDING',
          ':queued': 'QUEUED',
          ':failed': 'FAILED',
          ':processing': 'PROCESSING',
          ':updatedAt': timestamp,
        },
      }),
    );
  },
  getSource: async (message) => {
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: message.sourceBucket, Key: message.sourceKey }),
    );
    if (!response.Body) {
      throw new Error('Source object body is empty');
    }
    return {
      body: response.Body as Readable,
      ...(response.ContentLength !== undefined ? { contentLength: response.ContentLength } : {}),
      ...(response.ContentType ? { contentType: response.ContentType } : {}),
    };
  },
  putResult: async (key, result) => {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: outputBucketName,
        Key: key,
        Body: JSON.stringify(result, null, 2),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
      }),
    );
  },
  markCompleted: async (jobId, result, resultKey, timestamp) => {
    await documentClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { jobId },
        UpdateExpression:
          'SET #status = :completed, updatedAt = :updatedAt, completedAt = :completedAt, resultKey = :resultKey, checksumSha256 = :checksum, sizeBytes = :sizeBytes, contentType = :contentType',
        ConditionExpression: '#status <> :completed',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':completed': 'COMPLETED',
          ':updatedAt': timestamp,
          ':completedAt': timestamp,
          ':resultKey': resultKey,
          ':checksum': result.checksumSha256,
          ':sizeBytes': result.sizeBytes,
          ':contentType': result.contentType,
        },
      }),
    );
  },
  markFailed: async (jobId, error, timestamp) => {
    try {
      await documentClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { jobId },
          UpdateExpression:
            'SET #status = :failed, updatedAt = :updatedAt, errorCode = :errorCode, errorMessage = :errorMessage',
          ConditionExpression: '#status <> :completed',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':completed': 'COMPLETED',
            ':failed': 'FAILED',
            ':updatedAt': timestamp,
            ':errorCode': error instanceof ValidationError ? error.code : 'PROCESSING_ERROR',
            ':errorMessage': error.message.slice(0, 500),
          },
        }),
      );
    } catch (markError) {
      if ((markError as { name?: string }).name !== 'ConditionalCheckFailedException') {
        console.error('Unable to record failure state', { jobId });
      }
    }
  },
});
