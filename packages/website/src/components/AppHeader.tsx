import { useEffect, useState } from 'react';
import { DatabaseIcon, QuestionIcon, BellIcon, SignOutIcon } from '@phosphor-icons/react/dist/ssr';
import { ProgressBar } from '@hyperspace/ui/ProgressBar';
import type { UsageResponse } from '@filone/shared';
import { logout, getUsage } from '../lib/api.js';

type AppHeaderProps = {
  collapsed: boolean;
};

export function AppHeader({ collapsed }: AppHeaderProps) {
  const [usage, setUsage] = useState<UsageResponse | null>(null);

  useEffect(() => {
    const refresh = () => {
      getUsage()
        .then(setUsage)
        .catch(() => {
          /* silent */
        });
    };
    refresh();
    window.addEventListener('billing:updated', refresh);
    return () => window.removeEventListener('billing:updated', refresh);
  }, []);

  const storagePct =
    usage && usage.storage.limitBytes > 0
      ? Math.min(100, (usage.storage.usedBytes / usage.storage.limitBytes) * 100)
      : 0;

  return (
    <header className="flex h-14 flex-shrink-0 items-center border-b border-zinc-200 bg-white px-4 gap-4">
      {/* Storage usage pill — shown in header when sidebar is collapsed */}
      {collapsed && (
        <div className="flex items-center gap-2">
          <DatabaseIcon size={16} className="text-zinc-400" />
          <ProgressBar value={storagePct} size="sm" className="w-24" label="Storage usage" />
          <span className="text-xs text-zinc-500">{storagePct.toFixed(0)}%</span>
        </div>
      )}

      {/* Spacer pushes right-side icons to the right */}
      <div className="flex-1" />

      {/* Right-side icon buttons */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Help"
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
        >
          <QuestionIcon size={18} />
        </button>

        <button
          type="button"
          aria-label="Notifications"
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
        >
          <BellIcon size={18} />
        </button>

        {/* User avatar — placeholder with initial "U" */}
        <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-medium text-white">
          U
        </div>

        <button
          type="button"
          aria-label="Sign out"
          onClick={logout}
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
        >
          <SignOutIcon size={18} />
        </button>
      </div>
    </header>
  );
}
