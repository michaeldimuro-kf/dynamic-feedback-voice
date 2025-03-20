# Korn Ferry Live Feedback

A voice-enabled application that allows users to interact with PDF documents through speech. The application transcribes user questions, generates AI responses about the document content, and reads the responses back using text-to-speech.

## Project Structure

This project is divided into two main parts:

1. **Client**: A React-based frontend application built with Vite, TypeScript, and Tailwind CSS
2. **Server**: A NestJS backend application that handles speech processing and AI integration

## Features

- PDF document viewing with navigation and zoom controls
- Voice recording and real-time transcription
- AI-powered responses to questions about document content
- Text-to-speech audio responses
- Real-time communication using WebSockets

## Getting Started

### Prerequisites

- Node.js 16+
- npm 8+
- An OpenAI API key

### Installation and Setup

#### Quick Setup

```bash
# Install all dependencies for server, client, and root
npm run install:all

# Run the setup script to configure your OpenAI API key
npm run setup

# Start both client and server in development mode
npm run dev
```

#### Manual Setup

If you prefer to set up each component separately:

##### 1. Server Setup

```bash
# Navigate to the server directory
cd server

# Install dependencies
npm install

# Configure your OpenAI API key in .env
echo "OPENAI_API_KEY=your_api_key_here" > .env

# Start the development server
npm run start:dev
```

The server will run on http://localhost:3000.

##### 2. Client Setup

```bash
# Open a new terminal
# Navigate to the client directory
cd client

# Install dependencies
npm install

# Start the development server
npm run dev
```

The client will run on http://localhost:5173.

### Available Scripts

The project now includes scripts to run both client and server simultaneously:

- `npm run dev` - Start both client and server in development mode
- `npm run start` - Build and start both client and server in production mode
- `npm run build` - Build both client and server for production
- `npm run install:all` - Install dependencies for root, client, and server

## Usage

1. Open the client application in your browser at http://localhost:5173
2. Upload a PDF document using the "Upload PDF" button
3. Press and hold the microphone button or spacebar to record your question
4. Release to send the audio for processing
5. Listen to the AI's response

## Development

Both the client and server applications include comprehensive READMEs with more detailed information about their structure, configuration, and development workflows.

- [Client README](./client/README.md)
- [Server README](./server/README.md)

## Technologies Used

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, Zustand, PDF.js, Socket.io-client
- **Backend**: NestJS, TypeScript, Socket.io, OpenAI API, FFmpeg
- **AI**: OpenAI Whisper (speech-to-text), GPT-4 (text generation), OpenAI TTS (text-to-speech)

## License

This project is licensed under the MIT License - see the LICENSE file for details. 