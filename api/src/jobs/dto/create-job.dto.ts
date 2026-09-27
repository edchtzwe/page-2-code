export const JOB_STATUS_QUEUED = 'queued';
export const JOB_STATUS_ACTIVE = 'active';
export const JOB_STATUS_COMPLETED = 'completed';
export const JOB_STATUS_FAILED = 'failed';
export const JOB_STATUS_UNKNOWN = 'unknown';

export type JobStatus =
  | typeof JOB_STATUS_QUEUED
  | typeof JOB_STATUS_ACTIVE
  | typeof JOB_STATUS_COMPLETED
  | typeof JOB_STATUS_FAILED
  | typeof JOB_STATUS_UNKNOWN;

export interface CreateJobRequest {
  readonly url: string;
}

export interface CreateJobResponse {
  readonly jobId: string;
  readonly status: JobStatus;
}

export interface GetJobResponse {
  readonly jobId: string;
  readonly status: JobStatus;
  readonly url?: string;
  readonly failedReason?: string;
}

const URL_PROPERTY = 'url';
const REQUIRED_PROPERTY_COUNT = 1;

export function isCreateJobRequest(body: unknown): body is CreateJobRequest {
  if (typeof body !== 'object' || body === null) {
    return false;
  }

  const record = body as Record<string, unknown>;
  if (typeof record[URL_PROPERTY] !== 'string') {
    return false;
  }

  const properties: string[] = Object.keys(record);
  return properties.length === REQUIRED_PROPERTY_COUNT && properties[0] === URL_PROPERTY;
}
