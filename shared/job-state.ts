export const JOB_STATUSES = ['PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface JobRecord {
  jobId: string;
  status: JobStatus;
  sourceBucket: string;
  sourceKey: string;
  contentType?: string;
  createdAt: string;
  updatedAt: string;
  resultKey?: string;
  checksumSha256?: string;
  sizeBytes?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface WorkMessage {
  schemaVersion: 1;
  jobId: string;
  sourceBucket: string;
  sourceKey: string;
  contentType?: string;
}

export interface ProcessingResult {
  schemaVersion: 1;
  jobId: string;
  source: {
    bucket: string;
    key: string;
  };
  checksumSha256: string;
  sizeBytes: number;
  contentType: string;
}
