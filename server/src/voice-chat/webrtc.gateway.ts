import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { WebRTCService } from './webrtc.service';
import { v4 as uuidv4 } from 'uuid';

interface WebRTCSession {
  id: string;
  openaiSessionId: string;
  clientSocket: Socket;
  state: 'initializing' | 'connecting' | 'connected' | 'disconnected';
  created: Date;
  lastActivity: Date;
}

interface RealtimeSession {
  clientSocket: Socket;
  state: 'initializing' | 'connecting' | 'connected' | 'disconnected';
  config: {
    voice: string;
    modalities: string[];
    input_audio_format: string;
    output_audio_format: string;
    [key: string]: any;
  };
  modelConnection?: WebSocket;
  lastActivity: Date;
  initialPrompt?: string;
  lastAssistantItem?: string;
  responseStartTimestamp?: number;
  latestMediaTimestamp?: number;
  clientCallbacks: {
    onEvent: (event: any) => void;
  };
}

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:5173', process.env.CLIENT_URL].filter(Boolean),
    credentials: true
  }
})
@Injectable()
export class WebRTCGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  
  private readonly logger = new Logger(WebRTCGateway.name);
  private readonly sessions = new Map<string, WebRTCSession>();
  private readonly realtimeSessions = new Map<string, RealtimeSession>();
  
  constructor(private readonly webrtcService: WebRTCService) {
    this.logger.log('WebRTC Gateway initialized');
    
    // Set up session cleanup interval
    setInterval(() => this.cleanupInactiveSessions(), 60000); // Check every minute
  }
  
  /**
   * Handle client connection
   * @param client Client socket
   */
  handleConnection(client: Socket) {
    try {
      this.logger.log(`Client connected: ${client.id}`);
      
      // Log connection details
      const handshake = client.handshake;
      this.logger.log(`Connection from ${handshake.address} with transport ${handshake.headers['user-agent'] || 'unknown agent'}`);
      this.logger.log(`Socket.io transport used: ${client.conn.transport.name}`);
      
      // Emit connection confirmation
      client.emit('connection-established', { 
        clientId: client.id,
        serverTime: new Date().toISOString(),
        message: 'Connected to WebRTC gateway'
      });
      
      // Set up ping/pong for keeping connection alive
      const pingInterval = setInterval(() => {
        if (client.connected) {
          client.emit('ping');
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);
      
      // Add cleanup when disconnected
      client.on('disconnect', () => {
        clearInterval(pingInterval);
      });
    } catch (error) {
      this.logger.error(`Error handling client connection: ${error.message}`);
    }
  }
  
  /**
   * Handle client disconnection
   * @param client Client socket
   */
  handleDisconnect(client: Socket) {
    try {
      this.logger.log(`Client disconnected: ${client.id}`);
      
      // Find and cleanup any associated sessions
      let sessionsRemoved = 0;
      
      // Check WebRTC sessions
      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.clientSocket.id === client.id) {
          this.logger.log(`Cleaning up WebRTC session ${sessionId} for disconnected client ${client.id}`);
          this.cleanupSession(sessionId).catch(err => {
            this.logger.error(`Error cleaning up session ${sessionId}: ${err.message}`);
          });
          sessionsRemoved++;
        }
      }
      
      // Check realtime sessions
      for (const [sessionId, session] of this.realtimeSessions.entries()) {
        if (session.clientSocket.id === client.id) {
          this.logger.log(`Cleaning up Realtime session ${sessionId} for disconnected client ${client.id}`);
          this.cleanupRealtimeSession(sessionId).catch(err => {
            this.logger.error(`Error cleaning up realtime session ${sessionId}: ${err.message}`);
          });
          sessionsRemoved++;
        }
      }
      
      this.logger.log(`Cleaned up ${sessionsRemoved} sessions for disconnected client ${client.id}`);
    } catch (error) {
      this.logger.error(`Error handling client disconnection: ${error.message}`);
    }
  }
  
  /**
   * Clean up inactive sessions
   */
  private cleanupInactiveSessions() {
    const now = new Date();
    const maxInactivityMs = 10 * 60 * 1000; // 10 minutes
    
    // Clean up WebRTC sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      const inactiveTimeMs = now.getTime() - session.lastActivity.getTime();
      
      if (inactiveTimeMs > maxInactivityMs) {
        this.logger.log(`Cleaning up inactive session: ${sessionId} (inactive for ${Math.round(inactiveTimeMs / 1000)}s)`);
        this.cleanupSession(sessionId).catch(err => {
          this.logger.error(`Error cleaning up inactive session ${sessionId}:`, err);
        });
      }
    }
    
    // Clean up realtime sessions
    for (const [sessionId, session] of this.realtimeSessions.entries()) {
      const inactiveTimeMs = now.getTime() - session.lastActivity.getTime();
      
      if (inactiveTimeMs > maxInactivityMs) {
        this.logger.log(`Cleaning up inactive realtime session: ${sessionId} (inactive for ${Math.round(inactiveTimeMs / 1000)}s)`);
        this.cleanupRealtimeSession(sessionId).catch(err => {
          this.logger.error(`Error cleaning up inactive realtime session ${sessionId}:`, err);
        });
      }
    }
  }
  
  /**
   * Initialize a new voice chat session
   */
  @SubscribeMessage('start-session')
  async handleSessionStart(
    @MessageBody() data: { model?: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const sessionId = crypto.randomUUID();
      
      this.logger.log(`Creating new session: ${sessionId} for client: ${client.id}`);
      
      // Create the session
      this.sessions.set(sessionId, {
        id: sessionId,
        openaiSessionId: null, // Will be set when connecting to OpenAI
        clientSocket: client,
        state: 'initializing',
        created: new Date(),
        lastActivity: new Date()
      });
      
      // Return session information to client
      return {
        sessionId,
        status: 'created',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Error creating session:', error);
      return {
        error: error.message || 'Failed to create session',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
  }
  
  /**
   * Start a Realtime session
   */
  @SubscribeMessage('start-realtime-session')
  async handleStartRealtimeSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { initialPrompt?: string }
  ): Promise<void> {
    try {
      const sessionId = client.id;
      this.logger.log(`Received start-realtime-session request from client ${client.id}`);
      this.logger.log(`Using session ID: ${sessionId}, Initial prompt length: ${data?.initialPrompt?.length || 0}`);
      
      // Create the session if it doesn't exist
      if (!this.webrtcService.hasRealtimeSession(sessionId)) {
        this.logger.log(`Creating new Realtime session for client ${sessionId}`);
        const created = this.webrtcService.createRealtimeSession(sessionId);
        if (!created) {
          this.logger.error(`Failed to create Realtime session for client ${sessionId}`);
          client.emit('realtime-session-created', { 
            success: false, 
            error: 'Failed to create session' 
          });
          this.logger.log(`Sent failure response to client ${client.id}`);
          return;
        }
        this.logger.log(`Created new Realtime session with ID: ${sessionId}`);
      } else {
        this.logger.log(`Session ${sessionId} already exists, reusing it`);
      }
      
      // Associate the socket with the session
      this.logger.log(`Associating client socket ${client.id} with session ${sessionId}`);
      const session = await this.webrtcService.associateClientSocket(sessionId, client);
      if (!session) {
        this.logger.error(`Failed to associate client socket for session ${sessionId}`);
        client.emit('realtime-session-created', { 
          success: false, 
          error: 'Failed to associate client socket' 
        });
        this.logger.log(`Sent failure response to client ${client.id}`);
        return;
      }
      this.logger.log(`Successfully associated client socket with session`);
      
      // Emit success event
      this.logger.log(`Emitting realtime-session-created success event to client ${client.id}`);
      client.emit('realtime-session-created', { 
        success: true, 
        sessionId 
      });
      
      this.logger.log(`Realtime session started for client ${sessionId}`);
    } catch (error) {
      this.logger.error(`Error starting Realtime session for client ${client.id}:`, error);
      client.emit('realtime-session-created', { 
        success: false, 
        error: error.message || 'Internal server error' 
      });
      this.logger.log(`Sent error response to client ${client.id}`);
    }
  }
  
  /**
   * Connect to an existing Realtime session
   */
  @SubscribeMessage('connect-realtime-session')
  async handleConnectRealtimeSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string, initialPrompt?: string }
  ): Promise<void> {
    try {
      const sessionId = data.sessionId || client.id;
      const initialPrompt = data.initialPrompt || '';
      
      this.logger.log(`Received connect-realtime-session request from client ${client.id}`);
      this.logger.log(`For session ID: ${sessionId}, Initial prompt length: ${initialPrompt.length}`);
      
      // Check if session exists
      if (!this.webrtcService.hasRealtimeSession(sessionId)) {
        this.logger.error(`Session ${sessionId} not found`);
        client.emit('realtime-session-connected', { 
          success: false, 
          error: 'Session not found' 
        });
        this.logger.log(`Sent failure response to client ${client.id}`);
        return;
      }
      this.logger.log(`Session ${sessionId} found, connecting to OpenAI...`);
      
      // Connect to OpenAI Realtime API
      this.logger.log(`Calling webrtcService.connectRealtimeSession for session ${sessionId}`);
      const connected = await this.webrtcService.connectRealtimeSession(sessionId, initialPrompt);
      
      if (!connected) {
        this.logger.error(`Failed to connect to OpenAI for session ${sessionId}`);
        client.emit('realtime-session-connected', { 
          success: false, 
          error: 'Failed to connect to OpenAI' 
        });
        this.logger.log(`Sent failure response to client ${client.id}`);
        return;
      }
      this.logger.log(`Successfully connected to OpenAI for session ${sessionId}`);
      
      // Emit success event
      this.logger.log(`Emitting realtime-session-connected success event to client ${client.id}`);
      client.emit('realtime-session-connected', { 
        success: true, 
        sessionId 
      });
      
      this.logger.log(`Realtime session ${sessionId} connected for client ${client.id}`);
    } catch (error) {
      this.logger.error(`Error connecting Realtime session for client ${client.id}:`, error);
      client.emit('realtime-session-connected', { 
        success: false, 
        error: error.message || 'Internal server error' 
      });
      this.logger.log(`Sent error response to client ${client.id}`);
    }
  }
  
  /**
   * Handle audio data from the client for realtime sessions
   */
  @SubscribeMessage('realtime-audio')
  async handleRealtimeAudio(
    @MessageBody() data: { sessionId: string, audio: number[] | Uint8Array, isFinal: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { sessionId, audio, isFinal } = data;
      
      this.logger.debug(`Received audio data for realtime session ${sessionId}, size: ${audio.length} bytes, isFinal: ${isFinal}`);
      
      // Ensure session exists
      const session = this.realtimeSessions.get(sessionId);
      if (!session) {
        this.logger.error(`Session ${sessionId} not found for audio data handling`);
        return { error: 'Session not found' };
      }
      
      // Update session activity
      session.lastActivity = new Date();
      
      // Convert to Uint8Array if it's an array
      const audioData = Array.isArray(audio) ? new Uint8Array(audio) : audio;
      
      // Send audio to OpenAI
      const success = await this.webrtcService.sendAudioBuffer(sessionId, audioData);
      
      // If this is the final chunk in the recording and VAD is disabled,
      // we need to manually commit the audio buffer and create a response
      if (isFinal && success) {
        // Get session from service to check VAD status
        const serviceSession = await this.webrtcService.getRealtimeSession(sessionId);
        const isVadDisabled = !serviceSession?.config?.turn_detection;
        
        if (isVadDisabled) {
          // Send commit command to finalize the audio buffer
          this.logger.log(`Sending input_audio_buffer.commit for session ${sessionId}`);
          await this.webrtcService.sendRealtimeEvent(sessionId, {
            type: 'input_audio_buffer.commit'
          });
          
          // Create response after committing the buffer
          this.logger.log(`Sending response.create for session ${sessionId}`);
          await this.webrtcService.sendRealtimeEvent(sessionId, {
            type: 'response.create'
          });
        }
      }
      
      return { success };
    } catch (error) {
      this.logger.error(`Error handling realtime audio:`, error);
      return { error: error.message };
    }
  }
  
  /**
   * End a realtime session
   */
  @SubscribeMessage('end-realtime-session')
  async handleRealtimeSessionEnd(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { sessionId } = data;
      
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      
      this.logger.log(`Ending realtime session: ${sessionId}`);
      
      // Verify session exists
      const session = this.realtimeSessions.get(sessionId);
      if (!session) {
        return { success: true, message: 'Session was already closed or did not exist' };
      }
      
      // Verify client owns this session
      if (session.clientSocket.id !== client.id) {
        throw new Error(`Unauthorized: Client ${client.id} does not own session ${sessionId}`);
      }
      
      // Close the session
      await this.cleanupRealtimeSession(sessionId);
      
      return { success: true };
    } catch (error) {
      this.logger.error(`Error ending realtime session:`, error);
      return { 
        error: error.message || 'Failed to end session',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
  }
  
  /**
   * Initialize WebRTC connection with OpenAI
   */
  @SubscribeMessage('init-openai-connection')
  async handleOpenAIConnection(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { sessionId } = data;
      
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      
      this.logger.log(`Initializing OpenAI connection for session: ${sessionId}`);
      
      // Verify session exists
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      
      // Verify client owns this session
      if (session.clientSocket.id !== client.id) {
        throw new Error(`Unauthorized: Client ${client.id} does not own session ${sessionId}`);
      }
      
      // Update session activity
      session.lastActivity = new Date();
      session.state = 'connecting';
      
      // Create a simple SDP offer
      // In a real implementation, this would be more sophisticated
      const offer: RTCSessionDescriptionInit = {
        type: 'offer',
        sdp: `v=0
o=- ${Date.now()} 1 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE audio
m=audio 9 UDP/TLS/RTP/SAVPF 111
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=ice-ufrag:${crypto.randomBytes(4).toString('hex')}
a=ice-pwd:${crypto.randomBytes(22).toString('base64')}
a=fingerprint:sha-256 ${crypto.randomBytes(32).toString('hex').replace(/(.{2})/g, '$1:').slice(0, -1)}
a=setup:actpass
a=mid:audio
a=sendrecv
a=rtcp-mux
a=rtpmap:111 opus/48000/2
a=fmtp:111 minptime=10;useinbandfec=1
`
      };
      
      try {
        // Create a WebRTC connection with OpenAI through our service
        const openaiResponse = await this.webrtcService.createWebRTCConnection(offer);
        
        // Store the OpenAI session ID
        session.openaiSessionId = openaiResponse.session_id;
        session.state = 'connected';
        session.lastActivity = new Date();
        
        this.logger.log(`OpenAI connection established for session: ${sessionId}, OpenAI session ID: ${openaiResponse.session_id}`);
        
        // Notify client that connection is ready
        client.emit('openai-connected', {
          sessionId,
          openaiSessionId: openaiResponse.session_id,
          status: 'connected',
          timestamp: new Date().toISOString()
        });
        
        // Return success
        return {
          sessionId,
          status: 'connected',
          openaiSessionId: openaiResponse.session_id,
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        this.logger.error(`Error creating OpenAI connection for session ${sessionId}:`, error);
        
        // Update session state
        session.state = 'disconnected';
        
        throw new Error(`Failed to create OpenAI connection: ${error.message}`);
      }
    } catch (error) {
      this.logger.error('Error initializing OpenAI connection:', error);
      return {
        error: error.message || 'Failed to initialize OpenAI connection',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
  }
  
  /**
   * Handle audio data from client and send to OpenAI
   */
  @SubscribeMessage('audio-data')
  async handleAudioData(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { audioData: string, sessionId: string }
  ): Promise<void> {
    try {
      const sessionId = data.sessionId;
      if (!sessionId) {
        this.logger.error('No session ID provided with audio data');
        client.emit('audio-error', { error: 'No session ID provided' });
        return;
      }

      // Check if session exists
      if (!this.webrtcService.hasRealtimeSession(sessionId)) {
        this.logger.error(`No active session found for ID: ${sessionId}`);
        client.emit('audio-error', { error: 'No active session found' });
        return;
      }
      
      // Convert from Base64 to binary
      let audioBuffer: Uint8Array;
      try {
        const binaryData = Buffer.from(data.audioData, 'base64');
        audioBuffer = new Uint8Array(binaryData);
      } catch (error) {
        this.logger.error('Error decoding audio data', error);
        client.emit('audio-error', { error: 'Failed to decode audio data' });
        return;
      }
      
      // Log audio data details
      if (this.webrtcService.debugMode) {
        this.logger.debug(`Received audio data from client ${client.id} - ${audioBuffer.length} bytes`);
        if (audioBuffer.length > 0) {
          this.logger.debug(`First few bytes: ${Array.from(audioBuffer.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
        }
      }
      
      // Send audio to OpenAI
      const result = await this.webrtcService.sendAudioBuffer(sessionId, audioBuffer);
      
      if (!result) {
        this.logger.warn(`Failed to send audio data for session ${sessionId}`);
        // Not emitting an error to the client to avoid disrupting the flow
      } else if (this.webrtcService.debugMode) {
        this.logger.debug(`Successfully sent audio data for session ${sessionId}`);
      }
    } catch (error) {
      this.logger.error('Error handling audio data:', error);
      client.emit('audio-error', { error: 'Internal server error processing audio' });
    }
  }
  
  /**
   * End a session
   */
  @SubscribeMessage('session-end')
  async handleSessionEnd(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { sessionId } = data;
      
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      
      this.logger.log(`Ending session: ${sessionId}`);
      
      // Verify session exists
      const session = this.sessions.get(sessionId);
      if (!session) {
        return { success: true, message: 'Session was already closed or did not exist' };
      }
      
      // Verify client owns this session
      if (session.clientSocket.id !== client.id) {
        throw new Error(`Unauthorized: Client ${client.id} does not own session ${sessionId}`);
      }
      
      // Clean up the session
      await this.cleanupSession(sessionId);
      
      return { success: true };
    } catch (error) {
      this.logger.error('Error ending session:', error);
      return {
        error: error.message || 'Failed to end session',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
  }
  
  /**
   * Health check endpoint
   */
  @SubscribeMessage('health-check')
  async handleHealthCheck(
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const status = this.webrtcService.healthCheck();
      return { 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        ...status
      };
    } catch (error) {
      this.logger.error('Health check error:', error);
      return { 
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * Test OpenAI connection directly using the simple approach
   * that works in the test script
   */
  @SubscribeMessage('test-openai-connection')
  async handleTestConnection(
    @ConnectedSocket() client: Socket,
  ) {
    try {
      this.logger.log(`Testing direct OpenAI connection for client ${client.id}`);
      
      // Get API key and model from service
      const apiKey = process.env.OPENAI_API_KEY;
      const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
      
      if (!apiKey) {
        throw new Error('API key not configured');
      }
      
      // Use exact URL from working test
      const url = `wss://api.openai.com/v1/realtime?model=${model}`;
      
      this.logger.log(`Connecting to WebSocket endpoint: ${url}`);
      this.logger.log('Using headers: Authorization: Bearer *****, OpenAI-Beta: realtime=v1');
      
      // Set up connection with minimal options
      const WebSocket = require('ws');
      const ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });
      
      // Set a connection timeout
      const timeoutId = setTimeout(() => {
        this.logger.error('Connection timeout after 30 seconds');
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.close();
        }
        client.emit('test-connection-result', { 
          success: false, 
          error: 'Connection timeout' 
        });
      }, 30000);
      
      // Set up connection handling
      ws.on('open', () => {
        this.logger.log('✅ WebSocket connection established successfully!');
        clearTimeout(timeoutId);
        
        // Send system message as per documentation
        this.logger.log('Sending system message...');
        const systemMessage = {
          type: "message",
          message: {
            role: "system",
            content: "You are a helpful assistant."
          }
        };
        
        ws.send(JSON.stringify(systemMessage));
        this.logger.log(`Sent message: ${JSON.stringify(systemMessage)}`);
        
        // Send a user message after 1 second
        setTimeout(() => {
          this.logger.log('Sending user message...');
          const userMessage = {
            type: "message", 
            message: {
              role: "user",
              content: "Hello, can you hear me?"
            }
          };
          
          ws.send(JSON.stringify(userMessage));
          this.logger.log(`Sent message: ${JSON.stringify(userMessage)}`);
          
          // Send a simple audio packet
          setTimeout(() => {
            this.logger.log('Sending audio data...');
            const audioData = Buffer.from(new Uint8Array(100));
            ws.send(audioData);
            this.logger.log(`Sent audio data: ${audioData.length} bytes`);
          }, 1000);
        }, 1000);
        
        // Let the client know connection was successful
        client.emit('test-connection-result', { 
          success: true,
          message: 'Connection successful! Check server logs for details.' 
        });
      });
      
      // Message handler
      ws.on('message', (data) => {
        try {
          if (data instanceof Buffer) {
            this.logger.log(`Received binary data: ${data.length} bytes`);
            this.logger.log(`First bytes: ${data.slice(0, 16).toString('hex')}`);
          } else {
            const messageStr = data.toString();
            this.logger.log(`Received message: ${messageStr}`);
            
            try {
              const parsedData = JSON.parse(messageStr);
              this.logger.log(`Parsed data type: ${parsedData.type || 'unknown'}`);
            } catch (e) {
              this.logger.error(`Failed to parse as JSON: ${e.message}`);
            }
          }
        } catch (err) {
          this.logger.error(`Error processing message: ${err.message}`);
        }
      });
      
      // Error handler
      ws.on('error', (error) => {
        this.logger.error(`❌ WebSocket error: ${error.message}`);
        if (error.code) {
          this.logger.error(`Error code: ${error.code}`);
        }
        clearTimeout(timeoutId);
        
        client.emit('test-connection-result', { 
          success: false,
          error: error.message
        });
      });
      
      // Close handler
      ws.on('close', (code, reason) => {
        this.logger.log(`WebSocket closed: ${code} ${reason || 'No reason provided'}`);
        clearTimeout(timeoutId);
        
        // Wait 1 second before completing
        setTimeout(() => {
          client.emit('test-connection-closed', { 
            code,
            reason: reason || 'No reason provided'
          });
        }, 1000);
      });
      
      // Close the connection after 10 seconds
      setTimeout(() => {
        this.logger.log('Test complete, closing connection...');
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      }, 10000);
      
      return { success: true, message: 'Test connection initiated' };
    } catch (error) {
      this.logger.error('Error in test connection:', error);
      return { 
        success: false,
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
  }
  
  /**
   * Clean up a session and associated resources
   */
  private async cleanupSession(sessionId: string) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return;
      }
      
      this.logger.log(`Cleaning up session: ${sessionId}`);
      
      // If connected to OpenAI, close that connection
      if (session.openaiSessionId) {
        try {
          await this.webrtcService.closeWebRTCConnection(session.openaiSessionId);
        } catch (err) {
          this.logger.error(`Error closing OpenAI connection for session ${sessionId}:`, err);
        }
      }
      
      // Remove from our session map
      this.sessions.delete(sessionId);
      
      this.logger.log(`Session ${sessionId} cleaned up`);
    } catch (error) {
      this.logger.error(`Error cleaning up session ${sessionId}:`, error);
      throw error;
    }
  }
  
  /**
   * Clean up a realtime session and associated resources
   */
  private async cleanupRealtimeSession(sessionId: string) {
    try {
      const session = this.realtimeSessions.get(sessionId);
      if (!session) {
        return;
      }
      
      // IMPORTANT: Check for the connecting flag
      if (session['_connectingInProgress']) {
        this.logger.log(`Skipping cleanup for session ${sessionId} - connection in progress`);
        return;
      }
      
      this.logger.log(`Cleaning up realtime session: ${sessionId}`);
      
      // Close OpenAI WebSocket connection
      try {
        await this.webrtcService.closeRealtimeSession(sessionId);
      } catch (err) {
        this.logger.error(`Error closing OpenAI realtime connection for session ${sessionId}:`, err);
      }
      
      // Remove from our session map
      this.realtimeSessions.delete(sessionId);
      
      this.logger.log(`Realtime session ${sessionId} cleaned up`);
    } catch (error) {
      this.logger.error(`Error cleaning up realtime session ${sessionId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get detailed status of a realtime session 
   */
  @SubscribeMessage('get-session-status')
  async handleGetSessionStatus(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { sessionId } = data;
      
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      
      this.logger.log(`Checking status for session: ${sessionId}`);
      
      // Verify session exists
      const session = this.realtimeSessions.get(sessionId);
      if (!session) {
        return { 
          exists: false, 
          message: 'Session not found',
          sessionId
        };
      }
      
      // Gather detailed status info
      const status = {
        exists: true,
        sessionId,
        state: session.state,
        ownerId: session.clientSocket.id,
        ownerMatch: session.clientSocket.id === client.id,
        modelConnectionState: session.modelConnection ? 
          ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][session.modelConnection.readyState] : 
          'NO_CONNECTION',
        modelConnectionReady: session.modelConnection ? session.modelConnection.readyState === 1 : false,
        lastActivity: session.lastActivity,
        hasCallbacks: !!session.clientCallbacks?.onEvent,
        connectingFlag: !!session['_connectingInProgress'],
        timestamp: new Date().toISOString()
      };
      
      return status;
    } catch (error) {
      this.logger.error('Error getting session status:', error);
      return {
        error: error.message || 'Failed to get session status',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
  }
  
  /**
   * Debug endpoint to ensure the client is receiving events properly
   */
  @SubscribeMessage('test-client-events')
  async handleTestClientEvents(
    @ConnectedSocket() client: Socket,
  ) {
    try {
      this.logger.log(`Testing client event reception for ${client.id}`);
      
      // Track which events were confirmed received by client
      const receivedEvents = new Set<string>();
      const eventsToSend = [
        'test-event-1',
        'test-event-2',
        'test-event-3',
        'realtime-connected'
      ];
      
      // Set up response handler
      const responseHandler = (eventName: string) => {
        this.logger.log(`Client confirmed receipt of ${eventName}`);
        receivedEvents.add(eventName);
        
        // If all events received, complete the test
        if (eventsToSend.every(evt => receivedEvents.has(evt))) {
          // Remove the handler
          client.removeListener('test-event-response', responseHandler);
          
          // Send final success confirmation
          client.emit('test-events-complete', { 
            success: true,
            eventsConfirmed: Array.from(receivedEvents),
            timestamp: new Date().toISOString()
          });
        }
      };
      
      // Listen for client confirmation of events
      client.on('test-event-response', responseHandler);
      
      // Set timeout to clean up if client doesn't respond
      const timeout = setTimeout(() => {
        client.removeListener('test-event-response', responseHandler);
        
        const missingEvents = eventsToSend.filter(evt => !receivedEvents.has(evt));
        
        client.emit('test-events-complete', { 
          success: false,
          eventsConfirmed: Array.from(receivedEvents),
          eventsMissing: missingEvents,
          message: `Client did not confirm receipt of all events. Missing: ${missingEvents.join(', ')}`,
          timestamp: new Date().toISOString()
        });
      }, 5000);
      
      // Send test events to client
      for (const eventName of eventsToSend) {
        this.logger.log(`Sending test event: ${eventName}`);
        client.emit(eventName, { 
          test: true, 
          event: eventName,
          timestamp: new Date().toISOString()
        });
        
        // Brief pause between events
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      return { 
        success: true, 
        message: 'Test events sent, waiting for client confirmation',
        events: eventsToSend
      };
    } catch (error) {
      this.logger.error('Error in test client events:', error);
      return { 
        success: false,
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
  }

  // Add ping-pong handler for connection diagnostics
  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    this.logger.debug(`Received ping from client ${client.id}, sending pong`);
    client.emit('pong');
  }
} 