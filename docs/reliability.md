# Reliability and recovery

## State protection and idempotency

The job lifecycle is `PENDING → QUEUED → PROCESSING → COMPLETED`, with `FAILED` as a retryable processing state. Job IDs are UUIDs embedded in object keys. The worker reads the current item consistently and immediately acknowledges an already completed job. Results use `results/{jobId}.json`, so a retry cannot create a second logical result.

The coordinator sends before marking the job `QUEUED`. If sending fails, the `PENDING` item is still eligible for a later S3 retry. If sending succeeds and the status update fails, the worker accepts either `PENDING` or `QUEUED`. Near-term duplicate sends are collapsed by FIFO deduplication; later duplicates remain safe at the worker.

## Retry and poison-message behavior

The event source mapping returns `batchItemFailures`, so a malformed or temporarily failing message does not cause successful records in the same batch to be retried. A failed attempt records a bounded error summary, then returns that record for SQS retry. After four receives, SQS moves the record to the FIFO DLQ. An alarm fires when one or more messages are visible there.

## DLQ redrive runbook

1. Inspect the job item, CloudWatch request IDs, and message body without copying file contents into logs.
2. Fix the data or code problem and deploy the reviewed change.
3. Use the SQS console's **Start DLQ redrive** action with a conservative rate back to the source queue.
4. Watch worker errors, DLQ depth, and job state changes; stop the redrive if failures repeat.
5. For permanently invalid input, retain an incident reference and remove the message according to the chosen retention policy.

SQS redrive does not reset application state. `FAILED` jobs are deliberately eligible for processing again, while `COMPLETED` jobs are acknowledged without another read or write of the source object.
