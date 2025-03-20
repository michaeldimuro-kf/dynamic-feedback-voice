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

interface ClientState {
  audioChunks: Uint8Array[];
  isProcessing: boolean;
}

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:5173'], // Vite dev server default port
    credentials: true
  }
})
@Injectable()
export class VoiceChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  
  private readonly logger = new Logger(VoiceChatGateway.name);

  // Map to track ongoing conversations for each client
  private readonly clientStates = new Map<string, ClientState>();

  constructor(private readonly voiceChatService: VoiceChatService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    
    // Initialize the client's state
    this.clientStates.set(client.id, { 
      audioChunks: [],
      isProcessing: false
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Clean up when client disconnects
    this.clientStates.delete(client.id);
  }
  
  // Event handler for receiving streaming audio chunks
  @SubscribeMessage('streaming-audio')
  async handleStreamingAudio(
    @MessageBody() data: { audio: number[]; isFinal: boolean; mimeType?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const clientId = client.id;
    this.logger.log(`Received audio chunk from ${clientId}, isFinal: ${data.isFinal}, size: ${data.audio.length} bytes`);
    
    // Initialize client state if needed
    if (!this.clientStates.has(clientId)) {
      this.clientStates.set(clientId, {
        audioChunks: [],
        isProcessing: false
      });
    }
    
    const clientState = this.clientStates.get(clientId);
    
    if (!clientState) {
      this.logger.error(`Client state not found for ${clientId}`);
      client.emit('error', 'Internal server error: client state not found');
      return;
    }
    
    // Add current chunk to the accumulated audio chunks
    if (data.audio.length > 0) {
      // If this is the final chunk, we only want to process the complete audio
      // that's being sent, not combine it with previous chunks (which would duplicate the audio)
      if (data.isFinal) {
        // Clear the current chunks as we'll only use the final complete recording
        clientState.audioChunks = [];
      }
      
      clientState.audioChunks.push(new Uint8Array(data.audio));
    }
    
    // If this is the final chunk, process the complete audio
    if (data.isFinal) {
      // Check if we're already processing to prevent duplicate requests
      if (clientState.isProcessing) {
        this.logger.warn(`Already processing audio for client ${clientId}`);
        client.emit('error', 'Already processing a request');
        return;
      }
      
      // Mark as processing
      clientState.isProcessing = true;
      
      try {
        // Combine all chunks into a single buffer
        const totalLength = clientState.audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
        this.logger.log(`Processing complete audio: ${totalLength} bytes from ${clientState.audioChunks.length} chunks`);
        
        // Skip if the audio is too small
        if (totalLength < 1000) {
          this.logger.warn(`Audio too short (${totalLength} bytes), not processing`);
          client.emit('error', 'Audio too short, please speak longer');
          clientState.audioChunks = [];
          clientState.isProcessing = false;
          return;
        }
        
        // Combine audio chunks into a single buffer
        const combinedBuffer = Buffer.concat(clientState.audioChunks.map(chunk => Buffer.from(chunk)), totalLength);
        
        // Process the complete audio flow
        const result = await this.voiceChatService.processCompleteAudioFlow(
          combinedBuffer, 
          data.mimeType || 'audio/webm'
        );
        
        // Send transcription to client
        this.logger.log(`Sending transcription: "${result.transcription}"`);
        client.emit('transcription-result', { text: result.transcription });
        
        // Send AI response text to client
        this.logger.log(`Sending AI response: "${result.aiResponse.substring(0, 100)}..."`);
        client.emit('ai-response', { text: result.aiResponse });
        
        // Send audio response to client
        this.logger.log(`Sending audio response: ${result.audioResponse.length} bytes`);
        client.emit('audio-response', { audio: Array.from(new Uint8Array(result.audioResponse)) });
        
        // Clean up
        clientState.audioChunks = [];
      } catch (error) {
        this.logger.error('Error processing audio:', error);
        client.emit('error', `Error processing audio: ${error.message}`);
      } finally {
        // Reset processing flag
        clientState.isProcessing = false;
      }
    }
  }
  
  // Event handler for text input instead of audio
  @SubscribeMessage('text-input')
  async handleTextInput(
    @MessageBody() data: { text: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const clientId = client.id;
    this.logger.log(`Received text input from ${clientId}: "${data.text}"`);
    
    // Get client state
    const clientState = this.clientStates.get(clientId);
    if (!clientState) {
      this.logger.error(`Client state not found for ${clientId}`);
      client.emit('error', 'Internal server error: client state not found');
      return;
    }
    
    // Check if already processing
    if (clientState.isProcessing) {
      this.logger.warn(`Already processing for client ${clientId}`);
      client.emit('error', 'Already processing a request');
      return;
    }
    
    // Mark as processing
    clientState.isProcessing = true;
    
    try {
      // Generate AI response
      const aiResponse = await this.voiceChatService.generateAIResponse(data.text);
      
      // Send AI response text to client
      client.emit('ai-response', { text: aiResponse });
      
      // Generate and send speech audio
      const audioResponse = await this.voiceChatService.generateSpeechAudio(aiResponse);
      client.emit('audio-response', { audio: Array.from(new Uint8Array(audioResponse)) });
    } catch (error) {
      this.logger.error('Error processing text input:', error);
      client.emit('error', `Error processing text: ${error.message}`);
    } finally {
      // Reset processing flag
      clientState.isProcessing = false;
    }
  }

  // Add new handler for page summarization
  @SubscribeMessage('summarize-page')
  async handlePageSummarization(
    @MessageBody() data: { pageNumber: number },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const clientId = client.id;
    this.logger.log(`Received page summarization request from ${clientId} for page ${data.pageNumber}`);
    
    // Initialize client state if needed
    if (!this.clientStates.has(clientId)) {
      this.clientStates.set(clientId, {
        audioChunks: [],
        isProcessing: false
      });
    }
    
    const clientState = this.clientStates.get(clientId);
    
    if (!clientState) {
      this.logger.error(`Client state not found for ${clientId}`);
      client.emit('error', 'Internal server error: client state not found');
      return;
    }
    
    // Check if we're already processing to prevent duplicate requests
    if (clientState.isProcessing) {
      this.logger.warn(`Already processing request for client ${clientId}`);
      client.emit('error', 'Already processing a request');
      return;
    }
    
    // Mark as processing
    clientState.isProcessing = true;
    
    try {
      // Get summary and audio for the page
      const result = await this.voiceChatService.summarizePageContent(data.pageNumber);
      
      // Send the summary and audio back to the client
      client.emit('page-summary', {
        text: result.summary,
        pageNumber: data.pageNumber,
        pageTitle: result.pageTitle,
        pageCount: result.pageCount
      });
      
      // Convert audio buffer to array format that can be sent over socket.io
      const audioArray = Array.from(new Uint8Array(result.audioResponse));
      
      // Emit the audio response
      client.emit('page-audio-response', {
        audio: audioArray,
        pageNumber: data.pageNumber
      });
      
      // Mark as no longer processing
      clientState.isProcessing = false;
    } catch (error) {
      this.logger.error(`Error processing page ${data.pageNumber}:`, error);
      client.emit('error', `Error summarizing page ${data.pageNumber}: ${error.message || 'Unknown error'}`);
      
      // Mark as no longer processing
      clientState.isProcessing = false;
    }
  }
} 