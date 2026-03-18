import { Button } from './Button';
import { CodeBlock } from './CodeBlock';
import { Modal, ModalBody, ModalFooter, ModalHeader } from './Modal/index.js';

export type SaveCredentialsModalProps = {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  /** Label for the primary done button, e.g. "I've saved my credentials" or "Continue to bucket" */
  doneLabel: string;
};

export function SaveCredentialsModal({
  open,
  onClose,
  onDone,
  credentials,
  doneLabel,
}: SaveCredentialsModalProps) {
  function handleDownload() {
    const csv = [
      'Access Key ID,Secret Access Key',
      `${credentials.accessKeyId},${credentials.secretAccessKey}`,
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'credentials.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader>Save your credentials</ModalHeader>
      <ModalBody>
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Your bucket has been created and an API key generated. Save these credentials in a safe
          place. Do not share your secret key with anyone. This is the only time you will be able to
          see the secret access key.
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
              API Key ID
            </p>
            <CodeBlock code={credentials.accessKeyId} />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Secret API Key
            </p>
            <CodeBlock code={credentials.secretAccessKey} />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={handleDownload}>
            Download credentials
          </Button>
          <Button variant="filled" onClick={onDone}>
            {doneLabel}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
