export type AccessKeyStatus = 'active' | 'inactive';

export type AccessKeyPermission = 'read' | 'write' | 'list' | 'delete';

export type AccessKeyBucketScope = 'all' | 'specific';

export interface AccessKey {
  id: string;
  keyName: string;
  accessKeyId: string;
  createdAt: string;
  lastUsedAt?: string;
  status: AccessKeyStatus;
  permissions: AccessKeyPermission[];
  bucketScope: AccessKeyBucketScope;
  buckets?: string[];
  expiresAt?: string | null;
}

export interface ListAccessKeysResponse {
  keys: AccessKey[];
}

export interface CreateAccessKeyRequest {
  keyName: string;
  permissions: AccessKeyPermission[];
  bucketScope: AccessKeyBucketScope;
  buckets?: string[];
  expiresAt?: string | null;
}

export interface CreateAccessKeyResponse {
  id: string;
  keyName: string;
  accessKeyId: string;
  secretAccessKey: string;
  createdAt: string;
}

export interface DeleteAccessKeyRequest {
  keyId: string;
}
