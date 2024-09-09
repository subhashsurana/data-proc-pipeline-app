import { APIGatewayRequestAuthorizerEvent, APIGatewayAuthorizerResult, PolicyDocument } from 'aws-lambda';
import * as AWS from 'aws-sdk';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

// Initialize the API Gateway client
const apiGateway = new AWS.APIGateway();

// Define the Cognito User Pool ID and Client ID (can be passed as environment variables)
const userPoolId = process.env.USER_POOL_ID || '';
const clientId = process.env.USER_POOL_CLIENT_ID || '';

// Create a Cognito JWT Verifier
const cognitoJwtVerifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USERPOOL_ID || '',
  clientId: process.env.CLIENT_ID || '',  // Ensure the clientId is set properly
  tokenUse: 'access',  // Verifies access tokens (you can use 'id' for ID tokens)
})

// Function to verify JWT token and return 'Allow' or 'Deny'
const verifyTokenAndGenerateEffect = async (authToken: string) => {
  try {
    // Verify the token using Cognito JWT Verifier
    const decodedJWT = await cognitoJwtVerifier.verify(authToken);

    // Token is valid, return 'Allow' and the decoded JWT (for context)
    console.log('Token is valid:', decodedJWT);
    return {
      effect: 'Allow' as 'Allow',  // Type assertion
      context: {
        userId: decodedJWT.sub,  // Subject (user ID) from the JWT
        email: typeof decodedJWT.email === 'string' ? decodedJWT.email : '',                        // Email from the JWT (if present)
        role: typeof decodedJWT['custom:role'] === 'string' ? decodedJWT['custom:role'] : 'USER',   // Custom role, if provided
      },
    };
  } catch (error) {
    // Token is invalid, return 'Deny' and default context
    console.error('Token verification failed:', error);
    return {
      effect: 'Deny' as 'Deny',  // Type assertion
      context: {
        userId: 'anonymous',
        role: 'GUEST',
      },
    };
  }
};

// Helper function to generate an IAM policy
const generatePolicy = (principalId: string, effect: 'Allow' | 'Deny', resource: string): PolicyDocument => {
  if (!principalId || !effect || !resource) {
    throw new Error("Missing required parameters for policy generation");
  }
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource,
      },
    ],
  };
};

// Lambda authorizer function
export const handler = async (event: APIGatewayRequestAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  
  console.log(`Event => ${JSON.stringify(event)}`);
// Extract the Authorization token from the headers
  const authToken = event.headers?.['authorization']?.split(' ')[1];  // Expecting a Bearer token

  if (!authToken) {
    console.error('No auth token found in request.');
    throw new Error('Unauthorized');
  }

  try 
  {
    // Determine the Effect (Allow or Deny) based on the token's validity
    const { effect, context }  = await verifyTokenAndGenerateEffect(authToken);

    // Generate the policy using the determined effect
    const policyDocument = generatePolicy(context.userId, effect, event.methodArn);

    // Construct the full response for API Gateway Authorizer
    const response: APIGatewayAuthorizerResult = {
      principalId: context.userId,          // Use the userId from the JWT context or 'anonymous'
      policyDocument,                       // The generated IAM policy
      context,                              // Attach custom context for further use in the backend
    };

    console.log(`Generated Authorizer Response: ${JSON.stringify(response)}`);
    return response;

  } catch (error) {
    console.error('Token verification failed:', error);
    throw new Error('Unauthorized');  // Return Unauthorized if token is invalid
  }
};


