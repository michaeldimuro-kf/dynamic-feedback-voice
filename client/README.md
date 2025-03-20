# Korn Ferry Live Feedback - Client

This is the frontend application for the Korn Ferry Live Feedback system. It allows users to upload PDF documents and interact with them using voice commands.

## Technologies Used

- React
- TypeScript
- Vite
- Tailwind CSS
- Zustand (state management)
- PDF.js (PDF rendering)
- Socket.io (real-time communication)

## Features

- Upload and view PDF documents
- Navigation and zoom controls for PDF viewing
- Voice recording and processing
- Real-time transcription display
- Audio response playback

## Prerequisites

- Node.js 16+
- npm 8+
- A modern browser with WebRTC support

## Installation

1. Clone the repository
2. Navigate to the client directory
3. Install dependencies:

```bash
npm install
```

## Development

To start the development server:

```bash
npm run dev
```

This will start the Vite development server, which by default runs on port 5173.

## Building for Production

To build the application for production:

```bash
npm run build
```

This will create optimized production files in the `dist` directory.

## Configuration

The application is configured to connect to a NestJS backend running on `http://localhost:3000`. If you need to change this, update the `SOCKET_URL` constant in `src/hooks/useSocket.ts` and the proxy settings in `vite.config.ts`.

## Notes

- Make sure the backend server is running before starting the client application.
- The application uses the MediaRecorder API for audio recording, which may not be supported in all browsers. A polyfill is included for browsers like Safari.
- PDF.js is used for rendering PDF documents. The worker script is loaded from a CDN.
