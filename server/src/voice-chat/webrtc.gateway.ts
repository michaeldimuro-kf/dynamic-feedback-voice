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

interface WebRTCSession {
  id: string;
  openaiSessionId: string;
  clientSocket: Socket;
  state: 'initializing' | 'connecting' | 'connected' | 'disconnected';
  created: Date;
  lastActivity: Date;
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
  
  constructor(private readonly webrtcService: WebRTCService) {
    this.logger.log('WebRTC Gateway initialized');
    
    // Set up session cleanup interval
    setInterval(() => this.cleanupInactiveSessions(), 60000); // Check every minute
  }
  
  handleConnection(client: Socket) {
    this.logger.log(`Client connected to gateway: ${client.id}`);
    // Send immediate connection acknowledgment
    client.emit('socket-connected', { 
      status: 'connected', 
      clientId: client.id,
      timestamp: new Date().toISOString()
    });
  }
  
  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected from gateway: ${client.id}`);
    
    // Find and clean up any sessions for this client
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.clientSocket.id === client.id) {
        this.logger.log(`Cleaning up session on disconnect: ${sessionId}`);
        this.cleanupSession(sessionId).catch(err => {
          this.logger.error(`Error cleaning up session ${sessionId} on disconnect:`, err);
        });
      }
    }
  }
  
  /**
   * Clean up inactive sessions
   */
  private cleanupInactiveSessions() {
    const now = new Date();
    const maxInactivityMs = 10 * 60 * 1000; // 10 minutes
    
    for (const [sessionId, session] of this.sessions.entries()) {
      const inactiveTimeMs = now.getTime() - session.lastActivity.getTime();
      
      if (inactiveTimeMs > maxInactivityMs) {
        this.logger.log(`Cleaning up inactive session: ${sessionId} (inactive for ${Math.round(inactiveTimeMs / 1000)}s)`);
        this.cleanupSession(sessionId).catch(err => {
          this.logger.error(`Error cleaning up inactive session ${sessionId}:`, err);
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
   * Handle audio data from client
   */
  @SubscribeMessage('audio-data')
  async handleAudioData(
    @MessageBody() data: { sessionId: string, audio: ArrayBuffer },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { sessionId, audio } = data;
      
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      
      if (!audio) {
        throw new Error('Audio data is required');
      }
      
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
      
      // In a real implementation, you would forward this audio data to OpenAI's WebRTC connection
      // For now, we'll just log it
      this.logger.debug(`Received audio data for session: ${sessionId}, size: ${audio.byteLength} bytes`);
      
      // TODO: Forward audio data to OpenAI WebRTC connection
      
      return { success: true };
    } catch (error) {
      this.logger.error('Error handling audio data:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * End the session
   */
  @SubscribeMessage('end-session')
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
        return { 
          success: true,
          message: 'Session already ended or does not exist',
          sessionId
        };
      }
      
      // Verify client owns this session
      if (session.clientSocket.id !== client.id) {
        throw new Error(`Unauthorized: Client ${client.id} does not own session ${sessionId}`);
      }
      
      // Clean up the session
      await this.cleanupSession(sessionId);
      
      return { 
        success: true,
        sessionId,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Error ending session:', error);
      return {
        error: error.message || 'Failed to end session',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
  }
  
  /**
   * Health check
   */
  @SubscribeMessage('health-check')
  async handleHealthCheck(
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const serviceHealth = this.webrtcService.healthCheck();
      
      // Get sessions for this client
      const clientSessions = [];
      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.clientSocket.id === client.id) {
          clientSessions.push({
            sessionId,
            state: session.state,
            created: session.created,
            lastActivity: session.lastActivity,
            hasOpenAISession: Boolean(session.openaiSessionId)
          });
        }
      }
      
      const gatewayHealth = {
        status: 'ok',
        client_id: client.id,
        total_sessions: this.sessions.size,
        client_sessions: clientSessions,
        timestamp: new Date().toISOString()
      };
      
      return {
        success: true,
        gateway: gatewayHealth,
        service: serviceHealth
      };
    } catch (error) {
      this.logger.error('Error handling health check:', error);
      return { 
        success: false, 
        error: error.message || 'Unknown error processing health check' 
      };
    }
  }
  
  /**
   * Clean up a session
   */
  private async cleanupSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    this.logger.log(`Cleaning up session: ${sessionId}`);
    
    // Close the OpenAI connection if it exists
    if (session.openaiSessionId) {
      try {
        this.logger.log(`Closing OpenAI connection for session ${sessionId}`);
        await this.webrtcService.closeWebRTCConnection(session.openaiSessionId);
      } catch (error) {
        this.logger.error(`Error closing OpenAI connection for session ${sessionId}:`, error);
        // Continue with cleanup even if closing fails
      }
    }
    
    // Update session state
    session.state = 'disconnected';
    
    // Notify the client that the session has been closed
    try {
      session.clientSocket.emit('session-ended', { 
        sessionId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.logger.error(`Error notifying client about session closure for session ${sessionId}:`, error);
    }
    
    // Remove the session from the map
    this.sessions.delete(sessionId);
    this.logger.log(`Session ${sessionId} removed from session map`);
  }
} 