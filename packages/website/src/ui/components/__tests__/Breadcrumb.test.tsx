import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Breadcrumb } from '../Breadcrumb';
import { setUIConfig, resetUIConfig } from '../../config/ui-config';

beforeEach(() => {
  resetUIConfig();
  setUIConfig({
    baseDomain: 'localhost',
    Link: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
  });
});

describe('Breadcrumb', () => {
  it('renders all items', () => {
    render(<Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Page' }]} />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Page')).toBeInTheDocument();
  });

  it('marks the last item as current page', () => {
    render(<Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Page' }]} />);
    expect(screen.getByText('Page')).toHaveAttribute('aria-current', 'page');
  });

  it('renders links for non-last items with href', () => {
    render(<Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Page' }]} />);
    expect(screen.getByText('Home').closest('a')).toHaveAttribute('href', '/');
  });
});
