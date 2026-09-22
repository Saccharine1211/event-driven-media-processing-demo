import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { S3Event, S3EventRecord } from 'aws-lambda';
import { createIdempotencyKey } from '../../shared/idempotency.js';
import type { JobRecord, WorkMessage } from '../../shared/job-state.js';
import { parseJobIdFromObjectKey } from '../../shared/validation.js';

interface CoordinatorDependencies {
  now: () => string;
  ensureJob: (job: JobRecord) => Promise<void>;
  getJob: (jobId: string) => Promise<JobRecord | undefined>;
  enqueue: (message: WorkMessage, deduplicationId: string) => Promise<void>;
  markQueued: (jobId: string, timestamp: string) => Promise<void>;
}

function decodeObjectKey(key: string): string {
  return decodeURIComponent(key.replace(/\+/g, ' '));
}

export function createHandler(deps: CoordinatorDependencies) {
  return async (event: S3Event): Promise<void> => {
    for (const record of event.Records) {
      await coordinateRecord(record, deps);
    }
  };
}

async function coordinateRecord(
  record: S3EventRecord,
  deps: CoordinatorDependencies,
): Promise<void> {
  const sourceBucket = record.s3.bucket.name;
  const sourceKey = decodeObjectKey(record.s3.object.key);
  const jobId = parseJobIdFromObjectKey(sourceKey);
  const timestamp = deps.now();

  await deps.ensureJob({
    jobId,
    status: 'PENDING',
    sourceBucket,
    sourceKey,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const job = await deps.getJob(jobId);
  if (job?.status !== 'PENDING') {
    return;
  }

  const message: WorkMessage = {
    schemaVersion: 1,
    jobId,
    sourceBucket,
    sourceKey,
    ...(job.contentType ? { contentType: job.contentType } : {}),
  };
  const deduplicationId = createIdempotencyKey([
    sourceBucket,
    sourceKey,
    record.s3.object.versionId ?? record.s3.object.eTag ?? record.s3.object.sequencer,
  ]);

  await deps.enqueue(message, deduplicationId);
  await deps.markQueued(jobId, timestamp);
}

const tableName = process.env.JOBS_TABLE_NAME ?? '';
const queueUrl = process.env.WORK_QUEUE_URL ?? '';
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqsClient = new SQSClient({});

export const handler = createHandler({
  now: () => new Date().toISOString(),
  ensureJob: async (job) => {
    try {
      await documentClient.send(
        new PutCommand({
          TableName: tableName,
          Item: job,
          ConditionExpression: 'attribute_not_exists(jobId)',
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') {
        throw error;
      }
    }
  },
  getJob: async (jobId) => {
    const response = await documentClient.send(
      new GetCommand({ TableName: tableName, Key: { jobId }, ConsistentRead: true }),
    );
    return response.Item as JobRecord | undefined;
  },
  enqueue: async (message, deduplicationId) => {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
        MessageGroupId: message.jobId,
        MessageDeduplicationId: deduplicationId,
      }),
    );
  },
  markQueued: async (jobId, timestamp) => {
    try {
      await documentClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { jobId },
          UpdateExpression: 'SET #status = :queued, updatedAt = :updatedAt',
          ConditionExpression: '#status = :pending',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':pending': 'PENDING',
            ':queued': 'QUEUED',
            ':updatedAt': timestamp,
          },
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') {
        throw error;
      }
    }
  },
});
