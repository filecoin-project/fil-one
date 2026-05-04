import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';

import {
  INSTATUS_PAGE_URL,
  fetchInstatusSummary,
  getStatusDisplay,
} from '../lib/instatus.js';
import { Tooltip } from './Tooltip.js';

const STATUS_REFETCH_MS = 60_000;

const dotColorStyles = {
  green: 'bg-green-500',
  red: 'bg-red-500',
  blue: 'bg-brand-500',
  amber: 'bg-amber-500',
  grey: 'bg-zinc-400',
} as const;

const textColorStyles = {
  green: 'text-green-700',
  red: 'text-red-700',
  blue: 'text-brand-700',
  amber: 'text-amber-700',
  grey: 'text-zinc-500',
} as const;

type StatusBadgeProps = {
  collapsed: boolean;
};

export function StatusBadge({ collapsed }: StatusBadgeProps) {
  const { data, isPending } = useQuery({
    queryKey: ['instatus-summary'],
    queryFn: fetchInstatusSummary,
    staleTime: STATUS_REFETCH_MS,
    refetchInterval: STATUS_REFETCH_MS,
  });

  if (isPending || !data) return null;

  const display = getStatusDisplay(data.page.status);

  const dot = (
    <span className="flex size-[18px] flex-shrink-0 items-center justify-center" aria-hidden="true">
      <span className={clsx('size-2 rounded-full', dotColorStyles[display.color])} />
    </span>
  );

  if (collapsed) {
    return (
      <div className="border-t border-zinc-200 p-2">
        <Tooltip content={display.label} side="right">
          <a
            href={INSTATUS_PAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`System status: ${display.label}`}
            className="flex w-full items-center justify-center rounded-lg px-3 py-2 hover:bg-zinc-100"
          >
            {dot}
          </a>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="border-t border-zinc-200 p-2">
      <a
        href={INSTATUS_PAGE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={clsx(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-zinc-100',
          textColorStyles[display.color],
        )}
      >
        {dot}
        {display.label}
      </a>
    </div>
  );
}
