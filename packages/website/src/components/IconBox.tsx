import type { ComponentType, SVGProps } from 'react';

import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import clsx from 'clsx';

export type IconBoxColor = 'blue' | 'green' | 'red' | 'grey';
export type IconBoxSize = 'sm' | 'md' | 'lg';

type IconBoxProps = {
  icon: PhosphorIcon | ComponentType<SVGProps<SVGSVGElement>>;
  color?: IconBoxColor;
  size?: IconBoxSize;
  className?: string;
};

const colorStyles: Record<IconBoxColor, string> = {
  blue:  'bg-brand-50 text-brand-600',
  green: 'bg-green-50 text-green-600',
  red:   'bg-red-50 text-red-600',
  grey:  'bg-zinc-100 text-zinc-600',
};

const sizeStyles: Record<IconBoxSize, { container: string; iconSize: number }> = {
  sm: { container: 'p-1.5 rounded-lg',  iconSize: 14 },
  md: { container: 'p-2.5 rounded-lg',  iconSize: 18 },
  lg: { container: 'p-4 rounded-xl',    iconSize: 22 },
};

export function IconBox({
  icon: Icon,
  color = 'blue',
  size = 'md',
  className,
}: IconBoxProps) {
  const { container, iconSize } = sizeStyles[size];
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'inline-flex items-center justify-center shrink-0',
        colorStyles[color],
        container,
        className,
      )}
    >
      <Icon width={iconSize} height={iconSize} />
    </div>
  );
}
