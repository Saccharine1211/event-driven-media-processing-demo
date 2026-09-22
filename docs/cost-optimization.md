# Cost considerations

The design is serverless and has no continuously running compute. Main cost drivers are Lambda requests and GB-seconds, S3 storage and requests, FIFO SQS requests, DynamoDB on-demand reads/writes, CloudWatch logs/metrics, and X-Ray tracing.

Lambda allocates CPU in proportion to memory. More memory can lower duration enough to reduce both latency and total GB-seconds, but the result depends on file size, runtime, region, and cold starts. Do not assume the smallest memory setting is cheapest.

Use the deployed synthetic benchmark across at least 256, 512, 1024, and 1769 MB. For each configuration, record billed duration and calculate:

```text
compute cost per 1,000 = memory in GB × average billed seconds × 1,000 × regional GB-second price
request cost per 1,000 = 1,000 × regional per-request price
```

Add S3, SQS, DynamoDB, logs, and tracing using current prices for the deployed region. Free tier, architecture-specific discounts, and tiered pricing must be stated separately. Development stacks use removable resources; non-development tables and buckets retain data by default.
