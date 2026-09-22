import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.join(currentDirectory, '../..');

export interface MediaProcessingStackProps extends cdk.StackProps {
  stage: string;
}

export class MediaProcessingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MediaProcessingStackProps) {
    super(scope, id, props);

    const isDevelopment = props.stage === 'dev';
    const removalPolicy = isDevelopment ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN;

    const inputBucket = new s3.Bucket(this, 'InputBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy,
      autoDeleteObjects: isDevelopment,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) }],
    });

    const outputBucket = new s3.Bucket(this, 'OutputBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy,
      autoDeleteObjects: isDevelopment,
      lifecycleRules: [{ noncurrentVersionExpiration: cdk.Duration.days(30) }],
    });

    const jobsTable = new dynamodb.Table(this, 'JobsTable', {
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: !isDevelopment },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy,
    });

    const deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue', {
      fifo: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true,
    });

    const workQueue = new sqs.Queue(this, 'WorkQueue', {
      fifo: true,
      contentBasedDeduplication: false,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.seconds(180),
      retentionPeriod: cdk.Duration.days(4),
      enforceSSL: true,
      deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: 4 },
    });

    const commonFunctionProps = {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      tracing: lambda.Tracing.ACTIVE,
      bundling: { minify: true, sourceMap: true },
    } satisfies Partial<lambdaNodejs.NodejsFunctionProps>;

    const createLogGroup = (id: string) =>
      new logs.LogGroup(this, id, {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy,
      });

    const jobCreator = new lambdaNodejs.NodejsFunction(this, 'JobCreator', {
      ...commonFunctionProps,
      logGroup: createLogGroup('JobCreatorLogGroup'),
      entry: path.join(repositoryRoot, 'services/job-creator/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        JOBS_TABLE_NAME: jobsTable.tableName,
        INPUT_BUCKET_NAME: inputBucket.bucketName,
      },
    });
    const jobCreatorUrl = jobCreator.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      invokeMode: lambda.InvokeMode.BUFFERED,
    });

    const coordinator = new lambdaNodejs.NodejsFunction(this, 'Coordinator', {
      ...commonFunctionProps,
      logGroup: createLogGroup('CoordinatorLogGroup'),
      entry: path.join(repositoryRoot, 'services/coordinator/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        JOBS_TABLE_NAME: jobsTable.tableName,
        WORK_QUEUE_URL: workQueue.queueUrl,
      },
    });

    const worker = new lambdaNodejs.NodejsFunction(this, 'Worker', {
      ...commonFunctionProps,
      logGroup: createLogGroup('WorkerLogGroup'),
      entry: path.join(repositoryRoot, 'services/worker/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      environment: {
        JOBS_TABLE_NAME: jobsTable.tableName,
        OUTPUT_BUCKET_NAME: outputBucket.bucketName,
      },
    });

    const completionHandler = new lambdaNodejs.NodejsFunction(this, 'CompletionHandler', {
      ...commonFunctionProps,
      logGroup: createLogGroup('CompletionHandlerLogGroup'),
      entry: path.join(repositoryRoot, 'services/completion-handler/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
    });

    inputBucket.grantPut(jobCreator, 'uploads/*');
    jobsTable.grant(jobCreator, 'dynamodb:PutItem');

    jobsTable.grant(coordinator, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem');
    workQueue.grantSendMessages(coordinator);
    inputBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(coordinator),
      { prefix: 'uploads/' },
    );

    jobsTable.grant(worker, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    inputBucket.grantRead(worker, 'uploads/*');
    outputBucket.grantPut(worker, 'results/*');
    worker.addEventSource(
      new lambdaEventSources.SqsEventSource(workQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    jobsTable.grantStreamRead(completionHandler);
    completionHandler.addEventSource(
      new lambdaEventSources.DynamoEventSource(jobsTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 100,
        bisectBatchOnError: true,
        retryAttempts: 3,
      }),
    );
    completionHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: { StringEquals: { 'cloudwatch:namespace': 'EventDrivenMediaDemo' } },
      }),
    );

    new cloudwatch.Alarm(this, 'DeadLetterQueueAlarm', {
      metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'At least one media-processing message is waiting in the DLQ.',
    });
    new cloudwatch.Alarm(this, 'WorkerErrorsAlarm', {
      metric: worker.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'The worker Lambda reported an invocation error.',
    });

    new cdk.CfnOutput(this, 'JobCreatorFunctionUrl', { value: jobCreatorUrl.url });
    new cdk.CfnOutput(this, 'InputBucketName', { value: inputBucket.bucketName });
    new cdk.CfnOutput(this, 'OutputBucketName', { value: outputBucket.bucketName });
  }
}
