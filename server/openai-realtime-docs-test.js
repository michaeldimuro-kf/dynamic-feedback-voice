// Test script based on official OpenAI Realtime API documentation
// https://platform.openai.com/docs/guides/realtime#connect-with-websockets
require('dotenv').config();
const WebSocket = require('ws');
const fs = require('fs');

// Get API key from environment variables
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error('Error: OPENAI_API_KEY is not defined in the environment variables.');
  console.error('Make sure you have a .env file with your OpenAI API key.');
  process.exit(1);
}

// Create a log file for all communication
const logFile = fs.createWriteStream('openai-realtime-docs-test.log');
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}`;
  console.log(logMessage);
  logFile.write(logMessage + '\n');
}

log('Starting OpenAI Realtime API test using official documentation parameters...');
log(`Using API key: ${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 4)}`);

// Test the WebSocket connection according to documentation
async function testWebSocketConnection() {
  // Exact WebSocket URL from documentation
  const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
  
  log(`Connecting to WebSocket endpoint: ${url}`);
  log('Using headers: Authorization: Bearer *****, OpenAI-Beta: realtime=v1');
  
  return new Promise((resolve) => {
    // Connect to WebSocket with specified headers
    const ws = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });
    
    // Set a timeout (30 seconds)
    const timeoutId = setTimeout(() => {
      log('Connection timeout after 30 seconds');
      if (ws.readyState !== WebSocket.CLOSED) {
        ws.close();
      }
      resolve(false);
    }, 30000);
    
    // Connection opened handler
    ws.on('open', () => {
      log('✅ WebSocket connection established successfully!');
      clearTimeout(timeoutId);
      
      // Send system message as per documentation
      log('Sending system message...');
      const systemMessage = {
        type: "message",
        message: {
          role: "system",
          content: "You are a helpful assistant."
        }
      };
      
      ws.send(JSON.stringify(systemMessage));
      log(`Sent message: ${JSON.stringify(systemMessage)}`);
      
      // Send a user message after 2 seconds
      setTimeout(() => {
        log('Sending user message...');
        const userMessage = {
          type: "message", 
          message: {
            role: "user",
            content: "Hello, can you hear me?"
          }
        };
        
        ws.send(JSON.stringify(userMessage));
        log(`Sent message: ${JSON.stringify(userMessage)}`);
        
        // Send some audio data after another 2 seconds
        setTimeout(() => {
          log('Sending audio data...');
          // Create a simple audio packet (just random data for testing)
          const audioData = Buffer.from(new Uint8Array(1000));
          ws.send(audioData);
          log(`Sent audio data: ${audioData.length} bytes`);
        }, 2000);
      }, 2000);
    });
    
    // Message handler
    ws.on('message', (data) => {
      try {
        if (data instanceof Buffer) {
          log(`Received binary data: ${data.length} bytes`);
          log(`First bytes: ${data.slice(0, 16).toString('hex')}`);
        } else {
          const messageStr = data.toString();
          log(`Received message: ${messageStr}`);
          
          try {
            const parsedData = JSON.parse(messageStr);
            log(`Parsed data: ${JSON.stringify(parsedData, null, 2)}`);
          } catch (e) {
            log(`Failed to parse as JSON: ${e.message}`);
          }
        }
      } catch (err) {
        log(`Error processing message: ${err.message}`);
      }
    });
    
    // Error handler
    ws.on('error', (error) => {
      log(`❌ WebSocket error: ${error.message}`);
      if (error.code) {
        log(`Error code: ${error.code}`);
      }
      clearTimeout(timeoutId);
      resolve(false);
    });
    
    // Close handler
    ws.on('close', (code, reason) => {
      log(`WebSocket closed: ${code} ${reason || 'No reason provided'}`);
      clearTimeout(timeoutId);
      
      // Wait 3 seconds before considering the test complete
      setTimeout(() => {
        resolve(true);
      }, 3000);
    });
    
    // Close the connection after 30 seconds
    setTimeout(() => {
      log('Test complete, closing connection...');
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }, 30000);
  });
}

// Main function
async function main() {
  log('Starting test...');
  const result = await testWebSocketConnection();
  log(`Test completed with result: ${result ? 'SUCCESS' : 'FAILURE'}`);
  logFile.end();
}

// Run the test
main(); 