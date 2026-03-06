import type { SQSEvent, Context } from 'aws-lambda';
import { processTenantSetup } from '../lib/aurora-tenant-setup.js';
import type { AuroraTenantSetupMessage } from '../lib/aurora-tenant-setup.js';

export async function handler(event: SQSEvent, _context: Context): Promise<void> {
  const message: AuroraTenantSetupMessage = JSON.parse(event.Records[0].body);
  await processTenantSetup(message);
}
