import {
  createClient,
  getAnalyticsV1ByPartnerIdTenantsByTenantIdStorage,
  getV1PartnersByPartnerIdTenants,
  postAuthV1PartnersByPartnerIdTenantsByTenantIdTokens,
  postV1PartnersByPartnerIdTenants,
  postV1PartnersByPartnerIdTenantsByTenantIdSetup,
  type ModelStorageMetricsSample,
} from '@filone/aurora-backoffice-client';
import { getAuroraBackofficeSecrets } from './auth-secrets.js';
import { logger } from './logger.js';

export type { ModelStorageMetricsSample };

export interface CreateAuroraTenantOptions {
  orgId: string;
  displayName: string;
}

export interface CreateAuroraTenantResult {
  auroraTenantId: string;
}

export async function createAuroraTenant({
  orgId,
  displayName,
}: CreateAuroraTenantOptions): Promise<CreateAuroraTenantResult> {
  const baseUrl = process.env.AURORA_BACKOFFICE_URL!;
  const partnerId = process.env.AURORA_PARTNER_ID!;
  const regionId = process.env.AURORA_REGION_ID!;
  const { AURORA_BACKOFFICE_TOKEN: token } = getAuroraBackofficeSecrets();

  const client = createClient({
    baseUrl,
    headers: {
      'X-Api-Key': token,
    },
  });

  const { data, error, response } = await postV1PartnersByPartnerIdTenants({
    client,
    path: { partnerId },
    body: {
      name: orgId,
      displayName,
      regionId,
    },
    throwOnError: false,
  });

  if (error) {
    const status = response?.status;
    if (status === 409) {
      logger.info('Aurora tenant already exists, looking up existing tenant', { orgId });
      try {
        return await findAuroraTenantByOrgId({ client, partnerId, orgId });
      } catch (cause) {
        throw new Error(`Aurora tenant already exists for org ${orgId} but lookup failed`, {
          cause,
        });
      }
    }
    logger.error('Failed to create Aurora tenant', { orgId, error: JSON.stringify(error) });
    throw new Error(`Aurora tenant creation failed for org ${orgId}`, {
      cause: error,
    });
  }

  const auroraTenantId = data?.id;
  if (!auroraTenantId) {
    throw new Error(`Aurora API did not return a tenant id for org ${orgId}`);
  }

  logger.info('Aurora tenant created', { orgId, auroraTenantId });
  return { auroraTenantId };
}

async function findAuroraTenantByOrgId({
  client,
  partnerId,
  orgId,
}: {
  client: ReturnType<typeof createClient>;
  partnerId: string;
  orgId: string;
}): Promise<CreateAuroraTenantResult> {
  const { data, error } = await getV1PartnersByPartnerIdTenants({
    client,
    path: { partnerId },
    // TODO: paginate through all pages instead of assuming ≤1000 tenants
    query: { pageSize: 1000 },
    throwOnError: false,
  });

  if (error) {
    throw new Error(`Failed to list Aurora tenants for partner ${partnerId}`, {
      cause: error,
    });
  }

  const tenant = data?.tenants?.find((t) => t.name === orgId);
  if (!tenant?.id) {
    throw new Error(`Aurora tenant not found for org ${orgId}`);
  }

  logger.info('Found Aurora tenant', { orgId, auroraTenantId: tenant.id });
  return { auroraTenantId: tenant.id };
}

export interface SetupAuroraTenantOptions {
  tenantId: string;
}

export interface SetupAuroraTenantResult {
  id: string;
  lastSetupStep: string;
}

export async function setupAuroraTenant({
  tenantId,
}: SetupAuroraTenantOptions): Promise<SetupAuroraTenantResult> {
  const baseUrl = process.env.AURORA_BACKOFFICE_URL!;
  const partnerId = process.env.AURORA_PARTNER_ID!;
  const { AURORA_BACKOFFICE_TOKEN: token } = getAuroraBackofficeSecrets();

  const client = createClient({
    baseUrl,
    headers: {
      'X-Api-Key': token,
    },
  });

  const { data, error } = await postV1PartnersByPartnerIdTenantsByTenantIdSetup({
    client,
    path: { partnerId, tenantId },
    throwOnError: false,
    // Aurora API returns content-type: text/plain, force JSON parsing
    parseAs: 'json',
  });

  if (error) {
    logger.error('Failed to setup Aurora tenant', { tenantId, error: JSON.stringify(error) });
    throw new Error(`Aurora tenant setup failed for tenant ${tenantId}`, {
      cause: error,
    });
  }

  if (!data) {
    throw new Error(`Aurora API did not return setup data for tenant ${tenantId}`);
  }

  logger.info('Aurora tenant setup complete', { tenantId, lastSetupStep: data.lastSetupStep });
  return { id: data.id!, lastSetupStep: data.lastSetupStep! };
}

export interface CreateAuroraTenantApiKeyOptions {
  tenantId: string;
  orgId: string;
}

export interface CreateAuroraTenantApiKeyResult {
  token: string;
  tokenId: string;
}

export async function createAuroraTenantApiKey({
  tenantId,
  orgId,
}: CreateAuroraTenantApiKeyOptions): Promise<CreateAuroraTenantApiKeyResult> {
  const baseUrl = process.env.AURORA_BACKOFFICE_URL!;
  const partnerId = process.env.AURORA_PARTNER_ID!;
  const { AURORA_BACKOFFICE_TOKEN: token } = getAuroraBackofficeSecrets();

  const client = createClient({
    baseUrl,
    headers: {
      'X-Api-Key': token,
    },
  });

  const { data, error } = await postAuthV1PartnersByPartnerIdTenantsByTenantIdTokens({
    client,
    path: { partnerId, tenantId },
    body: { name: `filone-${orgId}` },
    throwOnError: false,
  });

  if (error) {
    logger.error('Failed to create Aurora API key', { orgId, error: JSON.stringify(error) });
    throw new Error(`Aurora API key creation failed for org ${orgId}`, {
      cause: error,
    });
  }

  const apiToken = data?.token;
  if (!apiToken) {
    throw new Error(`Aurora API did not return a token for org ${orgId}: ${JSON.stringify(data)}`);
  }

  const tokenId = data.id;
  if (!tokenId) {
    throw new Error(
      `Aurora API did not return a token ID for org ${orgId}: ${JSON.stringify(data)}`,
    );
  }

  logger.info('Aurora API key created', { orgId, tokenId });
  return { token: apiToken, tokenId };
}

export interface GetStorageSamplesOptions {
  tenantId: string;
  from: string;
  to: string;
  window?: string;
}

export async function getStorageSamples({
  tenantId,
  from,
  to,
  window = '1h',
}: GetStorageSamplesOptions): Promise<ModelStorageMetricsSample[]> {
  const baseUrl = process.env.AURORA_BACKOFFICE_URL!;
  const partnerId = process.env.AURORA_PARTNER_ID!;
  const { AURORA_BACKOFFICE_TOKEN: token } = getAuroraBackofficeSecrets();

  const client = createClient({
    baseUrl,
    headers: { 'X-Api-Key': token },
  });

  const { data, error } = await getAnalyticsV1ByPartnerIdTenantsByTenantIdStorage({
    client,
    path: { partnerId, tenantId },
    query: { from, to, window },
    throwOnError: false,
  });

  if (error) {
    throw new Error(`Aurora storage API failed for tenant ${tenantId}`, {
      cause: error,
    });
  }

  return data?.samples ?? [];
}
