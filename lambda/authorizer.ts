import { APIGatewayRequestAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';
import * as AWS from 'aws-sdk';

// Initialize the API Gateway client
const apiGateway = new AWS.APIGateway();

// Helper function to generate an IAM policy
const generatePolicy = (principalId: string, effect: 'Allow' | 'Deny', resource: string, usageIdentifierKey: string): APIGatewayAuthorizerResult => {
  if (!principalId || !effect || !resource) {
    throw new Error("Missing required parameters for policy generation");
  }

  const policy = {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource,
      }],
    },
    "usageIdentifierKey": usageIdentifierKey
  };
  
  console.log('Generated IAM Policy:', JSON.stringify(policy, null, 2)); // Debugging log to verify policy

  return policy; 
};

// Function to validate the API Key
const validateApiKey = async (apiKey: string): Promise<{ id: string, name: string, enabled: boolean } | null> => {
  try {
    console.log(`Validating API Key: ${apiKey}`);  // Debug: Log API Key being validated

    const response = await apiGateway.getApiKey({
      apiKey: apiKey,
      includeValue: true,
    }).promise();

    // Print the response for debugging
    console.log('API Key Validation Response:', JSON.stringify(response));
    
    // If the API key is valid and active, return true  
    if (response.enabled === true) {
      return {
        id: response.id ?? '',
        name: response.name ?? '',
        enabled: response.enabled,
      };
    } else {
      return null;  // Return null if the API key is not enabled
    }
  } catch (error) {
    console.error('Error validating API key:', error);
    return null;  // Return null if the API key is invalid or an error occurs
  }
};

// Lambda authorizer function to validate the request using the x-api-key
export const handler = async (event: APIGatewayRequestAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  console.log('Event:', JSON.stringify(event));

  // Check for the x-api-key header
  const apiKey = event.headers?.['x-api-key'];
  // Define the method ARN
  const methodArn = event.methodArn;
  console.log("The apiKey value: ", apiKey)
  console.log("The event Method ARN value: ", methodArn)
  
  if (!apiKey) {
    console.error('No API Key provided');
    return generatePolicy('anonymous', 'Deny', methodArn,'');
  }

  // Validate the API key with API Gateway
  const isValidApiKey = await validateApiKey(apiKey);

  
  if (isValidApiKey) {
    // If the API key is valid, allow access

      // Set the principalId as the API key name or ID
      const principalId = 'user' ;  
    console.log('API Key is valid. Allowing access.');
    return generatePolicy(principalId, 'Allow', methodArn, isValidApiKey.id);
  } else {
    // If the API key is invalid, deny access
    console.log('API Key is invalid. Denying access.');
    return generatePolicy('anonymous', 'Deny', methodArn, '');
  }
};
