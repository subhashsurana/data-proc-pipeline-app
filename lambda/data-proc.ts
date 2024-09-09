import { DynamoDB } from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';

const dynamo = new DynamoDB.DocumentClient();

// Helper function to process text file content
const processTextFile = (fileContent: string): { id: string; content: string }[] => {
  // Split the file content into lines
  const lines = fileContent.split('\n').map((line) => line.trim());
  
  // Process each line and return it in an array
  return lines
  .filter(line => line.length > 0) // Filter out empty lines
  .map((line) => ({
    id: uuidv4(),
    content: line,
  }));
};

// Define Lambda handler
export const handler = async (event: any): Promise<any> => {
  try {
    // API Gateway sometimes sends the file as base64-encoded binary data in event.body
    
    let fileBuffer;

    if (event.isBase64Encoded) {                       // Check if the data is base64 encoded
      fileBuffer = Buffer.from(event.body, 'base64');
    } else {
      fileBuffer = Buffer.from(event.body);
    }
    const fileContent = fileBuffer.toString('utf-8');  // Convert buffer to string (text file)

    // Process the file content
    const processedData = processTextFile(fileContent);

    // Store each processed line in DynamoDB
    for (const item of processedData) {
      await dynamo.put({
        TableName: process.env.TABLE_NAME!,
        Item: item,
      }).promise();
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'File processed and data stored successfully!' }),
    };
  } catch (error) {
    console.error('Error processing file:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process the file' }),
    };
  }
};
