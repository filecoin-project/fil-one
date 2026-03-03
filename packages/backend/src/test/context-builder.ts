import type { Context } from 'aws-lambda';

export class ContextBuilder {
  private _functionName = 'test-function';

  withFunctionName(name: string): this {
    this._functionName = name;
    return this;
  }

  build(): Context {
    return {
      callbackWaitsForEmptyEventLoop: false,
      functionName: this._functionName,
      functionVersion: '$LATEST',
      invokedFunctionArn: `arn:aws:lambda:us-east-1:123456789:function:${this._functionName}`,
      memoryLimitInMB: '128',
      awsRequestId: 'test-request-id',
      logGroupName: `/aws/lambda/${this._functionName}`,
      logStreamName: '2024/01/01/[$LATEST]abc123',
      getRemainingTimeInMillis: () => 5000,
      done: () => {},
      fail: () => {},
      succeed: () => {},
    };
  }
}