import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam'; 


export class DataProcPipelineAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Table
    const table = new dynamodb.Table(this, 'ProcessedData', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,  // For dev/testing; use RETAIN for production
    });

    // Lambda Function for processing API Requests
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

    // Lambda function for the REQUEST authorizer (validates x-api-key)
    const authorizerLambda = new NodejsFunction(this, 'AuthorizerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',  // Authorizer Lambda function handler
      entry: path.join(__dirname, '../lambda/authorizer.ts'),  // Path to the authorizer Lambda code
      bundling: {
        minify: true,  // Optional: Minify the code to reduce bundle size
        nodeModules: ['aws-sdk'],  // Ensure `uuid` is included in the bundle
      },
    });

    // Add the API Gateway permission to the Lambda's role
    authorizerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['apigateway:GET'],
      resources: ['arn:aws:apigateway:us-east-1::/apikeys/*'],  // Allow access to all API keys in the region
    }));

    // Grant Lambda permission to write to DynamoDB
    table.grantWriteData(lambdaFunction);

    // API Gateway to trigger Lambda
    const api = new apigateway.RestApi(this, 'DataProcessingAPI', {
      restApiName: 'DataProcessingAPI',
      description: 'API for uploading text files and processing them',
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      binaryMediaTypes: ['text/plain'],  // Enable binary uploads (text files)
      deployOptions: {
        stageName: 'prod',  // Deploy to the 'prod' stage
      },
    });

    // REQUEST-based Lambda authorizer that validates the API key
    const requestAuthorizer = new apigateway.RequestAuthorizer(this, 'RequestAuthorizer', {
      handler: authorizerLambda,  // Use the authorizer Lambda function
      identitySources: [apigateway.IdentitySource.header('x-api-key')],  // Validate API key from header
      resultsCacheTtl: cdk.Duration.seconds(0),  // Optional: Cache for 5 minutes
    });


    // Lambda Integration with API Gateway
    
    const lambdaIntegration = new apigateway.LambdaIntegration(lambdaFunction);
     
     
    // Attach the POST method with the RequestAuthorizer and API key requirement
    const dataResource = api.root.addResource('app');
    dataResource.addMethod('POST', lambdaIntegration, {    // Add POST method
      apiKeyRequired: true,           // Require API Key for this method
      authorizationType: apigateway.AuthorizationType.CUSTOM,   // Use custom authorizer
      authorizer: requestAuthorizer,  // Attach the request-based Lambda authorize
      methodResponses: [
        {
          statusCode: '200',  // Successful response
          responseParameters: {
            'method.response.header.Content-Type': true,
            'method.response.header.Access-Control-Allow-Origin': true,  // CORS header
          },
        },
      ]
    });
    
    // Create an API key (auto-generated)
    const apiKey = api.addApiKey('DataProcApiKey', {
      apiKeyName: 'DataProcAutoGenerateApiKey',  // Optional: Specify a name
    });

    // Create a usage plan and associate the API key
    const usagePlan = api.addUsagePlan('UsagePlan', {
      name: 'BasicUsagePlan',
      throttle: {
        rateLimit: 100,  // Limit of 100 requests per second
        burstLimit: 200,  // Burst limit for rapid requests
      },
      quota: {
        limit: 10000,  // 10,000 requests per month
        period: apigateway.Period.MONTH,
      },
    });

    // Associate the API key with the usage plan
    usagePlan.addApiKey(apiKey);

    // Attach the usage plan to the API stage
    usagePlan.addApiStage({
      stage: api.deploymentStage,
      api: api
    });
    
    // Output the API Key
    new cdk.CfnOutput(this, 'ApiKeyOutput', {
      value: apiKey.keyId,  // Outputs the API Key ID
      description: 'The auto-generated API key',
    });
    
    // Create an SNS topic for CloudWatch Alarms
    const snsTopic = new sns.Topic(this, 'AlarmTopic', {
      displayName: 'Lambda Alarm Topic',
    });

    // Optionally, add an email subscription
    snsTopic.addSubscription(
      new sns_subscriptions.EmailSubscription('subhash.surana23@gmail.com')
    );

    // CloudWatch Invocation Errors Alarm

    const errorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      metric: lambdaFunction.metricErrors(),  // Metric for invocation errors
      threshold: 1,  // Alarm when there is more than 1 error
      evaluationPeriods: 1,  // How many evaluation periods before triggering the alarm
      datapointsToAlarm: 1,  // Alarm as soon as it detects 1 error
      alarmDescription: 'Alarm when the Lambda function returns an error',
      alarmName: 'LambdaInvocationErrorAlarm',
      actionsEnabled: true,  // Enable actions when alarm triggers
    });
    
    // Add SNS notification to error alarm
    errorAlarm.addAlarmAction({
      bind: () => ({ alarmActionArn: snsTopic.topicArn }),
    });

    // CloudWatch Duration Threshold Alarm

    const durationAlarm = new cloudwatch.Alarm(this, 'LambdaDurationAlarm', {
      metric: lambdaFunction.metricDuration(),  // Metric for function duration
      threshold: 5000,  // Duration in milliseconds (e.g., 5000 ms = 5 seconds)
      evaluationPeriods: 1,  // Trigger the alarm after one period
      datapointsToAlarm: 1,
      alarmDescription: 'Alarm when the Lambda function execution time exceeds 5 seconds',
      alarmName: 'LambdaDurationAlarm',
    });
    
    // Add SNS notification to duration alarm
    durationAlarm.addAlarmAction({
      bind: () => ({ alarmActionArn: snsTopic.topicArn }),
    });
    
    // CloudWatch Throttling Alarm

    const throttleAlarm = new cloudwatch.Alarm(this, 'LambdaThrottleAlarm', {
      metric: lambdaFunction.metricThrottles(),  // Metric for throttling
      threshold: 1,  // Alarm if throttling occurs
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      alarmDescription: 'Alarm when Lambda throttling occurs',
      alarmName: 'LambdaThrottleAlarm',
    });
    
    // Add SNS notification to throttle alarm
    throttleAlarm.addAlarmAction({
      bind: () => ({ alarmActionArn: snsTopic.topicArn }),
    });  
    } 
}
