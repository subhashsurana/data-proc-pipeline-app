import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path'; 

export class DataProcPipelineAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Table
    const table = new dynamodb.Table(this, 'ProcessedData', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,  // For dev/testing; use RETAIN for production
    });

    // Lambda Function
    const lambdaFunction = new NodejsFunction(this, 'FileProcessor', {
      entry: path.join(__dirname, '../lambda/data-proc.ts'),  // Path to the TypeScript file
      handler: 'handler',  // Exported handler function
      runtime: lambda.Runtime.NODEJS_18_X,  // Ensure it's Node.js 14.x or higher for modern JavaScript/TypeScript
      bundling: {
        minify: true,  // Optional: Minify the code to reduce bundle size
        nodeModules: ['aws-sdk','uuid'],  // Ensure `uuid` is included in the bundle
      },
      environment: {
        TABLE_NAME: table.tableName,  // Pass DynamoDB table name as an environment variable
      },
    });

    // Grant Lambda permission to write to DynamoDB
    table.grantWriteData(lambdaFunction);

    // API Gateway to trigger Lambda
    const api = new apigateway.RestApi(this, 'TextUploadAPI', {
      restApiName: 'Text Upload Service',
      description: 'API for uploading text files and processing them',
      binaryMediaTypes: ['text/plain'],  // Enable binary uploads (text files)
    });

    // Lambda Integration with API Gateway
    const lambdaIntegration = new apigateway.LambdaIntegration(lambdaFunction);
    api.root.addMethod('POST', lambdaIntegration);  // Add POST method
 
  }
}
