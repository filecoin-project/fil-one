import * as cdk from 'aws-cdk-lib';
import { DatabaseStack } from './stacks/database-stack';
import { DomainStack } from './stacks/domain-stack';
import { PlatformStack } from './stacks/platform-stack';

const app = new cdk.App();

//Sandbox account from "SSO start url" portal: https://d-9067ff87d6.awsapps.com/start/#/?tab=accounts
//Bootstrap needed admin access but in theory not needed for regular dev.
const env: cdk.Environment = {
  account: "654654381893",
  region: "us-east-2",
};

const domainStack = new DomainStack(app, 'HyperspaceDomainStack', { env });

const databaseStack = new DatabaseStack(app, 'HyperspaceDatabaseStack', { env });

const platformStack = new PlatformStack(app, 'HyperspacePlatformStack', {
  env,
  uploadsTable: databaseStack.uploadsTable,
});
platformStack.addDependency(databaseStack);

app.synth();
