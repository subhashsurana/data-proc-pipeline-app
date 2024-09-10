# CDK Data Processing Serverless Pipeline
## Overview

This repository contains a CDK (Cloud Development Kit) stack for a serverless data processing pipeline using AWS services. The pipeline accepts text file uploads via API Gateway, processes the files with AWS Lambda, and stores the processed data in DynamoDB.

## Architecture

   - API Gateway: Provides endpoints for file upload and triggers the Lambda function.
   - AWS Lambda: Processes the text files and interacts with DynamoDB.
   - DynamoDB: Stores the processed data.
   - CloudWatch Logs: Logs API Gateway and Lambda function activities.

## Prerequisites

1. AWS CLI: Ensure that you have AWS CLI installed and configured with appropriate permissions.
2. AWS CDK: Install AWS CDK globally via npm.

    ```bash 
    npm install -g aws-cdk
    ```

## Setup

1. ### Clone the Repository:

    ```bash
    git clone https://github.com/subhashsurana/data-proc-pipeline-app.git
    cd data-proc-pipeline-app
    ```
2. ### Install Dependencies:
    
    ```bash
    npm install
    ```


3. ### Synthesize the CDK Stack:

    ```bash
    cdk synth
    ```

4. ### Bootstrap the CDK Stack:

    ```bash
    cdk bootstrap
    ```

5. ### Deploy the CDK Stack:

    ```bash
    cdk deploy
    ```

## Fetch Access Token from Cognito User Pool

1. Initiate Authentication: Replace `<UserPoolClientId>`, `<Username>`, and `<Password>` with your Cognito User Pool client ID, username, and password respectively.

    ```bash
    aws cognito-idp initiate-auth \
        --client-id <UserPoolClientId> \
        --auth-flow USER_PASSWORD_AUTH \
        --auth-parameters \
        USERNAME=<Username>,PASSWORD=<Password> \
        --output json
    ```


2. Extract Access Token: The command will return JSON with the AuthenticationResult object containing the AccessToken. Extract it from the AccessToken field:
    
    ```bash
        {
            "AuthenticationResult": {
            "AccessToken": "<access-token>",
            ...
            }
        }
    ```

## API Testing with cURL

  1. Make a POST Request: Replace `<access-token>` with the token fetched above and `<api-endpoint>` with your API Gateway endpoint.

        ```bash
        curl -X POST <api-endpoint>
            -H "Authorization: Bearer <access-token>" \
            -H "Content-Type: text/plain"
        ```
    
- `-X POST`: Specifies the request method.
- `-H "Authorization: Bearer <access-token>"`: Sets the - Authorization header with the API key.
- `-H "Content-Type: application/json"`: Sets the Content-Type header for JSON data.

## API Gateway

    Endpoint: /prod/dataproc (for file upload)
    Binary Media Types: Enabled for text/plain

## Lambda Function

    Functionality: Processes uploaded files and interacts with DynamoDB.

## DynamoDB

    Table: Stores the processed data with proper data format handling.

## Troubleshooting

    Access Token Issues: Verify the correct credentials and client ID are used in the Cognito authentication command.











The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
