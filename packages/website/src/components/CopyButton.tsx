import { CheckCircleIcon, CopySimpleIcon } from '@phosphor-icons/react/dist/ssr';
import { useCopyToClipboard } from '../lib/use-copy-to-clipboard.js';

type CopyButtonProps = {
  value: string;
  size?: number;
  className?: string;
};

export function CopyButton({ value, size = 16, className }: CopyButtonProps) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <button
      type="button"
      onClick={() => void copy(value)}
      aria-label={copied ? 'Copied' : 'Copy'}
      className={`flex items-center justify-center text-zinc-400 transition-colors hover:text-zinc-600 ${className ?? ''}`}
    >
      {copied ? (
        <CheckCircleIcon size={size} className="text-green-500" />
      ) : (
        <CopySimpleIcon size={size} />
      )}
    </button>
  );
}
