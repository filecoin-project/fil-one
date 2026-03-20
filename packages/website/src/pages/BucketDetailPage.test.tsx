import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { BucketDetailPage } from './BucketDetailPage';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => mocks.navigate,
}));

vi.mock('../lib/api.js', () => ({
  apiRequest: mocks.apiRequest,
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    toast: {
      success: mocks.toastSuccess,
      error: mocks.toastError,
      info: mocks.toastInfo,
    },
  }),
}));

const originalXMLHttpRequest = globalThis.XMLHttpRequest;

class MockXMLHttpRequest {
  upload = {
    onprogress: null as ((event: ProgressEvent<EventTarget>) => void) | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;

  open = vi.fn();
  setRequestHeader = vi.fn();

  send = vi.fn(() => {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: 1,
      total: 1,
    } as ProgressEvent<EventTarget>);
    this.onload?.();
  });
}

describe('BucketDetailPage', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.navigate.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.toastInfo.mockReset();
    globalThis.XMLHttpRequest = MockXMLHttpRequest as unknown as typeof XMLHttpRequest;
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXMLHttpRequest;
  });

  it('uses the backend-returned key for the optimistic uploaded object entry', async () => {
    mocks.apiRequest
      .mockResolvedValueOnce({
        objects: [],
        isTruncated: false,
      })
      .mockResolvedValueOnce({
        url: 'https://example.com/upload',
        key: 'server-name.txt',
      });

    render(<BucketDetailPage bucketName="photos" />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Upload object' })).toHaveLength(2);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Upload object' })[0]);

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput as HTMLInputElement, {
      target: {
        files: [new File(['hello'], 'client-name.txt', { type: 'text/plain' })],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Download server-name.txt' })).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('button', { name: 'Download client-name.txt' }),
    ).not.toBeInTheDocument();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('client-name.txt uploaded successfully');
  });
});
