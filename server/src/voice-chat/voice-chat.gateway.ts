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
import { VoiceChatService } from './voice-chat.service';
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

interface VoiceChatSession {
  id: string;
  clientSocket: Socket;
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
export class VoiceChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  
  private readonly logger = new Logger(VoiceChatGateway.name);
  private readonly sessions = new Map<string, VoiceChatSession>();

  constructor(private readonly voiceChatService: VoiceChatService) {
    this.logger.log('Voice Chat Gateway initialized');
    
    // Set up session cleanup interval
    setInterval(() => this.cleanupInactiveSessions(), 60000); // Check every minute
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    // Send immediate connection acknowledgment
    client.emit('socket-connected', { 
      status: 'connected', 
      clientId: client.id,
      timestamp: new Date().toISOString()
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    
    // Find and clean up any sessions for this client
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.clientSocket.id === client.id) {
        this.logger.log(`Cleaning up session on disconnect: ${sessionId}`);
        this.sessions.delete(sessionId);
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
        this.sessions.delete(sessionId);
      }
    }
  }
  
  /**
   * Start a new voice chat session
   */
  @SubscribeMessage('start-voice-chat')
  async handleStartVoiceChat(
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const sessionId = crypto.randomUUID();
      
      this.logger.log(`Creating new voice chat session: ${sessionId} for client: ${client.id}`);
      
      // Create the session
      this.sessions.set(sessionId, {
        id: sessionId,
        clientSocket: client,
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
      this.logger.error('Error creating voice chat session:', error);
      return {
        error: error.message || 'Failed to create session',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
  }
  
  /**
   * Process audio from client
   */
  @SubscribeMessage('process-audio')
  async handleProcessAudio(
    @MessageBody() data: { sessionId: string, audio: Uint8Array, mimeType?: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { sessionId, audio, mimeType = 'audio/webm' } = data;
      
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      
      if (!audio || !audio.length) {
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
      
      // Convert Uint8Array to Buffer
      const audioBuffer = Buffer.from(audio);
      
      // Process the audio
      const transcription = await this.voiceChatService.transcribeAudio(audioBuffer, mimeType);
      
      // Generate AI response
      const aiResponse = await this.voiceChatService.generateAIResponse(transcription);
      
      // Convert AI response to speech
      const speechBuffer = await this.voiceChatService.generateSpeechAudio(aiResponse);
      
      // Send responses back to client
      client.emit('voice-chat-response', {
        sessionId,
        transcription,
        response: aiResponse,
        audio: speechBuffer.toString('base64')
      });
      
      return { success: true };
    } catch (error) {
      this.logger.error('Error processing audio:', error);
      return {
        error: error.message || 'Failed to process audio',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
  }
  
  /**
   * End a voice chat session
   */
  @SubscribeMessage('end-voice-chat')
  async handleEndVoiceChat(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { sessionId } = data;
      
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      
      this.logger.log(`Ending voice chat session: ${sessionId}`);
      
      // Verify session exists
      const session = this.sessions.get(sessionId);
      if (!session) {
        return { success: true, message: 'Session was already closed or did not exist' };
      }
      
      // Verify client owns this session
      if (session.clientSocket.id !== client.id) {
        throw new Error(`Unauthorized: Client ${client.id} does not own session ${sessionId}`);
      }
      
      // Remove the session
      this.sessions.delete(sessionId);
      
      return { success: true };
    } catch (error) {
      this.logger.error('Error ending voice chat session:', error);
      return {
        error: error.message || 'Failed to end session',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
  }
  
  /**
   * Health check endpoint
   */
  @SubscribeMessage('voice-chat-health')
  async handleHealthCheck() {
    try {
      const serviceStatus = this.voiceChatService.healthCheck();
      
      return {
        gateway: {
          status: 'healthy',
          activeSessions: this.sessions.size,
          timestamp: new Date().toISOString()
        },
        service: serviceStatus
      };
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return {
        error: error.message || 'Health check failed',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
  }
} 