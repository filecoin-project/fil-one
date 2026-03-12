import { lazy, Suspense, useEffect, useState } from 'react';
import {
  PlusIcon,
  DatabaseIcon,
  KeyIcon,
  ArrowUpIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react/dist/ssr';
import { Link } from '@tanstack/react-router';

const UsageTrends = lazy(() => import('./UsageTrends'));

import { Button } from '@hyperspace/ui/Button';
import { StatCard } from '@hyperspace/ui/StatCard';

import { SubscriptionStatus } from '@filone/shared';
import type { UsageResponse, BillingInfo, RecentActivity, ActivityAction } from '@filone/shared';

import { getUsage, getBilling, getDashboardActivity } from '../../lib/api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function daysRemaining(isoString: string): number {
  const ms = new Date(isoString).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

// ---------------------------------------------------------------------------
// Activity helpers
// ---------------------------------------------------------------------------

type ActivityIconConfig = {
  icon: React.ElementType;
  colorClass: string;
  label: string;
};

const ACTIVITY_CONFIG: Record<ActivityAction, ActivityIconConfig> = {
  'bucket.created': { icon: DatabaseIcon, colorClass: 'text-green-600', label: 'Bucket created' },
  'bucket.deleted': { icon: DatabaseIcon, colorClass: 'text-red-500', label: 'Bucket deleted' },
  'object.uploaded': { icon: ArrowUpIcon, colorClass: 'text-blue-600', label: 'Object uploaded' },
  'object.deleted': { icon: TrashIcon, colorClass: 'text-red-500', label: 'Object deleted' },
  'key.created': { icon: KeyIcon, colorClass: 'text-green-600', label: 'Key created' },
  'key.deleted': { icon: KeyIcon, colorClass: 'text-red-500', label: 'Key deleted' },
};

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="p-6 animate-pulse">
      <div className="mb-6 h-8 w-40 rounded bg-zinc-200" />
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="h-28 rounded-lg bg-zinc-100" />
        <div className="h-28 rounded-lg bg-zinc-100" />
      </div>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="h-24 rounded-lg bg-zinc-100" />
        <div className="h-24 rounded-lg bg-zinc-100" />
        <div className="h-24 rounded-lg bg-zinc-100" />
      </div>
      <div className="h-48 rounded-lg bg-zinc-100" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardPage() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [trialBannerVisible, setTrialBannerVisible] = useState(true);

  useEffect(() => {
    Promise.all([getUsage(), getBilling(), getDashboardActivity(5)])
      .then(([u, b, a]) => {
        setUsage(u);
        setBilling(b);
        setActivities(a.activities);
      })
      .catch(() => {
        // Errors handled by apiRequest (401 redirect, etc.)
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading || !usage || !billing) {
    return <DashboardSkeleton />;
  }

  const isTrialing = billing.subscription.status === SubscriptionStatus.Trialing;
  const trialDaysLeft =
    isTrialing && billing.subscription.trialEndsAt
      ? daysRemaining(billing.subscription.trialEndsAt)
      : null;

  const storagePct =
    usage.storage.limitBytes > 0
      ? Math.round((usage.storage.usedBytes / usage.storage.limitBytes) * 100)
      : 0;

  const downloadsPct =
    usage.downloads.limitBytes > 0
      ? Math.round((usage.downloads.usedBytes / usage.downloads.limitBytes) * 100)
      : 0;

  const showQuickSetup =
    usage.buckets.count === 0 || usage.objects.count === 0 || usage.accessKeys.count === 0;

  const isPopulated = usage.buckets.count > 0;

  const quickSetupTasks = [
    {
      id: 'create-bucket',
      icon: DatabaseIcon,
      title: 'Create a bucket',
      subtitle: 'Organize your storage',
      href: '/buckets',
      done: usage.buckets.count > 0,
    },
    {
      id: 'upload-object',
      icon: ArrowUpIcon,
      title: 'Upload an object',
      subtitle: 'Store files on Filecoin',
      href: '/buckets',
      done: usage.objects.count > 0,
    },
    {
      id: 'generate-key',
      icon: KeyIcon,
      title: 'Generate API key',
      subtitle: 'Connect via S3 API',
      href: '/api-keys',
      done: usage.accessKeys.count > 0,
    },
  ];

  const quickSetupDone = quickSetupTasks.filter((t) => t.done).length;
  const quickSetupTotal = quickSetupTasks.length;

  return (
    <div className="p-6">
      {/* 1. Page header */}
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Dashboard</h1>
        {isPopulated && (
          <Link
            to="/buckets"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 shadow-[0px_1px_2px_0px_rgba(20,24,31,0.03)] hover:bg-zinc-50"
          >
            <PlusIcon size={16} />
            New bucket
          </Link>
        )}
      </div>

      {/* 2. Trial banner */}
      {isTrialing && trialBannerVisible && (
        <div className="mb-5 flex items-center justify-between rounded-xl bg-[rgba(0,128,255,0.06)] px-5 py-3.5 shadow-[0px_0px_0px_1px_rgba(0,128,255,0.1)]">
          <div className="flex items-center gap-4">
            <span className="rounded-full bg-[rgba(0,128,255,0.15)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#0080ff]">
              {trialDaysLeft !== null ? `${trialDaysLeft} days left` : 'TRIAL'}
            </span>
            <p className="text-[13px]">
              <span className="font-medium text-zinc-900">Free trial</span>
              <span className="text-[#677183]"> — Add a payment method to unlock unlimited storage at $4.99/TiB</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/billing"
              className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-br from-[#0080ff] to-[#256af4] px-3 py-1.5 text-xs font-medium text-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] hover:opacity-90"
            >
              Upgrade
              <span aria-hidden="true">→</span>
            </Link>
            <button
              type="button"
              aria-label="Dismiss trial banner"
              onClick={() => setTrialBannerVisible(false)}
              className="rounded-md p-1.5 text-zinc-400 hover:text-zinc-600"
            >
              <XIcon size={16} />
            </button>
          </div>
        </div>
      )}

      {/* 3. Quick Setup card */}
      {showQuickSetup && (
        <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Quick Setup
            </span>
            <span className="text-xs text-zinc-400">
              {quickSetupDone} of {quickSetupTotal}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {quickSetupTasks.map(({ id, icon: Icon, title, subtitle, href, done }) => (
              <Link
                key={id}
                to={href}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-4 text-center ${
                  done ? 'border-green-200 bg-green-50' : 'border-zinc-200 hover:bg-zinc-50'
                }`}
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${
                    done ? 'bg-green-100 text-green-600' : 'bg-brand-50 text-brand-600'
                  }`}
                >
                  <Icon size={20} />
                </span>
                <span className="text-sm font-medium text-zinc-800">{title}</span>
                <span className="text-xs text-zinc-500">{subtitle}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 4. Stats row */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          size="lg"
          label="STORAGE"
          value={formatBytes(usage.storage.usedBytes)}
          limit={
            usage.storage.limitBytes > 0
              ? `/ ${formatBytes(usage.storage.limitBytes)}`
              : '/ Unlimited'
          }
          usage={`${storagePct}% used`}
          progress={storagePct}
        />
        <StatCard
          size="lg"
          label="DOWNLOADS"
          value={formatBytes(usage.downloads.usedBytes)}
          limit={`/ ${formatBytes(usage.downloads.limitBytes)}`}
          usage={`${downloadsPct}% used`}
          progress={downloadsPct}
        />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="BUCKETS"
          value={String(usage.buckets.count)}
          limit={`/ ${usage.buckets.limit}`}
        />
        <StatCard label="OBJECTS" value={String(usage.objects.count)} limit="total" />
        <StatCard
          label="ACCESS KEYS"
          value={String(usage.accessKeys.count)}
          limit={`/ ${usage.accessKeys.limit}`}
        />
      </div>

      {/* 5. Usage Trends — wrapped for spacing */}
      <Suspense fallback={<div className="mb-6" style={{ height: 200 }} />}>
        <UsageTrends />
      </Suspense>

      {/* 6. Recent Activity */}
      <div className="rounded-lg border border-[rgba(225,228,234,0.6)] bg-white pb-5 pl-3 pr-5 pt-4 shadow-[0px_1px_2px_0px_rgba(20,24,31,0.03)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wider text-[#677183]">
            Recent Activity
          </h2>
          {activities.length > 0 && (
            <Link
              to="/buckets"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#677183] hover:text-zinc-900"
            >
              View all
              <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>

        {activities.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm font-medium text-zinc-700">No activity yet</p>
            <p className="text-sm text-zinc-500">Create a bucket to start storing objects</p>
            <Button variant="filled" icon={PlusIcon} href="/buckets">
              Create bucket
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100/50">
            {activities.map((activity) => {
              const config = ACTIVITY_CONFIG[activity.action];
              const Icon = config.icon;
              return (
                <div key={activity.id} className="flex items-center gap-4 rounded-lg px-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-zinc-900">
                        {activity.resourceName}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                          activity.resourceType === 'object'
                            ? 'bg-[rgba(0,128,255,0.1)] text-[#0080ff]'
                            : activity.resourceType === 'bucket'
                              ? 'bg-zinc-100 text-[#677183]'
                              : 'bg-purple-50 text-purple-600'
                        }`}
                      >
                        {activity.resourceType}
                      </span>
                    </div>
                    {activity.cid && (
                      <p className="mt-0.5 truncate font-mono text-[10px] text-[#677183]">
                        {activity.cid}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    {activity.sizeBytes !== undefined && (
                      <span className="text-[11px] font-medium text-[#677183]">
                        {formatBytes(activity.sizeBytes)}
                      </span>
                    )}
                    <span className="w-14 text-right text-[11px] text-[#677183]">
                      {timeAgo(activity.timestamp)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
