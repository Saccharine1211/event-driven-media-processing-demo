#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MediaProcessingStack } from '../lib/media-processing-stack.js';

const app = new cdk.App();
const stageContext: unknown = app.node.tryGetContext('stage');
const stage = typeof stageContext === 'string' ? stageContext : 'dev';

new MediaProcessingStack(app, `EventDrivenMediaProcessing-${stage}`, {
  stage,
  env: {
    ...(process.env.CDK_DEFAULT_ACCOUNT ? { account: process.env.CDK_DEFAULT_ACCOUNT } : {}),
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-2',
  },
  description: 'Clean-room event-driven checksum and metadata processing demo',
});
