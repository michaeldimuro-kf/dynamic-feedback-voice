// Direct WebSocket test script
require('dotenv').config();
const WebSocket = require('ws');
const fs = require('fs');

// Get API key from environment variables
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';

if (!apiKey) {
  console.error('Error: OPENAI_API_KEY is not defined in the environment variables.');
  console.error('Make sure you have a .env file with your OpenAI API key.');
  process.exit(1);
}

// Create a log file for all communication
const logFile = fs.createWriteStream('ws-direct-test.log');
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}`;
  console.log(logMessage);
  logFile.write(logMessage + '\n');
}

log('Starting WebSocket connection test with exact service options...');
log(`API Key: ${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 4)}`);
log(`Model: ${model}`);

const url = `wss://api.openai.com/v1/realtime?model=${model}`;
log(`Connecting to: ${url}`);

// Exactly match the options we're using in the service
const ws = new WebSocket(url, {
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'OpenAI-Beta': 'realtime=v1'
  },
  handshakeTimeout: 30000 // 30 seconds
});

// Set up connection events with detailed logging
ws.on('open', () => {
  log('✅ WebSocket connection established successfully!');
  
  // Send initial system message as per documentation
  const initialMessage = {
    type: "message",
    message: {
      role: "system",
      content: "You are a helpful assistant."
    }
  };
  
  log(`Sending initial message: ${JSON.stringify(initialMessage)}`);
  ws.send(JSON.stringify(initialMessage));
  
  // Send a test user message after 2 seconds
  setTimeout(() => {
    const userMessage = {
      type: "message",
      message: {
        role: "user",
        content: "Hello, how are you today?"
      }
    };
    log(`Sending user message: ${JSON.stringify(userMessage)}`);
    ws.send(JSON.stringify(userMessage));
  }, 2000);
});

ws.on('message', (data) => {
  try {
    if (data instanceof Buffer) {
      log(`Received binary data: ${data.length} bytes`);
      log(`First bytes: ${data.slice(0, 16).toString('hex')}`);
      
      // Try to parse the buffer as UTF-8 text
      try {
        const textData = data.toString('utf8');
        log(`Buffer as text: ${textData.substring(0, 500)}...`);
        
        // Try to parse as JSON
        try {
          const jsonData = JSON.parse(textData);
          log(`Parsed binary as JSON: ${JSON.stringify(jsonData, null, 2)}`);
        } catch (e) {
          log(`Failed to parse binary as JSON: ${e.message}`);
        }
      } catch (e) {
        log(`Failed to convert buffer to text: ${e.message}`);
      }
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

ws.on('error', (error) => {
  log(`❌ WebSocket error:`);
  log(`Error message: ${error.message}`);
  
  if (error.code) {
    log(`Error code: ${error.code}`);
  }
  
  log(`WebSocket ready state: ${ws.readyState}`);
  
  if (error.message && error.message.includes('401')) {
    log('⚠️ This might be an authentication issue. Please verify your OpenAI API key.');
  }
  
  if (error.message && error.message.includes('404')) {
    log('⚠️ The WebSocket URL might be incorrect or the model may not be available.');
  }
});

ws.on('close', (code, reason) => {
  log(`WebSocket closed: code=${code}, reason=${reason || 'No reason provided'}`);
  
  // Decode WebSocket close codes
  switch(code) {
    case 1000:
      log('Normal closure - the connection successfully completed');
      break;
    case 1001:
      log('Endpoint going away - server or client is terminating');
      break;
    case 1002:
      log('Protocol error - endpoint received a malformed frame');
      break;
    case 1003:
      log('Unsupported data - endpoint received data of a type it cannot accept');
      break;
    case 1006:
      log('Abnormal closure - connection was closed abnormally (no close frame sent)');
      break;
    case 1007:
      log('Invalid frame payload data - message contained invalid data');
      break;
    case 1008:
      log('Policy violation - received a message that violates policy');
      break;
    case 1009:
      log('Message too big - message too large to process');
      break;
    case 1010:
      log('Missing extension - client expected server to negotiate extension(s)');
      break;
    case 1011:
      log('Internal error - server encountered an unexpected condition');
      break;
    case 1012:
      log('Service restart - server restarting');
      break;
    case 1013:
      log('Try again later - server temporarily unavailable');
      break;
    case 1015:
      log('TLS handshake failure - connection closed due to TLS handshake failure');
      break;
    default:
      log(`Unknown close code: ${code}`);
  }
  
  // Close the log file and exit
  logFile.end();
});

// Set a timeout to close the connection after 30 seconds
setTimeout(() => {
  log('Test complete, closing connection...');
  if (ws.readyState === WebSocket.OPEN) {
    ws.close(1000, 'Test complete');
  }
  
  // Force exit after another 5 seconds if the connection doesn't close
  setTimeout(() => {
    log('Forcing process exit');
    process.exit(0);
  }, 5000);
}, 30000);

// Log connection attempt
log('WebSocket connection attempt initiated. Waiting for events...'); 
