import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path from 'path';
import { Construct } from 'constructs';

export enum AccessLevel {
  READ = 'read',
  WRITE = 'write',
  READ_WRITE = 'readWrite',
}

export interface ApiFunctionProps {
  handlerFile: string;
  routePath: string;
  methods: apigwv2.HttpMethod[];
  httpApi: apigwv2.HttpApi;
  authSecret: secretsmanager.ISecret;
  auth0Env: Record<string, string>;
  sharedBundling: lambdaNodejs.BundlingOptions;
  environment?: Record<string, string>;
  table?: dynamodb.ITable;
  tableAccess?: AccessLevel;
  s3Bucket?: s3.IBucket;
  s3Access?: AccessLevel;
  lambdaProps?: Partial<lambdaNodejs.NodejsFunctionProps>;
}

function grantTableAccess(fn: lambda.IFunction, table: dynamodb.ITable, access: AccessLevel) {
  const grants = {
    [AccessLevel.READ]: () => table.grantReadData(fn),
    [AccessLevel.WRITE]: () => table.grantWriteData(fn),
    [AccessLevel.READ_WRITE]: () => table.grantReadWriteData(fn),
  };
  grants[access]();
}

function grantBucketAccess(fn: lambda.IFunction, bucket: s3.IBucket, access: AccessLevel) {
  const grants = {
    [AccessLevel.READ]: () => bucket.grantRead(fn),
    [AccessLevel.WRITE]: () => bucket.grantWrite(fn),
    [AccessLevel.READ_WRITE]: () => bucket.grantReadWrite(fn),
  };
  grants[access]();
}

export class ApiFunction extends Construct {
  public readonly function: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiFunctionProps) {
    super(scope, id);

    const { lambdaProps, ...rest } = props;

    this.function = new lambdaNodejs.NodejsFunction(this, 'Handler', {
      entry: path.resolve(__dirname, '../../../backend/src/handlers', rest.handlerFile),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: cdk.Duration.seconds(5),
      environment: {
        ...rest.auth0Env,
        ...rest.environment,
      },
      bundling: rest.sharedBundling,
      ...lambdaProps,
    });

    rest.authSecret.grantRead(this.function);

    if (rest.table && rest.tableAccess) {
      grantTableAccess(this.function, rest.table, rest.tableAccess);
    }

    if (rest.s3Bucket && rest.s3Access) {
      grantBucketAccess(this.function, rest.s3Bucket, rest.s3Access);
    }

    rest.httpApi.addRoutes({
      path: rest.routePath,
      methods: rest.methods,
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        `${id}Integration`,
        this.function,
      ),
    });
  }
}
