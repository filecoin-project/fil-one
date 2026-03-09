import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStorageSamples, type StorageApiConfig } from './aurora-analytics-client.js';

const config: StorageApiConfig = {
  baseUrl: 'https://aurora.example.com',
  apiKey: 'test-api-key',
  partnerId: 'partner-123',
};

const mockSamples = [
  { timestamp: '2024-01-01T00:00:00Z', bytesUsed: 1000 },
  { timestamp: '2024-01-01T01:00:00Z', bytesUsed: 2000 },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getStorageSamples', () => {
  it('constructs correct URL with auth header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ samples: mockSamples }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await getStorageSamples(config, 'tenant-1', '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z', '1h');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('https://aurora.example.com/partner-123/tenants/tenant-1/storage?');
    expect(url).toContain('from=2024-01-01T00%3A00%3A00Z');
    expect(url).toContain('to=2024-01-02T00%3A00%3A00Z');
    expect(url).toContain('window=1h');
    expect(options.headers).toEqual({ 'X-Api-Key': 'test-api-key' });
  });

  it('returns samples on successful request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ samples: mockSamples }),
    }));

    const result = await getStorageSamples(config, 'tenant-1', '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z');
    expect(result).toEqual(mockSamples);
  });

  it('retries on 5xx and succeeds', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
      .mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'Bad Gateway' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ samples: mockSamples }) });
    vi.stubGlobal('fetch', mockFetch);

    const result = await getStorageSamples(config, 'tenant-1', '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z');
    expect(result).toEqual(mockSamples);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('retries on 429', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'Rate Limited' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ samples: [] }) });
    vi.stubGlobal('fetch', mockFetch);

    const result = await getStorageSamples(config, 'tenant-1', '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z');
    expect(result).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 4xx (non-429)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, text: async () => 'Not Found',
    }));

    await expect(
      getStorageSamples(config, 'tenant-1', '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z'),
    ).rejects.toThrow('Aurora API returned 404: Not Found');
  });

  it('retries on network error and succeeds', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ samples: mockSamples }) });
    vi.stubGlobal('fetch', mockFetch);

    const result = await getStorageSamples(config, 'tenant-1', '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z');
    expect(result).toEqual(mockSamples);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after all retries exhausted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(
      getStorageSamples(config, 'tenant-1', '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z'),
    ).rejects.toThrow('network down');
  }, 10_000);
});
