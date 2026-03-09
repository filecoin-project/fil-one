import fetchRetry from 'fetch-retry';

// TODO: Replace with @hyperspace/aurora-backoffice-client
export interface StorageApiConfig {
  baseUrl: string;
  apiKey: string;
  partnerId: string;
}

export interface StorageSample {
  timestamp: string;
  bytesUsed: number;
}

export interface StorageApiResponse {
  samples: StorageSample[];
}

const MAX_RETRIES = 2;

const retryOptions = {
  retries: MAX_RETRIES,
  retryDelay: (attempt: number) => Math.pow(2, attempt) * 1000,
  retryOn: (attempt: number, error: Error | null, response: Response | null) => {
    if (attempt >= MAX_RETRIES) return false;
    if (error) return true;
    if (response && (response.status >= 500 || response.status === 429)) return true;
    return false;
  },
};

export async function getStorageSamples(
  config: StorageApiConfig,
  tenantId: string,
  from: string,
  to: string,
  window: string = '1h',
): Promise<StorageSample[]> {
  const url = `${config.baseUrl}/${config.partnerId}/tenants/${tenantId}/storage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&window=${encodeURIComponent(window)}`;

  const fetchWithRetry = fetchRetry(fetch);
  const response = await fetchWithRetry(url, {
    headers: { 'X-Api-Key': config.apiKey },
    ...retryOptions,
  });

  if (!response.ok) {
    throw new Error(`Aurora API returned ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as StorageApiResponse;
  return data.samples;
}
