import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import { Construct } from 'constructs';

interface ApiStackProps extends cdk.StackProps {
  uploadsTable: dynamodb.ITable;
  /** Origins allowed by CORS preflight, e.g. ["https://xxxx.cloudfront.net", "http://localhost:5173"] */
  allowedOrigins: string[];
}

export class ApiStack extends cdk.Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const uploadFn = new lambdaNodejs.NodejsFunction(this, 'HyperspaceUploadFunction', {
      entry: path.resolve(
        __dirname,
        '../../../backend/src/handlers/upload.ts',
      ),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      environment: {
        UPLOADS_TABLE_NAME: props.uploadsTable.tableName,
      },
      bundling: {
        // esbuild bundles all dependencies, including @hyperspace/shared,
        // so no separate build of the shared package is needed at deploy time.
        externalModules: [],
        minify: true,
        sourceMap: true,
      },
    });

    props.uploadsTable.grantWriteData(uploadFn);

    const httpApi = new apigwv2.HttpApi(this, 'HyperspaceHttpApi', {
      corsPreflight: {
        allowOrigins: props.allowedOrigins,
        allowMethods: [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: cdk.Duration.days(1),
      },
    });

    httpApi.addRoutes({
      path: '/upload',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        'HyperspaceUploadIntegration',
        uploadFn,
      ),
    });

    this.apiUrl = httpApi.apiEndpoint;

    new cdk.CfnOutput(this, 'HyperspaceApiUrl', {
      value: httpApi.apiEndpoint,
      description: 'API Gateway HTTP API endpoint URL',
    });
  }
}
