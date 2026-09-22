import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { MediaProcessingStack } from '../lib/media-processing-stack.js';

function synthesizeTemplate(): Template {
  const app = new cdk.App();
  const stack = new MediaProcessingStack(app, 'TestStack', { stage: 'test' });
  return Template.fromStack(stack);
}

describe('MediaProcessingStack', () => {
  it('creates the event-driven resources and a FIFO DLQ policy', () => {
    const template = synthesizeTemplate();
    template.resourceCountIs('AWS::S3::Bucket', 2);
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.resourcePropertiesCountIs('AWS::Lambda::Function', { Runtime: 'nodejs24.x' }, 4);
    template.resourceCountIs('AWS::SQS::Queue', 2);
    template.hasResourceProperties('AWS::SQS::Queue', {
      FifoQueue: true,
      RedrivePolicy: {
        maxReceiveCount: 4,
        deadLetterTargetArn: Match.anyValue(),
      },
    });
  });

  it('blocks public S3 access and requires TLS', () => {
    const template = synthesizeTemplate();
    template.allResourcesProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: Match.anyValue(),
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('does not grant wildcard S3 or DynamoDB actions', () => {
    const iamPolicies = JSON.stringify(synthesizeTemplate().findResources('AWS::IAM::Policy'));
    expect(iamPolicies).not.toContain('s3:*');
    expect(iamPolicies).not.toContain('dynamodb:*');
  });
});
