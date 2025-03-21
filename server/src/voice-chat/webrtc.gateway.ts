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
  private readonly clientSessions = new Map<string, string>();
  
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
   * Handle client disconnections
   */
  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
    
    try {
      // Check if this client had a realtime session
      const sessionId = this.clientSessions.get(client.id);
      if (sessionId) {
        this.logger.log(`Client ${client.id} was associated with realtime session ${sessionId}`);
        
        // Don't immediately clean up the session, just log that the client disconnected
        const session = this.webrtcService.getRealtimeSession(sessionId);
        if (session) {
          this.logger.log(`Client ${client.id} disconnected from session ${sessionId}, but keeping session active for reconnection`);
          
          // Update last activity
          session.lastActivity = new Date();
          
          // Mark the session as still valid but client disconnected
          // This will help with debugging and allow for potential reconnection
          session._clientDisconnected = true;
          
          // We'll leave actual cleanup to a scheduled task or explicit close request
        }
        
        // Remove from our client-session mapping
        this.clientSessions.delete(client.id);
      }
      
      // For now, skip cleaning up legacy sessions to avoid typing issues
      this.logger.log(`Client ${client.id} disconnected, realtime sessions preserved for reconnection`);
    } catch (error) {
      this.logger.error('Error handling client disconnect:', error);
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
    @MessageBody() data: { sessionId?: string, initialPrompt?: string, voice?: string } = {}
  ): Promise<void> {
    try {
      this.logger.log(`🔷 Received start-realtime-session request from client ${client.id}`);
      
      // Generate a unique session ID with a prefix
      const sessionId = `realtime-${uuidv4()}`;
      this.logger.log(`🔷 Generated new session ID: ${sessionId} for client ${client.id}`);
      
      // Associate the client with the session
      this.clientSessions.set(client.id, sessionId);
      this.logger.log(`🔷 Associated client ${client.id} with session ${sessionId}`);
      
      // Create a new session with voice parameter if provided
      const config = { voice: data.voice };
      this.logger.log(`🔷 Creating session with config: ${JSON.stringify(config)}`);
      const session = await this.webrtcService.createRealtimeSession(sessionId, config);
      if (!session) {
        this.logger.error(`❌ Failed to create realtime session ${sessionId} for client ${client.id}`);
        client.emit('realtime-session-started', { 
          success: false, 
          error: 'Failed to create session' 
        });
        this.logger.log(`❌ Sent failure response to client ${client.id}`);
        return;
      }
      
      // Add createdAt timestamp to session
      const realtimeSession = this.webrtcService.getRealtimeSession(sessionId);
      if (realtimeSession) {
        realtimeSession.createdAt = new Date();
        this.logger.log(`✅ Created realtime session ${sessionId} for client ${client.id} at ${realtimeSession.createdAt.toISOString()}`);
      }
      
      // Associate client socket with the session for future audio data
      this.webrtcService.associateClientSocket(sessionId, client);
      this.logger.log(`✅ Associated client socket ${client.id} with session ${sessionId}`);
      
      // Double check that the session exists
      if (!this.webrtcService.hasRealtimeSession(sessionId)) {
        this.logger.error(`❌ Session ${sessionId} not found in service immediately after creation!`);
        client.emit('realtime-session-started', { 
          success: false, 
          error: 'Session not found after creation' 
        });
        return;
      }
      
      // Log the total count of sessions
      const totalSessions = this.webrtcService.getSessionIds().length;
      this.logger.log(`ℹ️ Total realtime sessions after creation: ${totalSessions}`);
      
      // Emit success event with the session ID
      client.emit('realtime-session-started', { 
        success: true, 
        sessionId 
      });
      this.logger.log(`✅ Sent success response to client ${client.id} with session ID ${sessionId}`);
    } catch (error) {
      this.logger.error(`❌ Error starting realtime session for client ${client.id}:`, error);
      client.emit('realtime-session-started', { 
        success: false, 
        error: error.message || 'Internal server error' 
      });
      this.logger.log(`❌ Sent error response to client ${client.id}`);
    }
  }
  
  /**
   * Connect to an existing Realtime session
   */
  @SubscribeMessage('connect-realtime-session')
  async handleConnectRealtimeSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string, initialPrompt?: string, voice?: string }
  ): Promise<void> {
    try {
      const sessionId = data.sessionId || client.id;
      const initialPrompt = data.initialPrompt || '';
      
      this.logger.log(`Received connect-realtime-session request from client ${client.id}`);
      
      // Check if session exists
      if (!this.webrtcService.hasRealtimeSession(sessionId)) {
        this.logger.log(`Session ${sessionId} not found, creating a new one`);
        
        // Create a new session with the requested voice
        const config = { voice: data.voice };
        this.logger.log(`Creating session with config: ${JSON.stringify(config)}`);
        await this.webrtcService.createRealtimeSession(sessionId, config);
      } else {
        // If the session exists but has a different voice config, update it
        const session = this.webrtcService.getRealtimeSession(sessionId);
        if (session && data.voice && session.config.voice !== data.voice) {
          this.logger.log(`Updating session voice from ${session.config.voice} to ${data.voice}`);
          session.config.voice = data.voice;
        }
      }
      
      // Flag the session as connecting to prevent premature cleanup
      const session = this.webrtcService.getRealtimeSession(sessionId);
      if (session) {
        session['_connectingInProgress'] = true;
        this.logger.log(`Marked session ${sessionId} as connecting in progress`);
      }
      
      // Connect to OpenAI Realtime API
      this.logger.log(`Calling webrtcService.connectRealtimeSession for session ${sessionId}`);
      const connected = await this.webrtcService.connectRealtimeSession(sessionId, initialPrompt);
      
      // Remove the connecting flag
      if (session) {
        session['_connectingInProgress'] = false;
      }
      
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
      // Better logging for audio data reception
      const audioLength = data?.audioData?.length || 0;
      this.logger.log(`🎙️ Received audio data from client ${client.id} for session ${data?.sessionId}, data length: ${audioLength} bytes`);
      
      // Validate the data
      if (!data || !data.audioData || !data.sessionId) {
        this.logger.error(`❌ Invalid audio data received from client ${client.id}: Missing required fields`);
        client.emit('realtime-event', {
          type: 'error',
          error: {
            message: 'Invalid audio data: missing required fields'
          }
        });
        return;
      }
      
      // Check if this client has a session in the client-session map
      const clientMappedSessionId = this.clientSessions.get(client.id);
      if (clientMappedSessionId && clientMappedSessionId !== data.sessionId) {
        this.logger.warn(`⚠️ Client ${client.id} has session ${clientMappedSessionId} in map but is sending data for ${data.sessionId}`);
      }
      
      // Use the webrtcService to get the session
      const session = this.webrtcService.getRealtimeSession(data.sessionId);
      
      // If session not found, handle error and try to help the client
      if (!session) {
        this.logger.error(`❌ Session ${data.sessionId} not found for client ${client.id}`);
        
        // Log all active sessions for debugging purposes
        const allSessions = this.webrtcService.getSessionIds();
        this.logger.log(`📊 Active sessions: ${allSessions.length > 0 ? allSessions.join(', ') : 'none'}`);
        
        // Send error to client
        client.emit('realtime-event', {
          type: 'error',
          error: {
            message: `Session ${data.sessionId} not found`,
            code: 'SESSION_NOT_FOUND'
          }
        });
        return;
      }
      
      // Update client session mapping - important for reconnection scenarios
      this.clientSessions.set(client.id, data.sessionId);
      
      // Ensure this client is associated with the session
      if (!session.clientSocketIds.includes(client.id)) {
        this.logger.log(`⚠️ Client ${client.id} not in session ${data.sessionId} socket list - associating now`);
        try {
          this.webrtcService.associateClientSocket(data.sessionId, client);
        } catch (error) {
          this.logger.error(`❌ Failed to associate client ${client.id} with session ${data.sessionId}: ${error.message}`);
        }
      }
      
      // Update session activity
      if (session) {
        session.lastActivity = new Date();
      }
      
      // Convert the audio data from base64 to Uint8Array
      let audioBuffer: Uint8Array;
      
      try {
        const binaryString = Buffer.from(data.audioData, 'base64');
        audioBuffer = new Uint8Array(binaryString);
        this.logger.log(`✅ Converted audio data to Uint8Array: ${audioBuffer.length} bytes for session ${data.sessionId}`);
        
        // Log a sample of the audio data to verify it's not empty or corrupted
        if (audioBuffer.length > 0) {
          const sample = Array.from(audioBuffer.slice(0, 5)).map(b => b.toString(16).padStart(2, '0')).join(' ');
          this.logger.log(`📊 Audio data sample: [${sample}...] (first 5 bytes of ${audioBuffer.length} total)`);
          
          // Calculate some statistics about the audio data
          let min = 0, max = 0, sum = 0;
          for (let i = 0; i < Math.min(audioBuffer.length, 1000); i++) {
            min = Math.min(min, audioBuffer[i]);
            max = Math.max(max, audioBuffer[i]);
            sum += audioBuffer[i];
          }
          const avg = sum / Math.min(audioBuffer.length, 1000);
          this.logger.log(`📊 Audio data stats (first 1000 bytes): min=${min}, max=${max}, avg=${avg.toFixed(2)}`);
        } else {
          this.logger.warn(`⚠️ Received empty audio buffer from client ${client.id}`);
          client.emit('realtime-event', {
            type: 'error',
            error: {
              message: 'Empty audio buffer received',
              code: 'EMPTY_AUDIO'
            }
          });
          return;
        }
      } catch (error) {
        this.logger.error(`❌ Error converting audio data from client ${client.id}: ${error.message}`);
        client.emit('realtime-event', {
          type: 'error',
          error: {
            message: `Error processing audio data: ${error.message}`,
            code: 'AUDIO_PROCESSING_ERROR'
          }
        });
        return;
      }
      
      // Send the audio buffer to the OpenAI API via the WebRTC service
      this.logger.log(`📤 Forwarding ${audioBuffer.length} bytes of audio data to OpenAI for session ${data.sessionId}`);
      const success = await this.webrtcService.sendAudioBuffer(data.sessionId, audioBuffer);
      
      if (success) {
        this.logger.log(`✅ Successfully sent audio buffer to OpenAI for session ${data.sessionId}`);
      } else {
        this.logger.error(`❌ Failed to send audio buffer to OpenAI for session ${data.sessionId}`);
        client.emit('realtime-event', {
          type: 'error',
          error: {
            message: 'Failed to send audio data to OpenAI',
            code: 'SEND_AUDIO_FAILED'
          }
        });
      }
    } catch (error) {
      this.logger.error(`❌ Error handling audio data from client ${client?.id || 'unknown'}: ${error.message}`);
      client.emit('realtime-event', {
        type: 'error',
        error: {
          message: `Server error processing audio: ${error.message}`,
          code: 'SERVER_ERROR'
        }
      });
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
      // First check with the webrtcService if the session exists
      const session = this.webrtcService.getRealtimeSession(sessionId);
      if (!session) {
        this.logger.log(`Session ${sessionId} not found in webrtcService during cleanup`);
        return;
      }
      
      // IMPORTANT: Check for the connecting flag
      if (session['_connectingInProgress']) {
        this.logger.log(`⚠️ Skipping cleanup for session ${sessionId} - connection in progress`);
        return;
      }
      
      // If the session was recently created (within the last 20 seconds), don't clean it up
      const sessionAge = Date.now() - session.createdAt.getTime();
      if (sessionAge < 20000) {
        this.logger.log(`⚠️ Skipping cleanup for session ${sessionId} - too new (${Math.round(sessionAge/1000)}s old)`);
        return;
      }
      
      this.logger.log(`Cleaning up realtime session: ${sessionId}`);
      
      // Close OpenAI WebSocket connection but don't delete the session 
      try {
        // Just disconnect but don't fully close/delete
        if (session.modelConnection) {
          this.logger.log(`Closing WebSocket connection for session ${sessionId} but preserving session`);
          try {
            session.modelConnection.close();
          } catch (err) {
            this.logger.error(`Error closing WebSocket for session ${sessionId}:`, err);
          }
          session.modelConnection = undefined;
        }
        
        // Mark as disconnected but don't remove from realtimeSessions map
        session.state = 'disconnected';
        this.logger.log(`Marked session ${sessionId} as disconnected but preserved it`);
        
        return;
      } catch (err) {
        this.logger.error(`Error closing OpenAI realtime connection for session ${sessionId}:`, err);
      }
      
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
  handlePing(@ConnectedSocket() client: Socket): void {
    this.logger.log(`Received ping from client ${client.id}`);
    client.emit('pong');
  }

  // Echo test handler for debugging
  @SubscribeMessage('echo-test')
  handleEchoTest(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket
  ): void {
    try {
      this.logger.log(`Received echo test from client ${client.id}: ${JSON.stringify(data)}`);
      
      // Send a response back to the client
      client.emit('echo-response', {
        received: data,
        timestamp: Date.now(),
        serverMessage: 'Echo response from server'
      });
      
      this.logger.log(`Sent echo response to client ${client.id}`);
    } catch (error) {
      this.logger.error('Error handling echo test:', error);
    }
  }

  /**
   * Handle manual commit of audio buffer (when VAD is disabled)
   */
  @SubscribeMessage('commit-audio-buffer')
  async handleCommitAudioBuffer(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { sessionId } = data;
      
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      
      this.logger.log(`Manually committing audio buffer for session ${sessionId}`);
      
      // Verify session exists
      if (!this.webrtcService.hasRealtimeSession(sessionId)) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      
      // Send commit command to OpenAI
      await this.webrtcService.sendRealtimeEvent(sessionId, {
        type: 'input_audio_buffer.commit'
      });
      
      this.logger.log(`Successfully committed audio buffer for session ${sessionId}`);
      
      return { success: true };
    } catch (error) {
      this.logger.error(`Error committing audio buffer:`, error);
      return { error: error.message };
    }
  }
  
  /**
   * Handle manual creation of response (when VAD is disabled)
   */
  @SubscribeMessage('create-response')
  async handleCreateResponse(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { sessionId } = data;
      
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      
      this.logger.log(`Manually creating response for session ${sessionId}`);
      
      // Verify session exists
      if (!this.webrtcService.hasRealtimeSession(sessionId)) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      
      // Send response.create command to OpenAI
      await this.webrtcService.sendRealtimeEvent(sessionId, {
        type: 'response.create'
      });
      
      this.logger.log(`Successfully created response for session ${sessionId}`);
      
      return { success: true };
    } catch (error) {
      this.logger.error(`Error creating response:`, error);
      return { error: error.message };
    }
  }
  
  /**
   * Handle clearing of audio buffer (when VAD is disabled)
   */
  @SubscribeMessage('clear-audio-buffer')
  async handleClearAudioBuffer(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { sessionId } = data;
      
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      
      this.logger.log(`Clearing audio buffer for session ${sessionId}`);
      
      // Verify session exists
      if (!this.webrtcService.hasRealtimeSession(sessionId)) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      
      // Send clear command to OpenAI
      await this.webrtcService.sendRealtimeEvent(sessionId, {
        type: 'input_audio_buffer.clear'
      });
      
      this.logger.log(`Successfully cleared audio buffer for session ${sessionId}`);
      
      return { success: true };
    } catch (error) {
      this.logger.error(`Error clearing audio buffer:`, error);
      return { error: error.message };
    }
  }
} 