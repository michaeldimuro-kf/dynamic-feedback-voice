// setup.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serverEnvPath = path.join(__dirname, 'server', '.env');

// Create readline interface to get user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n=== Korn Ferry Live Feedback Setup ===\n');

// Check if .env file already exists
if (fs.existsSync(serverEnvPath)) {
  console.log('Server .env file already exists.');
  
  rl.question('Do you want to update the OpenAI API key? (y/N): ', (answer) => {
    if (answer.toLowerCase() === 'y') {
      promptForApiKey();
    } else {
      console.log('Keeping existing configuration.');
      exitSetup();
    }
  });
} else {
  console.log('No server .env file found.');
  promptForApiKey();
}

function promptForApiKey() {
  rl.question('Enter your OpenAI API key: ', (apiKey) => {
    if (!apiKey.trim()) {
      console.log('API key cannot be empty. Aborting setup.');
      exitSetup();
      return;
    }
    
    // Create .env file with the API key
    const envContent = `OPENAI_API_KEY=${apiKey.trim()}\n`;
    
    try {
      fs.writeFileSync(serverEnvPath, envContent);
      console.log('\nOpenAI API key has been saved to server/.env');
      console.log('\nSetup complete! You can now run:');
      console.log('  npm run dev    - To start development servers');
      console.log('  npm run build  - To build the application');
      console.log('  npm run start  - To run production build');
      exitSetup();
    } catch (error) {
      console.error('Error writing to .env file:', error.message);
      exitSetup();
    }
  });
}

function exitSetup() {
  rl.close();
}

// Handle readline close
rl.on('close', () => {
  console.log('\nThank you for using Korn Ferry Live Feedback!\n');
  process.exit(0);
}); 