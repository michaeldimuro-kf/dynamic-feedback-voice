import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import axios from 'axios';

interface WebRTCConnectionResponse {
  answer: RTCSessionDescriptionInit;
  ice_candidates: RTCIceCandidateInit[];
  session_id: string;
}

@Injectable()
export class WebRTCService implements OnModuleDestroy {
  private readonly logger = new Logger(WebRTCService.name);
  private readonly openai: OpenAI;
  private readonly apiKey: string;
  private readonly debugMode: boolean;
  private readonly activeSessions = new Set<string>();
  private healthCheckInterval: NodeJS.Timeout;
  
  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.debugMode = this.configService.get<string>('DEBUG_MODE') === 'true';
    
    if (!this.apiKey) {
      this.logger.error('OPENAI_API_KEY is not defined in the environment');
      throw new Error('OPENAI_API_KEY is required');
    }
    
    this.openai = new OpenAI({
      apiKey: this.apiKey,
    });
    
    // Initialize health check - run every 30 seconds
    this.healthCheckInterval = setInterval(() => this.healthCheck(), 30000);
    this.logger.log('WebRTC service initialized with health check');
  }
  
  onModuleDestroy() {
    // Clean up interval on application shutdown
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.logger.log('WebRTC service shutting down, cleaned up resources');
  }
  
  /**
   * Health check to ensure the service is running
   */
  healthCheck() {
    try {
      this.logger.debug(`Active WebRTC sessions: ${this.activeSessions.size}`);
      this.checkActiveSessions();
      return { status: 'healthy', activeSessions: this.activeSessions.size };
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return { status: 'unhealthy', error: error.message };
    }
  }
  
  /**
   * Periodically check active sessions
   */
  private checkActiveSessions() {
    // Log active sessions for debugging
    if (this.activeSessions.size > 0) {
      this.logger.debug(`Active session IDs: ${Array.from(this.activeSessions).join(', ')}`);
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
      
      // Generate ephemeral key for this session
      const ephemeralKey = await this.generateEphemeralKey();
      
      // Make actual API call to OpenAI's WebRTC endpoint
      try {
        this.logger.log('Making API call to OpenAI WebRTC endpoint');
        
        const response = await axios.post('https://api.openai.com/v1/realtime', {
          offer: offer,
          model: "gpt-4o-realtime-preview-2024-12-17"
        }, {
          headers: {
            'Authorization': `Bearer ${ephemeralKey}`,
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
        
        if (this.debugMode) {
          this.logger.debug('Detailed error:', JSON.stringify({
            status: error.response?.status,
            headers: error.response?.headers,
            data: error.response?.data
          }, null, 2));
          
          // If in debug mode, return a mock response
          this.logger.warn('Debug mode enabled, returning mock WebRTC connection response');
          
          const mockSessionId = `mock-${Date.now()}`;
          this.activeSessions.add(mockSessionId);
          
          return {
            session_id: mockSessionId,
            answer: {
              type: 'answer',
              sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=msid-semantic: WMS\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:mock\r\na=ice-pwd:mock\r\na=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF\r\na=setup:active\r\na=mid:0\r\na=recvonly\r\na=rtcp-mux\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n'
            },
            ice_candidates: [
              {
                candidate: 'candidate:0 1 UDP 2122252543 192.168.1.1 30000 typ host',
                sdpMid: '0',
                sdpMLineIndex: 0
              }
            ]
          };
        }
        
        throw error;
      }
    } catch (error) {
      this.logger.error('Error creating WebRTC connection:', error);
      throw error;
    }
  }
  
  /**
   * Add ICE candidate to the WebRTC connection
   * @param sessionId The OpenAI session ID
   * @param candidate The ICE candidate
   */
  async addICECandidate(sessionId: string, candidate: RTCIceCandidateInit) {
    try {
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      
      if (!this.activeSessions.has(sessionId)) {
        throw new Error(`Session ${sessionId} does not exist or has been closed`);
      }
      
      this.logger.log(`Adding ICE candidate to session ${sessionId}`);
      
      if (this.debugMode) {
        this.logger.debug('ICE candidate:', JSON.stringify(candidate, null, 2));
      }
      
      // In a production environment, you would send this to OpenAI's API
      // For now, we'll just log it since the API doesn't support this directly
      this.logger.log(`ICE candidate added to session ${sessionId} (local handling only)`);
      
      return { success: true };
    } catch (error) {
      this.logger.error(`Error adding ICE candidate to session ${sessionId}:`, error);
      throw error;
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
   * Generate an ephemeral key for OpenAI WebRTC API
   * 
   * According to the docs, this should be done by calling a key generation API endpoint
   * For now, we're using the API key directly in debug mode
   */
  private async generateEphemeralKey(): Promise<string> {
    try {
      // In a production environment, you would use OpenAI's ephemeral key API
      // For now, we'll just use the regular API key
      
      this.logger.log(`Generating ephemeral key for WebRTC session`);
      
      // Since the ephemeral key API isn't fully documented yet, we'll use a placeholder approach
      // In a real implementation, you'd make an API request to get a temporary key
      
      // TODO: Replace with actual ephemeral key generation when OpenAI docs are updated
      return this.apiKey;
    } catch (error) {
      this.logger.error(`Error generating ephemeral key:`, error);
      throw error;
    }
  }
} 