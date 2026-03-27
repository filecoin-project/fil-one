import { clsx } from 'clsx';

type BadgeProps = {
  variant?: 'default' | 'success';
  className?: string;
  children: React.ReactNode;
};

export function Badge({ variant = 'default', className, children }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium',
        variant === 'success'
          ? 'border-green-200 bg-green-50 text-green-700'
          : 'border-zinc-200 bg-zinc-100 text-zinc-600',
        className,
      )}
    >
      {children}
    </span>
  );
}
