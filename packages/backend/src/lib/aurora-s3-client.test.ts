import { describe, it, expect } from 'vitest';
import { getPresignedHeadObjectUrl } from './aurora-s3-client.js';

describe('getPresignedHeadObjectUrl', () => {
  const baseOptions = {
    endpointUrl: 'https://s3.example.com',
    credentials: { accessKeyId: 'AKIATEST', secretAccessKey: 'secret' },
    bucket: 'my-bucket',
    key: 'path/to/object',
    expiresIn: 300,
  };

  it('signs x-amz-checksum-mode as a header (appears in SignedHeaders, not hoisted)', async () => {
    const url = new URL(await getPresignedHeadObjectUrl(baseOptions));

    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signedHeaders.split(';')).toContain('x-amz-checksum-mode');

    expect(url.searchParams.has('X-Amz-Checksum-Mode')).toBe(false);
    expect(url.searchParams.has('x-amz-checksum-mode')).toBe(false);
  });

  it('still adds fil-include-meta query param when includeFilMeta is true', async () => {
    const url = new URL(await getPresignedHeadObjectUrl({ ...baseOptions, includeFilMeta: true }));

    expect(url.searchParams.get('fil-include-meta')).toBe('1');
    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signedHeaders.split(';')).toContain('x-amz-checksum-mode');
  });
});
