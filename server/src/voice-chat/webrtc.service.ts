import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import axios from 'axios';
import { WebSocket } from 'ws';
import { Socket } from 'socket.io';
import * as WaveFile from 'wavefile';

interface WebRTCConnectionResponse {
  answer: RTCSessionDescriptionInit;
  ice_candidates: RTCIceCandidateInit[];
  session_id: string;
}

interface RealtimeSession {
  id: string;
  clientId: string;
  clientSocket?: Socket;
  state: 'created' | 'connecting' | 'connected' | 'disconnected';
  modelConnection?: WebSocket;
  config: {
    voice: string;
    modalities: string[];
    inputFormat: string;
    outputFormat: string;
    turn_detection?: {
      pauses?: {
        speech_threshold?: number;
        speech_end?: number;
      }
    };
    [key: string]: any;
  };
  active: boolean;
  createdAt: Date;
  lastActivity: Date;
  latestMediaTimestamp?: number;
  lastAssistantItem?: string;
  responseStartTimestamp?: number;
  currentResponseId?: string | null;
  clientCallbacks: {
    onEvent?: (event: any) => void;
  };
}

@Injectable()
export class WebRTCService implements OnModuleDestroy {
  private readonly logger = new Logger(WebRTCService.name);
  private readonly openai: OpenAI;
  private readonly apiKey: string;
  public debugMode: boolean;
  private readonly openaiUrl: string;
  private readonly apiVersion: string;
  private readonly realtimeModel: string;
  private readonly activeSessions = new Set<string>();
  private readonly realtimeSessions = new Map<string, RealtimeSession>();
  private healthCheckInterval: NodeJS.Timeout;
  private sessionCleanupInterval: NodeJS.Timeout;
  
  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.debugMode = this.configService.get<string>('DEBUG_MODE') === 'true';
    this.openaiUrl = this.configService.get<string>('OPENAI_API_URL') || 'https://api.openai.com/v1';
    this.apiVersion = this.configService.get<string>('OPENAI_API_VERSION') || '2023-05-15';
    this.realtimeModel = this.configService.get<string>('OPENAI_REALTIME_MODEL') || 'gpt-4o-realtime-preview-2024-12-17';
    
    if (!this.apiKey) {
      const errorMsg = 'OPENAI_API_KEY is not defined in the .env file! You must add your own API key';
      this.logger.error(errorMsg);
      this.logger.error('Please update the .env file with your OpenAI API key');
      this.logger.error('You need access to the OpenAI Realtime API (gpt-4o-realtime-preview model)');
      throw new Error(errorMsg);
    }
    
    if (this.apiKey === 'your_api_key_here') {
      const errorMsg = 'You are using the placeholder API key! Replace it with your actual OpenAI API key in the .env file';
      this.logger.error(errorMsg);
      this.logger.error('Please update the .env file with your OpenAI API key');
      this.logger.error('You need access to the OpenAI Realtime API (gpt-4o-realtime-preview model)');
      throw new Error(errorMsg);
    }
    
    this.openai = new OpenAI({
      apiKey: this.apiKey,
    });
    
