export interface S3Object {
  key: string;
  sizeBytes: number;
  lastModified: string;
  etag?: string;
  contentType: string;
  cid?: string;
  description?: string;
}

export interface ListObjectsRequest {
  bucketName: string;
  prefix?: string;
  delimiter?: string;
  nextToken?: string;
  maxKeys?: number;
}

export interface ListObjectsResponse {
  objects: S3Object[];
  prefix?: string;
  nextToken?: string;
  isTruncated: boolean;
}

export interface PresignUploadRequest {
  key: string;
  contentType: string;
}

export interface PresignUploadResponse {
  url: string;
  key: string;
}

export interface ConfirmUploadRequest {
  key: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  etag?: string;
  description?: string;
}

export interface ConfirmUploadResponse {
  object: S3Object;
}

export interface DeleteObjectRequest {
  bucketName: string;
  key: string;
}
