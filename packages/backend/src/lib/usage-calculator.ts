import { TIB_BYTES } from '@hyperspace/shared';
import type { StorageSample } from './aurora-analytics-client.js';

export interface UsageCalculationResult {
  averageBytesUsed: number;
  averageTib: number;
  sampleCount: number;
}

export function calculateAverageUsage(samples: StorageSample[]): UsageCalculationResult {
  if (samples.length === 0) {
    return { averageBytesUsed: 0, averageTib: 0, sampleCount: 0 };
  }

  const totalBytes = samples.reduce((sum, s) => sum + s.bytesUsed, 0);
  const averageBytesUsed = totalBytes / samples.length;
  const averageTib = averageBytesUsed / TIB_BYTES;

  return { averageBytesUsed, averageTib, sampleCount: samples.length };
}
