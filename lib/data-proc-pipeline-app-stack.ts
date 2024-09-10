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
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';

export class DataProcPipelineAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    
     // Create a Cognito User Pool
     const userPool = new cognito.UserPool(this, 'MyUserPool', {
      selfSignUpEnabled: true,          // Allow users to sign up on their own
      signInAliases: { email: true, },  // Allow users to sign in with their email
      autoVerify: { email: true, },     // Verify users' email addresses automatically
      passwordPolicy: {
        minLength: 8,
        requireSymbols: false,
      },
    });

    // Create an App Client for the User Pool (without a client secret)
    const userPoolClient = new cognito.UserPoolClient(this, 'MyUserPoolClient', {
      userPool,
      generateSecret: false,       // Do not use a client secret for easier integration with API Gateway
      authFlows: {
        userPassword: true,       // Enable USER_PASSWORD_AUTH flow
        adminUserPassword: true,  // Optionally enable admin-based password auth flow
        userSrp: true
      },
    });

    // DynamoDB Table
    const table = new dynamodb.Table(this, 'ProcessedData', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,  // For dev/testing; use RETAIN for production
      encryption: dynamodb.TableEncryption.AWS_MANAGED
    });

    // Create a custom IAM role with only PutItem permission for DynamoDB
    const fileProcessorRole = new iam.Role(this, 'FileProcessorCustomRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),  // Lambda service principal
    });

    // Attach least privilege policy to the fileProcessorRole
    fileProcessorRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem'],             // Only allow PutItem action
      resources: [table.tableArn],               // Restrict access to the specific table
    }));

    // Allow the Lambda function to write logs to CloudWatch
    fileProcessorRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));


    // Lambda Function for processing API Requests
    const lambdaFunction = new NodejsFunction(this, 'FileProcessor', {
      entry: path.join(__dirname, '../lambda/data-proc.ts'),  // Path to the TypeScript file
      handler: 'handler',                                     // Exported handler function
      runtime: lambda.Runtime.NODEJS_18_X,                    // Ensure it's Node.js 14.x or higher for modern JavaScript/TypeScript
      bundling: {
        minify: true,                                         // Optional: Minify the code to reduce bundle size
        nodeModules: ['aws-sdk','uuid'],                      // Ensure `uuid` is included in the bundle
      },
      environment: {
        TABLE_NAME: table.tableName,                          // Pass DynamoDB table name as an environment variable
      },
      role: fileProcessorRole
    });

    // Lambda function for the custom authorizer
    const authorizerLambda = new NodejsFunction(this, 'AuthorizerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',                                     // Authorizer Lambda function handler
      entry: path.join(__dirname, '../lambda/authorizer.ts'), // Path to the authorizer Lambda code
      bundling: {
        minify: true,                                         // Optional: Minify the code to reduce bundle size
        nodeModules: ['aws-sdk','aws-jwt-verify'],            // Ensure `uuid` is included in the bundle
      },
      environment: {
        USERPOOL_ID: userPool.userPoolId,
        CLIENT_ID: userPoolClient.userPoolClientId,
        NODE_OPTIONS: '--enable-source-maps',
      },
    });


    const logGroup = new logs.LogGroup(this, 'LambdaLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
    });

    
    // API Gateway to trigger Lambda
    const api = new apigateway.RestApi(this, 'DataProcessingAPI', {
      restApiName: 'DataProcessingAPI',
      description: 'API for uploading text files and processing them',
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      binaryMediaTypes: ['text/plain'],               // Enable binary uploads (text files)
      deployOptions: {
        stageName: 'prod',                                  // Deploy to the 'prod' stage
        // loggingLevel: apigateway.MethodLoggingLevel.INFO,   // Enable logging
        dataTraceEnabled: true,                             // Log full request/response data
        metricsEnabled: true,                               // Enable CloudWatch metrics
        throttlingRateLimit: 100,                           // 100 requests per second
        throttlingBurstLimit: 200,                          // Burst limit for rapid requests

      // // 👇 enable access logging to the log group we created above.        
      //   accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),  // 👈 enable access logging & send logs to the custom Log Group
      //   accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({    // Customize the log format
      //     caller: false,
      //     httpMethod: true,
      //     ip: true,
      //     protocol: true,
      //     requestTime: true,
      //     resourcePath: true,
      //     responseLength: true,
      //     status: true,
      //     user: true,
      //   }),  
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    
    // REQUEST-based Lambda authorizer that validates the Authorization from Header
    const customAuthorizer = new apigateway.RequestAuthorizer(this, 'RequestAuthorizer', {
      handler: authorizerLambda,                                              // Use the authorizer Lambda function
      identitySources: [apigateway.IdentitySource.header('authorization')],   // Validate authorization from header
      resultsCacheTtl: cdk.Duration.seconds(0),                               // Optional: No caching for development/testing
    });


    // Lambda Integration with API Gateway
    const lambdaIntegration = new apigateway.LambdaIntegration(lambdaFunction);
     
     
    // Attach the POST method with with Cognito Authorizer
    const dataResource = api.root.addResource('dataproc');
    dataResource.addMethod('POST', lambdaIntegration, {         // Add POST method
    // apiKeyRequired: true,                                     // Require API Key for this method
      authorizationType: apigateway.AuthorizationType.CUSTOM,  // Use Cognito authorizer
      authorizer: customAuthorizer,                            // Link the Cognito user pool to the authorizer
      methodResponses: [
        {
          statusCode: '200',                                   // Successful response
          responseParameters: {
            'method.response.header.Content-Type': true,
            'method.response.header.Access-Control-Allow-Origin': true,  // CORS header
          },
        },
      ]
    });

    // // Create an API key (auto-generated)
    // const apiKey = api.addApiKey('DataProcApiKey', {
    //   apiKeyName: 'DataProcAutoGenApiKey',  // Optional: Specify a name
    // });

    // // Create a usage plan and associate the API key
    // const usagePlan = api.addUsagePlan('UsagePlan', {
    //   name: 'BasicUsagePlan',
    //   throttle: {
    //     rateLimit: 100,  // Limit of 100 requests per second
    //     burstLimit: 200,  // Burst limit for rapid requests
    //   },
    //   quota: {
    //     limit: 10000,  // 10,000 requests per month
    //     period: apigateway.Period.MONTH,
    //   },
    // });

    // // Associate the API key with the usage plan
    // usagePlan.addApiKey(apiKey);

    // // Attach the usage plan to the API stage
    // usagePlan.addApiStage({
    //   stage: api.deploymentStage,
    // });


    // Output the User Pool and API information
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'The ID of the Cognito User Pool',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'The ID of the Cognito User Pool Client',
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url + 'dataproc',
      description: 'The API Gateway endpoint for the /dataproc resource',
    });

    // // Output the API Key
    // new cdk.CfnOutput(this, 'ApiKeyOutput', {
    // value: apiKey.keyId,  // Outputs the API Key ID
    // description: 'The auto-generated API key',
    // });
      
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
      metric: lambdaFunction.metricErrors(),        // Metric for invocation errors
      threshold: 1,                                 // Alarm when there is more than 1 error
      evaluationPeriods: 1,                         // How many evaluation periods before triggering the alarm
      datapointsToAlarm: 1,                         // Alarm as soon as it detects 1 error
      alarmDescription: 'Alarm when the Lambda function returns an error',
      alarmName: 'LambdaInvocationErrorAlarm',
      actionsEnabled: true,                         // Enable actions when alarm triggers
    });
    
    // Add SNS notification to error alarm
    errorAlarm.addAlarmAction({
      bind: () => ({ alarmActionArn: snsTopic.topicArn }),
    });

    // CloudWatch Duration Threshold Alarm

    const durationAlarm = new cloudwatch.Alarm(this, 'LambdaDurationAlarm', {
      metric: lambdaFunction.metricDuration(),       // Metric for function duration
      threshold: 5000,                               // Duration in milliseconds (e.g., 5000 ms = 5 seconds)
      evaluationPeriods: 1,                          // Trigger the alarm after one period
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
      metric: lambdaFunction.metricThrottles(),     // Metric for throttling
      threshold: 1,                                 // Alarm if throttling occurs
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
