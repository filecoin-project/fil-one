import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppHeader } from './AppHeader';
import { getMe } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  getMe: vi.fn(),
  logout: vi.fn(),
}));

describe('AppHeader', () => {
  beforeEach(() => {
    vi.mocked(getMe).mockReset();
  });

  it('renders a gravatar image when the user email is available', async () => {
    vi.mocked(getMe).mockResolvedValue({
      orgId: 'org-123',
      orgName: 'Test Org',
      orgConfirmed: true,
      email: 'User@example.com',
      orgSetupComplete: true,
    });

    render(<AppHeader />);

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'User avatar' })).toHaveAttribute(
        'src',
        'https://www.gravatar.com/avatar/b58996c504c5638798eb6b511e6f49af?d=identicon&s=32',
      );
    });
  });

  it('falls back to the placeholder avatar when no email is available', async () => {
    vi.mocked(getMe).mockResolvedValue({
      orgId: 'org-123',
      orgName: 'Test Org',
      orgConfirmed: true,
      orgSetupComplete: true,
    });

    render(<AppHeader />);

    await waitFor(() => {
      expect(getMe).toHaveBeenCalledOnce();
    });

    expect(screen.queryByRole('img', { name: 'User avatar' })).not.toBeInTheDocument();
    expect(screen.getByText('U')).toBeInTheDocument();
  });
});
