export interface UsageDataPoint {
  date: string;
  value: number;
}

export interface UsageTrendsRequest {
  period: '7d' | '30d';
}

export interface UsageTrendsResponse {
  storage: UsageDataPoint[];
  objects: UsageDataPoint[];
}

export type ActivityAction =
  | 'bucket.created'
  | 'bucket.deleted'
  | 'object.uploaded'
  | 'object.deleted'
  | 'key.created'
  | 'key.deleted';

export interface RecentActivity {
  id: string;
  action: ActivityAction;
  resourceType: 'bucket' | 'object' | 'key';
  resourceName: string;
  timestamp: string;
  sizeBytes?: number;
  cid?: string;
}

export interface RecentActivityResponse {
  activities: RecentActivity[];
}
