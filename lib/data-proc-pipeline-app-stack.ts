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
import * as logs from 'aws-cdk-lib/aws-logs';


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
