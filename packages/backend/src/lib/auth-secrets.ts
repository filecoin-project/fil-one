import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { getEnv } from './env.js';

export interface AuthSecrets {
  AUTH0_CLIENT_ID: string;
  AUTH0_CLIENT_SECRET: string;
}

// Module-level cache — reused across Lambda warm starts
const client = new SecretsManagerClient({});
let cachedSecrets: AuthSecrets | null = null;

export async function getAuthSecrets(): Promise<AuthSecrets> {
  if (cachedSecrets) return cachedSecrets;
  const result = await client.send(
    new GetSecretValueCommand({ SecretId: getEnv('AUTH_SECRET_NAME') }),
  );
  cachedSecrets = JSON.parse(result.SecretString ?? '{}') as AuthSecrets;
  return cachedSecrets;
}
