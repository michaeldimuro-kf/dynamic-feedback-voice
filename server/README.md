# Korn Ferry Live Feedback - Server

This is the backend application for the Korn Ferry Live Feedback system. It handles voice processing, OpenAI API integration, and WebSocket communication.

## Technologies Used

- NestJS
- TypeScript
- Socket.io
- OpenAI API (Whisper, GPT-4, TTS)
- FFmpeg for audio conversion

## Features

- WebSocket communication with the client
- Audio file processing and conversion
- Speech-to-text transcription using OpenAI Whisper
- AI response generation using OpenAI GPT-4
- Text-to-speech conversion using OpenAI TTS

## Prerequisites

- Node.js 16+
- npm 8+
- FFmpeg (installed via npm dependencies)
- An OpenAI API key

## Installation

1. Clone the repository
2. Navigate to the server directory
3. Install dependencies:

```bash
npm install
```

4. Configure your `.env` file with your OpenAI API key:

```
OPENAI_API_KEY=your_api_key_here
```

## Development

To start the development server:

```bash
npm run start:dev
```

This will start the NestJS server in development mode with auto-reload on port 3000.

## Building for Production

To build the application for production:

```bash
npm run build
```

To run the production build:

```bash
npm run start:prod
```

## API Documentation

The server exposes the following WebSocket endpoints:

- `streaming-audio`: Receives audio chunks from the client
- `transcription`: Sends transcription results to the client
- `audio-response`: Sends audio response chunks to the client

## Notes

- The server uses FFmpeg for audio conversion, which is installed as an npm dependency.
- The OpenAI API is used for speech-to-text, text generation, and text-to-speech functionality. Make sure you have sufficient credits and appropriate API access. 