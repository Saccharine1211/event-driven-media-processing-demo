# Security model

- Both S3 buckets block all public access, use S3-managed encryption, reject non-TLS requests, and enable versioning.
- The upload URL expires after 15 minutes and is restricted to one object key and content type. The job-creation Function URL requires AWS IAM authentication.
- Lambda roles receive grants for specific tables, queues, buckets, and key prefixes. No function receives `s3:*` or `dynamodb:*`.
- The worker streams input and rejects objects over 20 MiB. It accepts only a small allowlist of media content types.
- Logs contain job IDs, state changes, and bounded errors, never file bodies or credentials.
- GitHub deployment uses OIDC and a repository variable for the role ARN; no long-lived AWS key is stored in GitHub.

This demo uses AWS-managed encryption keys to keep the example small. A regulated deployment may require customer-managed KMS keys, malware scanning, object ownership controls, VPC endpoints, stricter content inspection, audit retention, and organization-level preventive policies.
