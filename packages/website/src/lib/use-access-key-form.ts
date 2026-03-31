import { useState } from 'react';

import type {
  AccessKeyBucketScope,
  AccessKeyPermission,
  CreateAccessKeyResponse,
} from '@filone/shared';
import { CreateAccessKeySchema } from '@filone/shared';
import { createAccessKey } from './api.js';
import { expiresAtFromForm } from './time.js';
import type { ExpirationOption } from '../components/AccessKeyExpirationFields.js';
import { useToast } from '../components/Toast/index.js';

export type UseAccessKeyFormOptions = {
  defaultBucket?: string;
  onSuccess: (response: CreateAccessKeyResponse) => void;
};

export function useAccessKeyForm({ defaultBucket, onSuccess }: UseAccessKeyFormOptions) {
  const { toast } = useToast();

  const [keyName, setKeyName] = useState('');
  const [permissions, setPermissions] = useState<AccessKeyPermission[]>(['read', 'write', 'list']);
  const [bucketScope, setBucketScope] = useState<AccessKeyBucketScope>(
    defaultBucket ? 'specific' : 'all',
  );
  const [selectedBuckets, setSelectedBuckets] = useState<string[]>(
    defaultBucket ? [defaultBucket] : [],
  );
  const [expiration, setExpiration] = useState<ExpirationOption>('never');
  const [customDate, setCustomDate] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const bucketsValid = bucketScope === 'all' || selectedBuckets.length > 0;
  const canSubmit =
    keyName.trim().length > 0 && permissions.length > 0 && bucketsValid && !creating;

  function reset() {
    setKeyName('');
    setPermissions(['read', 'write', 'list']);
    setBucketScope(defaultBucket ? 'specific' : 'all');
    setSelectedBuckets(defaultBucket ? [defaultBucket] : []);
    setExpiration('never');
    setCustomDate(null);
    setCreating(false);
  }

  async function doSubmit() {
    const body = {
      keyName: keyName.trim(),
      permissions,
      bucketScope,
      buckets: bucketScope === 'specific' ? selectedBuckets : undefined,
      expiresAt: expiresAtFromForm(expiration, customDate),
    };
    const parsed = CreateAccessKeySchema.safeParse(body);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setCreating(true);
    try {
      const response = await createAccessKey(body);
      onSuccess(response);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create access key');
    } finally {
      setCreating(false);
    }
  }

  function handleSubmit(e?: { preventDefault(): void }) {
    e?.preventDefault();
    void doSubmit();
  }

  return {
    keyName,
    setKeyName,
    permissions,
    setPermissions,
    bucketScope,
    setBucketScope,
    selectedBuckets,
    setSelectedBuckets,
    expiration,
    setExpiration,
    customDate,
    setCustomDate,
    expiresAt: expiresAtFromForm(expiration, customDate),
    creating,
    canSubmit,
    handleSubmit,
    reset,
  };
}
