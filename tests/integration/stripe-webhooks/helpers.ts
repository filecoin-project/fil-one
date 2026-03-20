import { Resource } from 'sst';
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import Stripe from 'stripe';

// =============================================================================
// Config (reads from SST Resource, available via `sst shell`)
// =============================================================================

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';

export function getStripeClient(): Stripe {
  return new Stripe(
    (Resource as unknown as Record<string, { value: string }>).StripeSecretKey.value,
  );
}

export function getDynamoClient(): DynamoDBClient {
  return new DynamoDBClient({ region: AWS_REGION });
}

export function getBillingTableName(): string {
  return (Resource as unknown as Record<string, { name: string }>).BillingTable.name;
}

export function getStripePriceId(): string {
  const priceId =
    process.env.STRIPE_PRICE_ID ??
    (Resource as unknown as Record<string, { value: string } | undefined>).StripePriceId?.value ??
    '';
  if (!priceId) {
    throw new Error('STRIPE_PRICE_ID is not set and not available from SST Resource');
  }
  return priceId;
}

// =============================================================================
// Shared clients (lazy singletons)
// =============================================================================

let _stripe: Stripe | undefined;
let _dynamo: DynamoDBClient | undefined;

export function stripe(): Stripe {
  return (_stripe ??= getStripeClient());
}

export function dynamo(): DynamoDBClient {
  return (_dynamo ??= getDynamoClient());
}

// =============================================================================
// Utilities
// =============================================================================
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// DynamoDB helpers
// =============================================================================

export async function seedBillingRecord(
  userId: string,
  customerId: string,
  status: string,
  extra?: Record<string, { S: string }>,
): Promise<void> {
  const item: Record<string, { S: string }> = {
    pk: { S: `CUSTOMER#${userId}` },
    sk: { S: 'SUBSCRIPTION' },
    orgId: { S: 'test-org' },
    stripeCustomerId: { S: customerId },
    subscriptionStatus: { S: status },
    updatedAt: { S: new Date().toISOString() },
    ...extra,
  };

  await dynamo().send(
    new PutItemCommand({
      TableName: getBillingTableName(),
      Item: item,
    }),
  );
}

export async function getBillingRecord(
  userId: string,
): Promise<Record<string, AttributeValue> | null> {
  const result = await dynamo().send(
    new GetItemCommand({
      TableName: getBillingTableName(),
      Key: {
        pk: { S: `CUSTOMER#${userId}` },
        sk: { S: 'SUBSCRIPTION' },
      },
    }),
  );
  return result.Item ?? null;
}

export async function deleteBillingRecord(userId: string): Promise<void> {
  try {
    await dynamo().send(
      new DeleteItemCommand({
        TableName: getBillingTableName(),
        Key: {
          pk: { S: `CUSTOMER#${userId}` },
          sk: { S: 'SUBSCRIPTION' },
        },
      }),
    );
  } catch {
    // ignore
  }
}

// =============================================================================
// Stripe helpers
// =============================================================================

export async function createTestCustomer(userId: string, testClock?: string): Promise<string> {
  const params: Stripe.CustomerCreateParams = {
    metadata: { userId, orgId: 'test-org' },
    description: `Webhook test customer (${userId})`,
  };
  if (testClock) {
    params.test_clock = testClock;
  }
  const customer = await stripe().customers.create(params);
  return customer.id;
}

export async function attachValidCard(customerId: string): Promise<string> {
  const pm = await stripe().paymentMethods.attach('pm_card_visa', {
    customer: customerId,
  });
  await stripe().customers.update(customerId, {
    invoice_settings: { default_payment_method: pm.id },
  });
  return pm.id;
}

export async function attachDecliningCard(customerId: string): Promise<void> {
  const pm = await stripe().paymentMethods.attach('pm_card_chargeCustomerFail', {
    customer: customerId,
  });
  await stripe().customers.update(customerId, {
    invoice_settings: { default_payment_method: pm.id },
  });
}

export async function createAndPayInvoice(customerId: string): Promise<string> {
  await stripe().invoiceItems.create({
    customer: customerId,
    amount: 500,
    currency: 'usd',
  });

  const invoice = await stripe().invoices.create({
    customer: customerId,
    pending_invoice_items_behavior: 'include',
  });

  try {
    await stripe().invoices.finalizeInvoice(invoice.id);
  } catch {
    /* ignore */
  }
  try {
    await stripe().invoices.pay(invoice.id);
  } catch {
    /* ignore */
  }

  return invoice.id;
}

export async function createAndFailInvoice(customerId: string): Promise<string> {
  await stripe().invoiceItems.create({
    customer: customerId,
    amount: 500,
    currency: 'usd',
  });

  const invoice = await stripe().invoices.create({
    customer: customerId,
    pending_invoice_items_behavior: 'include',
    auto_advance: false,
  });

  try {
    await stripe().invoices.finalizeInvoice(invoice.id);
  } catch {
    /* ignore */
  }
  try {
    await stripe().invoices.pay(invoice.id);
  } catch {
    /* expected to fail */
  }

  return invoice.id;
}

// =============================================================================
// Waiting
// =============================================================================

export async function waitForWebhook(seconds = 15): Promise<void> {
  await sleep(seconds * 1000);
}

export async function pollTestClockReady(clockId: string, timeoutSeconds = 120): Promise<void> {
  for (let elapsed = 0; elapsed < timeoutSeconds; elapsed += 5) {
    const clockState = await stripe().testHelpers.testClocks.retrieve(clockId);
    if (clockState.status === 'ready') {
      return;
    }
    await sleep(5000);
  }
  throw new Error(`Test clock ${clockId} did not reach 'ready' status after ${timeoutSeconds}s`);
}
