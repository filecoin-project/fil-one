export interface UsageResponse {
  storage: {
    usedBytes: number;
    limitBytes: number; // -1 = unlimited (active subscriber)
  };
  downloads: {
    usedBytes: number;
    limitBytes: number;
  };
  buckets: {
    count: number;
    limit: number;
  };
  objects: {
    count: number;
  };
  accessKeys: {
    count: number;
    limit: number;
  };
}
