import { useState } from 'react';

import {
  WarningCircleIcon,
  DownloadSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@phosphor-icons/react/dist/ssr';

import { Modal, ModalBody, ModalFooter, ModalHeader } from './Modal/index.js';
import { Button } from './Button.js';
import { CopyButton } from './CopyButton.js';
import { IconButton } from './IconButton.js';

export type SaveCredentialsModalProps = {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
};

export function SaveCredentialsModal({
  open,
  onClose,
  onDone,
  credentials,
}: SaveCredentialsModalProps) {
  const [showSecret, setShowSecret] = useState(false);

  function downloadBlob(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadCsv() {
    const csv = [
      'Access Key ID,Secret Access Key',
      `${credentials.accessKeyId},${credentials.secretAccessKey}`,
    ].join('\n');
    downloadBlob(csv, 'credentials.csv', 'text/csv');
  }

  function handleDownloadEnv() {
    const env = [
      `export AWS_ACCESS_KEY_ID=${credentials.accessKeyId}`,
      `export AWS_SECRET_ACCESS_KEY=${credentials.secretAccessKey}`,
    ].join('\n');
    downloadBlob(env, 'credentials.env', 'text/plain');
  }

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader onClose={onClose}>Save your credentials</ModalHeader>
      <ModalBody>
        {/* Warning banner */}
        <div className="mb-4 flex gap-2.5 rounded-lg border border-orange-500/20 bg-orange-500/10 p-3">
          <WarningCircleIcon size={16} weight="fill" className="mt-0.5 shrink-0 text-orange-500" />
          <p className="text-xs leading-[18px] text-(--color-text-base)">
            Save your credentials in a safe place. Do not share your secret key with anyone.
          </p>
        </div>

        {/* Credential fields */}
        <div className="flex flex-col gap-3">
          {/* Access Key ID */}
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-(--color-text-base)">Access Key ID</p>
            <div className="flex items-center gap-2">
              <div className="flex h-9 flex-1 items-center overflow-hidden rounded-md border border-(--input-border-color) bg-zinc-50 px-3">
                <span className="truncate font-mono text-xs text-(--color-text-base)">
                  {credentials.accessKeyId}
                </span>
              </div>
              <CopyButton value={credentials.accessKeyId} />
            </div>
          </div>

          {/* Secret Access Key */}
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-(--color-text-base)">Secret Access Key</p>
            <div className="flex items-center gap-2">
              <div className="flex h-9 flex-1 items-center overflow-hidden rounded-md border border-(--input-border-color) bg-zinc-50 px-3">
                <span className="truncate font-mono text-xs text-(--color-text-base)">
                  {showSecret ? credentials.secretAccessKey : '\u2022'.repeat(40)}
                </span>
              </div>
              <IconButton
                icon={showSecret ? EyeSlashIcon : EyeIcon}
                aria-label={showSecret ? 'Hide secret key' : 'Show secret key'}
                onClick={() => setShowSecret((s) => !s)}
              />
              <CopyButton value={credentials.secretAccessKey} />
            </div>
          </div>
        </div>
      </ModalBody>
      <ModalFooter fullWidth>
        <Button variant="ghost" onClick={onDone}>
          Done
        </Button>
        <Button variant="primary" icon={DownloadSimpleIcon} onClick={handleDownloadCsv}>
          Download .csv
        </Button>
        <Button variant="primary" icon={DownloadSimpleIcon} onClick={handleDownloadEnv}>
          Download .env
        </Button>
      </ModalFooter>
    </Modal>
  );
}
