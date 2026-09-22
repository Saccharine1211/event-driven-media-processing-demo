import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import type { DynamoDBStreamEvent } from 'aws-lambda';

interface CompletionDependencies {
  recordCompletion: (jobId: string) => Promise<void>;
}

export function createHandler(deps: CompletionDependencies) {
  return async (event: DynamoDBStreamEvent): Promise<void> => {
    for (const record of event.Records) {
      if (record.eventName !== 'MODIFY') continue;
      const oldStatus = record.dynamodb?.OldImage?.status?.S;
      const newStatus = record.dynamodb?.NewImage?.status?.S;
      const jobId = record.dynamodb?.NewImage?.jobId?.S;
      if (jobId && oldStatus !== 'COMPLETED' && newStatus === 'COMPLETED') {
        await deps.recordCompletion(jobId);
      }
    }
  };
}

const cloudWatchClient = new CloudWatchClient({});

export const handler = createHandler({
  recordCompletion: async (jobId) => {
    console.info('Job completed', { jobId });
    await cloudWatchClient.send(
      new PutMetricDataCommand({
        Namespace: 'EventDrivenMediaDemo',
        MetricData: [{ MetricName: 'JobsCompleted', Unit: 'Count', Value: 1 }],
      }),
    );
  },
});