    // Initialize health check - run every 30 seconds
    this.healthCheckInterval = setInterval(() => this.healthCheck(), 30000);
    this.logger.log('WebRTC service initialized with health check');
  }
  
  /**
   * Health check to ensure the service is running
   */
  healthCheck() {
    try {
      this.logger.debug(`Active WebRTC sessions: ${this.activeSessions.size}`);
      this.logger.debug(`Active Realtime sessions: ${this.realtimeSessions.size}`);
      return { 
        status: 'healthy', 
        activeSessions: this.activeSessions.size,
        realtimeSessions: this.realtimeSessions.size  
      };
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return { status: 'unhealthy', error: error.message };
    }
  }
  
  /**
   * Create a WebRTC connection with OpenAI
   * @param offer The WebRTC offer from the client
   */
  async createWebRTCConnection(offer: RTCSessionDescriptionInit): Promise<WebRTCConnectionResponse> {
    try {
      this.logger.log('Creating WebRTC connection with OpenAI');
      
      if (!offer || !offer.sdp) {
        throw new Error('Invalid WebRTC offer: SDP is missing');
      }
      
      if (this.debugMode) {
        this.logger.debug('WebRTC offer:', JSON.stringify({
          type: offer.type,
          sdp_length: offer.sdp?.length || 0
        }, null, 2));
      }
      
      // Make actual API call to OpenAI's WebRTC endpoint
      try {
        this.logger.log('Making API call to OpenAI WebRTC endpoint');
        
        const response = await axios.post('https://api.openai.com/v1/realtime', {
          offer: offer,
          model: this.realtimeModel
        }, {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'OpenAI-Beta': 'realtime=v1',
            'Content-Type': 'application/json'
          },
          timeout: 10000 // 10 second timeout
        });
        
        // Process the successful response
        const openaiResponse = response.data as WebRTCConnectionResponse;
        
        if (!openaiResponse || !openaiResponse.session_id) {
          throw new Error('Invalid response from OpenAI: Missing session ID');
        }
        
        this.logger.log(`WebRTC connection established with OpenAI, session ID: ${openaiResponse.session_id}`);
        
        // Keep track of active sessions
        this.activeSessions.add(openaiResponse.session_id);
        
        return openaiResponse;
      } catch (error) {
        // Handle API errors
        const errorMessage = error.response?.data?.error?.message || error.message;
        this.logger.error(`Error calling OpenAI WebRTC API: ${errorMessage}`);
        throw error;
      }
    } catch (error) {
      this.logger.error('Error creating WebRTC connection:', error);
      throw error;
    }
  }
  
  /**
   * Create a Realtime API session
   * @param sessionId Client's session ID 
   * @param config Optional configuration for the session
   */
  createRealtimeSession(sessionId: string, config: any = {}): boolean {
    try {
      if (this.realtimeSessions.has(sessionId)) {
        this.logger.warn(`Session ${sessionId} already exists`);
        return true;
      }
      
      this.logger.log(`Creating new Realtime session with ID: ${sessionId}`);
      
      // Create the session with initial properties
      this.realtimeSessions.set(sessionId, {
        id: sessionId,
        clientId: sessionId,
        clientSocket: null, // This will be set by the gateway
        state: 'created',
        config: {
          voice: config.voice || 'alloy',
          modalities: config.modalities || ["text", "audio"],
          inputFormat: "pcm_s16le", // Updated to use raw PCM audio
          outputFormat: "mp3", // MP3 for output
          ...config
        },
        active: true,
        createdAt: new Date(),
        lastActivity: new Date(),
        clientCallbacks: {
          onEvent: () => {} // Default no-op callback
        }
      });
      
      return true;
    } catch (error) {
      this.logger.error('Error creating Realtime session:', error);
      return false;
    }
  }
  
  /**
   * Connect to OpenAI's realtime API via WebSocket
   * @param sessionId Client's session ID
   */
  async connectRealtimeSession(sessionId: string, initialPrompt: string): Promise<boolean> {
    try {
      this.logger.log(`connectRealtimeSession called for session ${sessionId}`);
      
      // Get the session
      const session = this.realtimeSessions.get(sessionId);
      if (!session) {
        this.logger.error(`Session ${sessionId} not found in connectRealtimeSession`);
        return false;
      }
      
      // If already connected, return success
      if (session.state === 'connected' && session.modelConnection) {
        this.logger.log(`Session ${sessionId} is already connected, returning true`);
        return true;
      }
      
      // Update session state
      this.logger.log(`Setting session ${sessionId} state to 'connecting'`);
      session.state = 'connecting';
      
      // Clean up any existing connection
      if (session.modelConnection) {
        this.logger.log(`Closing existing WebSocket connection for session ${sessionId}`);
        try {
          session.modelConnection.close();
        } catch (e) {
          this.logger.error(`Error closing existing connection: ${e.message}`);
        }
        session.modelConnection = undefined;
      }
      
      // Use the exact URL format and parameters from the API documentation
      const url = `wss://api.openai.com/v1/realtime?model=${this.realtimeModel}`;
      
      this.logger.log(`Connecting to OpenAI real-time API for session ${sessionId}`);
      this.logger.log(`Using URL: ${url}`);
      this.logger.log(`Using API version: ${this.apiVersion}`);
      this.logger.log(`OpenAI Realtime model: ${this.realtimeModel}`);
      
      // Validate API key before attempting connection
      if (!this.apiKey || this.apiKey.length < 30) {
        this.logger.error(`Invalid API key for session ${sessionId}. Key length: ${this.apiKey ? this.apiKey.length : 0}`);
        session.state = 'disconnected';
        return false;
      }
      
      // Create WebSocket with proper headers
      this.logger.log(`Creating new WebSocket connection`);
      const ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });
      
      // Set up a timeout for the connection attempt
      this.logger.log(`Setting up connection timeout (30 seconds)`);
      const connectionTimeout = setTimeout(() => {
        this.logger.error(`Connection timeout after 30 seconds for session ${sessionId}`);
        if (ws.readyState !== WebSocket.CLOSED) {
          try {
            ws.close();
          } catch (e) {
            this.logger.error(`Error closing WebSocket after timeout: ${e.message}`);
          }
        }
        return false;
      }, 30000);
      
      // Store the connection
      session.modelConnection = ws;
      
      // Set up handlers - use simpler event handling like in the test script
      this.logger.log(`Setting up WebSocket event handlers`);
      return new Promise<boolean>((resolve) => {
        // Connection opened handler
        ws.on('open', () => {
          this.logger.log(`WebSocket connection opened for session ${sessionId}`);
          session.state = 'connected';
          session.modelConnection = ws;
          
          // Update session with configuration settings
          this.logger.log(`Sending session.update to configure session ${sessionId}`);
          this.logger.log(`Configuration: voice=${session.config.voice}, modalities=${session.config.modalities.join(',')}`);
          
          try {
            const sessionConfig = {
              type: 'session.update',
              session: {
                instructions: initialPrompt || 'You are a helpful AI assistant. Answer the user\'s questions in a friendly and concise manner.',
                voice: session.config.voice,
                modalities: session.config.modalities,
                input_audio_format: "pcm_s16le",
                output_audio_format: "mp3",
                turn_detection: {
                  pauses: {
                    speech_threshold: 300, // 300ms of silence indicates speech pause
                    speech_end: 1000 // 1 second of silence indicates user finished speaking
                  }
                }
              }
            };
            
            this.logger.log(`Sending session config: ${JSON.stringify(sessionConfig)}`);
            ws.send(JSON.stringify(sessionConfig));
            this.logger.log(`Session configuration sent successfully`);
          } catch (error) {
            this.logger.error(`Error sending session configuration: ${error.message}`);
          }
          
          clearTimeout(connectionTimeout);
          
          // We're now connected
          this.logger.log(`Resolving connectRealtimeSession promise with true for session ${sessionId}`);
          resolve(true);
        });
        
        // Message handler
        ws.on('message', (data: any) => {
          try {
            // Parse the message as JSON
            const messageStr = data.toString();
            
            // Debug logging
            if (this.debugMode) {
              this.logger.debug(`Received WebSocket message for session ${sessionId} (first 100 chars): ${messageStr.substring(0, 100)}...`);
            }
            
            try {
              // Parse the JSON message
              const event = JSON.parse(messageStr);
              
              // Log event type
              this.logger.log(`Received event type: ${event.type} for session ${sessionId}`);
              
              // Process the event by type
              this.handleRealtimeEvent(sessionId, event, session.clientCallbacks.onEvent);
            } catch (jsonError) {
              this.logger.error(`Error parsing JSON message for session ${sessionId}:`, jsonError);
              this.logger.debug(`Raw message was (first 100 chars): ${messageStr.substring(0, 100)}...`);
            }
          } catch (err) {
            this.logger.error(`Error processing WebSocket message for session ${sessionId}:`, err);
          }
        });
        
        // Error handler
        ws.on('error', (error) => {
          this.logger.error(`WebSocket error for session ${sessionId}: ${error.message}`);
          
          // Log additional error details
          const wsError = error as any;
          if (wsError.code) {
            this.logger.error(`Error code: ${wsError.code}`);
          }
          
          clearTimeout(connectionTimeout);
          
          // Keep the session in "connecting" state for retry attempts
          if (session) {
            this.logger.log(`Setting session ${sessionId} state to 'disconnected' after error`);
            session.state = 'disconnected';
          }
          
          this.logger.log(`Resolving connectRealtimeSession promise with false for session ${sessionId} due to error`);
          resolve(false);
        });
        
        // Close handler
        ws.on('close', (code, reason) => {
          this.logger.log(`WebSocket closed for session ${sessionId}: ${code} ${reason || 'No reason provided'}`);
          clearTimeout(connectionTimeout);
          
          // Don't close the session here to prevent premature termination
          // Only update the state so we know it's disconnected
          if (session) {
            this.logger.log(`Setting session ${sessionId} state to 'disconnected' after close`);
            session.state = 'disconnected';
            session.modelConnection = undefined;
          }
          
          // If the connection was never established (code wasn't opened), resolve with false
          this.logger.log(`Resolving connectRealtimeSession promise with false for session ${sessionId} due to close`);
          resolve(false);
        });
      });
    } catch (error) {
      this.logger.error(`Error in connectRealtimeSession for session ${sessionId}:`, error);
      return false;
    }
  }
  
  /**
   * Send audio buffer to OpenAI
   * @param sessionId Client's session ID 
   * @param audioBuffer Audio data buffer
   */
  async sendAudioBuffer(sessionId: string, audioBuffer: Uint8Array): Promise<boolean> {
    try {
      // Get the session
      const session = this.realtimeSessions.get(sessionId);
      if (!session) {
        this.logger.error(`Session ${sessionId} not found`);
        return false;
      }

      // Check if connected
      if (session.state !== 'connected' || !session.modelConnection) {
        this.logger.error(`Session ${sessionId} is not connected`);
        return false;
      }

      // Update activity timestamp
      session.lastActivity = new Date();
      session.latestMediaTimestamp = Date.now();

      // Base64 encode the audio buffer
      const base64Audio = Buffer.from(audioBuffer).toString('base64');
      
      // Log audio length in debug mode
      if (this.debugMode) {
        this.logger.debug(`Sending base64 audio (${base64Audio.length} chars) to OpenAI for session ${sessionId}`);
      }
      
      try {
        // Send audio buffer to the model via the WebSocket connection
        // Using input_audio_buffer.append as per the realtime API docs
        session.modelConnection.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64Audio
        }));
        
        return true;
      } catch (wsError) {
        this.logger.error(`WebSocket send error for session ${sessionId}:`, wsError);
        return false;
      }
    } catch (error) {
      this.logger.error('Error sending audio buffer:', error);
      return false;
    }
  }
  
  /**
   * Handle Realtime events from OpenAI
   * @param sessionId The session ID
   * @param event The event received from OpenAI
   * @param callback The callback to send the event to the client
   */
  private handleRealtimeEvent(
    sessionId: string, 
    event: any, 
    callback?: (event: any) => void
  ): void {
    // Ignore if no callback
    if (!callback) {
      return;
    }

    try {
      const session = this.realtimeSessions.get(sessionId);
      if (!session) {
        this.logger.error(`Session ${sessionId} not found when handling event`);
        return;
      }

      // Update activity timestamp
      session.lastActivity = new Date();

      // Log the event type
      if (this.debugMode) {
        this.logger.debug(`Processing event type: ${event.type} for session ${sessionId}`);
      }

      // Process based on event type
      switch (event.type) {
        case 'message':
          // General message event
          this.logger.log(`Message from OpenAI: ${event.message}`);
          callback(event);
          break;

        case 'session.created':
        case 'session.updated':
          // Session events
          this.logger.log(`Session ${event.type}: ${JSON.stringify(event.session)}`);
          callback(event);
          break;

        case 'response.created':
          // New response started
          session.currentResponseId = event.response.id;
          this.logger.log(`New response created: ${session.currentResponseId}`);
          callback(event);
          break;

        case 'response.text.delta':
          // Text deltas (streaming text)
          if (this.debugMode) {
            this.logger.debug(`Text delta: ${event.delta.text}`);
          }
          callback(event);
          break;

        case 'response.audio.delta':
          // Audio deltas (streaming audio)
          if (this.debugMode) {
            this.logger.debug(`Audio delta: ${event.delta.audio ? `${event.delta.audio.substring(0, 20)}... (${event.delta.audio.length} chars)` : 'empty'}`);
          }
          callback(event);
          break;

        case 'response.audio_transcript.delta':
          // Audio transcript deltas (transcription of the audio being returned)
          if (this.debugMode) {
            this.logger.debug(`Audio transcript delta: ${event.delta.text}`);
          }
          callback(event);
          break;

        case 'response.audio.final':
          // Final audio received
          this.logger.log(`Final audio received for response ${session.currentResponseId}`);
          callback(event);
          break;

        case 'response.text.final':
          // Final text received
          this.logger.log(`Final text received for response ${session.currentResponseId}`);
          callback(event);
          break;

        case 'response.completed':
          // Response completed
          this.logger.log(`Response completed: ${session.currentResponseId}`);
          session.currentResponseId = null;
          callback(event);
          break;

        case 'input_audio_buffer.speech_started':
          // User speech started
          this.logger.log(`Speech started`);
          callback(event);
          break;

        case 'input_audio_buffer.speech_stopped':
          // User speech stopped
          this.logger.log(`Speech stopped`);
          callback(event);
          break;

        case 'input_audio_buffer.committed':
          // Audio buffer committed
          if (this.debugMode) {
            this.logger.debug(`Audio buffer committed: ${event.duration_ms}ms`);
          }
          callback(event);
          break;

        case 'error':
          // Error event
          this.logger.error(`Error from OpenAI: ${event.error.message}`);
          callback(event);
          break;

        default:
          // Unknown event type
          this.logger.warn(`Unknown event type: ${event.type}`);
          callback(event);
          break;
      }
    } catch (error) {
      this.logger.error(`Error handling realtime event: ${error.message}`);
      if (this.debugMode) {
        this.logger.debug(`Event was: ${JSON.stringify(event)}`);
      }
    }
  }
  
  /**
   * Close a realtime session
   * @param sessionId Client's session ID
   */
  async closeRealtimeSession(sessionId: string): Promise<void> {
    try {
      const session = this.realtimeSessions.get(sessionId);
      if (!session) {
        return;
      }
      
      // Close WebSocket connection if it exists
      if (session.modelConnection) {
        try {
          session.modelConnection.close();
        } catch (err) {
          this.logger.error(`Error closing WebSocket for session ${sessionId}:`, err);
        }
        session.modelConnection = undefined;
      }
      
      // Update session state
      session.state = 'disconnected';
      
      // Remove session
      this.realtimeSessions.delete(sessionId);
      
      this.logger.log(`Realtime session ${sessionId} closed`);
    } catch (error) {
      this.logger.error(`Error closing realtime session:`, error);
    }
  }
  
  /**
   * Close a WebRTC connection with OpenAI
   * @param sessionId The OpenAI session ID
   */
  async closeWebRTCConnection(sessionId: string) {
    try {
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      
      // Check if the session exists
      if (!this.activeSessions.has(sessionId)) {
        this.logger.warn(`Attempted to close non-existent session: ${sessionId}`);
        return { success: true, message: 'Session was already closed or did not exist' };
      }
      
      this.logger.log(`Closing WebRTC connection for session ${sessionId}`);
      
      // Remove from active sessions
      this.activeSessions.delete(sessionId);
      
      // Note: OpenAI might provide an API to explicitly close the session in the future
      // For now, we just stop tracking it locally
      
      this.logger.log(`WebRTC connection closed for session ${sessionId}`);
      
      return { success: true };
    } catch (error) {
      this.logger.error(`Error closing WebRTC connection for session ${sessionId}:`, error);
      throw error;
    }
  }
  
  /**
   * Cleanup idle sessions
   */
  private cleanupSessions(): void {
    try {
      const now = new Date();
      const timeout = 5 * 60 * 1000; // 5 minutes
      let cleaned = 0;
      
      // Log current session counts
      if (this.debugMode) {
        this.logger.debug(`Active WebRTC sessions: ${this.activeSessions.size}`);
        this.logger.debug(`Active Realtime sessions: ${this.realtimeSessions.size}`);
      }
      
      // Cleanup realtime sessions
      for (const [sessionId, session] of this.realtimeSessions.entries()) {
        if (now.getTime() - session.lastActivity.getTime() > timeout) {
          this.logger.log(`Cleaning up idle realtime session ${sessionId}`);
          this.closeRealtimeSession(sessionId).catch(err => {
            this.logger.error(`Error closing realtime session ${sessionId}:`, err);
          });
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        this.logger.log(`Cleaned up ${cleaned} idle sessions`);
      }
    } catch (error) {
      this.logger.error('Error during session cleanup:', error);
    }
  }
  
  /**
   * Clean up resources on service shutdown
   */
  async onModuleDestroy() {
    this.logger.log('WebRTC service shutting down, cleaning up resources...');
    
    // Close all realtime sessions
    for (const [sessionId, session] of this.realtimeSessions.entries()) {
      if (session.modelConnection) {
        try {
          session.modelConnection.close();
        } catch (err) {
          this.logger.error(`Error closing WebSocket for session ${sessionId}:`, err);
        }
      }
    }
    
    this.logger.log('WebRTC service shutting down, cleaned up resources');
  }

  /**
   * Get a realtime session by ID
   * @param sessionId Session ID
   */
  getRealtimeSession(sessionId: string): RealtimeSession | undefined {
    return this.realtimeSessions.get(sessionId);
  }

  /**
   * Send an event to the OpenAI Realtime API
   * @param sessionId Session ID
   * @param event Event to send
   */
  async sendRealtimeEvent(sessionId: string, event: any): Promise<boolean> {
    try {
      const session = this.realtimeSessions.get(sessionId);
      if (!session) {
        this.logger.error(`Session ${sessionId} not found`);
        return false;
      }

      if (session.state !== 'connected' || !session.modelConnection) {
        this.logger.error(`Session ${sessionId} is not connected`);
        return false;
      }

      this.logger.debug(`Sending event to OpenAI for session ${sessionId}: ${JSON.stringify(event)}`);
      session.modelConnection.send(JSON.stringify(event));
      return true;
    } catch (error) {
      this.logger.error(`Error sending realtime event: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if a realtime session exists
   * @param sessionId Client's session ID
   */
  hasRealtimeSession(sessionId: string): boolean {
    return this.realtimeSessions.has(sessionId);
  }

  /**
   * Associate a client socket with a session
   * @param sessionId Client's session ID
   * @param clientSocket The client socket
   */
  async associateClientSocket(sessionId: string, clientSocket: Socket): Promise<RealtimeSession | null> {
    try {
      const session = this.realtimeSessions.get(sessionId);
      if (!session) {
        this.logger.error(`Session ${sessionId} not found`);
        return null;
      }
      
      // Store the client socket
      session.clientSocket = clientSocket;
      
      // Set up client event callback
      session.clientCallbacks = {
        onEvent: (event: any) => {
          try {
            // Forward event to client
            clientSocket.emit('realtime-event', event);
            
            // Also process audio events separately for compatibility
            if (event.type === 'response.audio.delta' && event.delta && event.delta.audio) {
              clientSocket.emit('audio-stream', {
                audio: event.delta.audio,
                sessionId
              });
            }
          } catch (error) {
            this.logger.error(`Error forwarding event to client: ${error.message}`);
          }
        }
      };
      
      // Set up cleanup on disconnect
      clientSocket.on('disconnect', () => {
        this.logger.log(`Client ${clientSocket.id} disconnected, marking session ${sessionId} for cleanup`);
        session.state = 'disconnected';
      });
      
      this.logger.log(`Associated client socket ${clientSocket.id} with session ${sessionId}`);
      return session;
    } catch (error) {
      this.logger.error(`Error associating client socket: ${error.message}`);
      return null;
    }
  }
} 