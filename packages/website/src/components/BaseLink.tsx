import { Component } from 'react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { Link } from '@tanstack/react-router';

export type BaseLinkProps = {
  href: string;
  children?: ReactNode;
  className?: string;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>;

function isInternalLink(href: string): boolean {
  return href.startsWith('/') || href.startsWith('#');
}

/** Falls back to a plain <a> if no router context is available (e.g. Storybook). */
class RouterLinkSafe extends Component<
  { to: string; children?: ReactNode } & Record<string, unknown>,
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    const { to, children, ...rest } = this.props;
    if (this.state.hasError) {
      return (
        <a href={to} {...rest}>
          {children}
        </a>
      );
    }
    return (
      <Link to={to} {...rest}>
        {children}
      </Link>
    );
  }
}

export function BaseLink({ href, children, ...rest }: BaseLinkProps) {
  if (href.startsWith('mailto:')) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }

  if (isInternalLink(href)) {
    return (
      <RouterLinkSafe to={href} {...rest}>
        {children}
      </RouterLinkSafe>
    );
  }

  return (
    <a rel="noopener noreferrer" href={href} target="_blank" {...rest}>
      {children}
    </a>
  );
}
