import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

vi.mock('sst', () => ({
  Resource: {
    UserInfoTable: { name: 'UserInfoTable' },
  },
}));

const ddbMock = mockClient(DynamoDBClient);

import { getOrgName } from './org-profile.js';

describe('getOrgName', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('returns name when profile item exists', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: { name: { S: 'Acme Corp' } },
    });

    const result = await getOrgName('org-1');

    expect(result).toBe('Acme Corp');
  });

  it('returns undefined when profile item is missing', async () => {
    ddbMock.on(GetItemCommand).resolves({});

    const result = await getOrgName('org-missing');

    expect(result).toBeUndefined();
  });

  it('queries with correct pk/sk', async () => {
    ddbMock.on(GetItemCommand).resolves({});

    await getOrgName('org-42');

    const calls = ddbMock.commandCalls(GetItemCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.TableName).toBe('UserInfoTable');
    expect(input.Key).toEqual({
      pk: { S: 'ORG#org-42' },
      sk: { S: 'PROFILE' },
    });
  });
});
