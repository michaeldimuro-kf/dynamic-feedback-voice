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

# LiveFeedback - Real-time Voice Chat with OpenAI

A real-time voice chat application that uses OpenAI's Realtime API to enable speech-to-speech conversations with an AI assistant.

## Features

- Real-time voice conversations with OpenAI's GPT-4o Realtime model
- Audio visualization during recording
- WebSocket communication between client and server
- Custom system prompts for tailored AI responses
- Keyboard shortcuts (spacebar) for hands-free recording

## Prerequisites

- Node.js v18+
- npm or yarn
- OpenAI API key with access to Realtime API (GPT-4o Realtime Preview)

## Setup

### Environment Variables

1. Server:
   Create a `.env` file in the `server` directory with the following:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   CLIENT_URL=http://localhost:5173
   DEBUG_MODE=true
   PORT=3000
   ```

2. Client:
   Create a `.env` file in the `client` directory with the following:
   ```
   VITE_SERVER_URL=http://localhost:3000
   VITE_DEBUG_SOCKET=true
   VITE_DEBUG_WEBRTC=true
   ```

### Installation

1. Clone the repository
   ```
   git clone https://github.com/yourusername/LiveFeedback.git
   cd LiveFeedback
   ```

2. Install server dependencies
   ```
   cd server
   npm install
   ```

3. Install client dependencies
   ```
   cd ../client
   npm install
   ```

### Running the Application

1. Start the server
   ```
   cd server
   npm run start:dev
   ```

2. Start the client
   ```
   cd client
   npm run dev
   ```

3. Open your browser and navigate to `http://localhost:5173`

## Usage

1. Click the microphone button or press the spacebar to start recording
2. Speak clearly into your microphone
3. Click the button again or press spacebar to stop recording
4. The AI will process your speech and respond both in text and audio

## System Prompt

You can customize the AI's behavior by modifying the system prompt. Click on "Show System Prompt" to view and edit the default prompt.

## Troubleshooting

- Make sure your browser has permission to access your microphone
- Check browser console for any error messages
- Verify your OpenAI API key has access to the Realtime API
- Ensure both client and server are running

## License

MIT 