import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import * as ffmpeg from 'fluent-ffmpeg';

@Injectable()
export class VoiceChatService {
  private readonly openai: OpenAI;
  private readonly logger = new Logger(VoiceChatService.name);
  private readonly apiKey: string;
  
  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENAI_API_KEY');
    
    if (!this.apiKey) {
      this.logger.error('OPENAI_API_KEY is not defined in the environment');
      throw new Error('OPENAI_API_KEY is required');
    }
    
    this.openai = new OpenAI({
      apiKey: this.apiKey,
    });
    
    // Configure ffmpeg with the installer path
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
    this.logger.log(`FFmpeg path set to: ${ffmpegInstaller.path}`);
  }
  
  /**
   * Generate a response to a message using OpenAI's GPT model
   * @param message The user's message
   * @param conversationHistory Previous conversation history
   */
  async generateTextResponse(message: string, conversationHistory: any[] = []): Promise<string> {
    try {
      this.logger.log('Generating response...');
      
      // Create messages array
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        ...conversationHistory,
        { role: 'user', content: message }
      ];
      
      // Generate response
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: messages,
        max_tokens: 150,
      });
      
      const responseText = response.choices[0]?.message?.content || '';
      
      this.logger.log('Response generated successfully');
      return responseText;
    } catch (error) {
      this.logger.error('Error generating response:', error);
      throw error;
    }
  }
  
  /**
   * Convert text to speech using OpenAI's TTS model
   * @param text Text to convert to speech
   * @param voice Voice to use (default: 'alloy')
   */
  async textToSpeech(text: string, voice: string = 'alloy'): Promise<Buffer> {
    try {
      this.logger.log(`Converting text to speech using voice: ${voice}...`);
      
      // Generate speech
      const mp3 = await this.openai.audio.speech.create({
        model: 'tts-1',
        voice: voice as any,
        input: text,
      });
      
      // Convert to buffer
      const buffer = Buffer.from(await mp3.arrayBuffer());
      
      this.logger.log('Text-to-speech conversion successful');
      return buffer;
    } catch (error) {
      this.logger.error('Error converting text to speech:', error);
      throw error;
    }
  }
  
  /**
   * Health check to ensure the service is running
   */
  healthCheck() {
    try {
      this.logger.debug('Voice Chat service health check');
      return { status: 'healthy' };
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return { status: 'unhealthy', error: error.message };
    }
  }
  
  /**
   * Process a buffer for transcription
   * @param audioBuffer Audio data as buffer
   * @param mimeType MIME type of the audio (default: 'audio/webm')
   */
  async transcribeAudio(audioBuffer: Buffer, mimeType: string = 'audio/webm'): Promise<string> {
    try {
      this.logger.log(`Transcribing audio: ${audioBuffer.length} bytes, mime type: ${mimeType}`);
      
      // Determine file extension
      let fileExtension = '.webm';
      if (mimeType) {
        if (mimeType.includes('mp3')) fileExtension = '.mp3';
        else if (mimeType.includes('wav')) fileExtension = '.wav';
        else if (mimeType.includes('ogg')) fileExtension = '.ogg';
      }
      
      // Create temporary files
      const tempDir = os.tmpdir();
      const originalFilePath = path.join(tempDir, `audio-original-${Date.now()}${fileExtension}`);
      const wavFilePath = path.join(tempDir, `audio-converted-${Date.now()}.wav`);
      
      this.logger.log(`Writing audio buffer to temporary file: ${originalFilePath}`);
      fs.writeFileSync(originalFilePath, audioBuffer);
      
      // Convert to WAV for Whisper API
      await this.convertToWav(originalFilePath, wavFilePath);
      
      // Get transcription
      const whisperResponse = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(wavFilePath),
        model: 'whisper-1',
      });
      
      const transcription = whisperResponse.text;
      this.logger.log(`Transcription result: "${transcription}"`);
      
      // Clean up temp files
      this.cleanupFiles([originalFilePath, wavFilePath]);
      
      return transcription;
    } catch (error) {
      this.logger.error('Error transcribing audio:', error);
      throw error;
    }
  }
  
  // Generate AI response text based on transcription
  async generateAIResponse(transcription: string): Promise<string> {
    try {
      this.logger.log('Generating AI response with GPT-4...');
      
      const aiResponse = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { 
            role: 'system', 
            content: 'You are a helpful PDF document assistant. You help users understand and analyze PDF documents by providing thoughtful, concise, and informative responses. Answer questions about the content shown in the document, explain concepts, summarize information, and provide insights. If asked about something that might not be in the current document, still provide a helpful response while acknowledging the potential limitations of your knowledge about the specific document. Keep your responses conversational but informative.' 
          },
          { role: 'user', content: transcription }
        ],
        temperature: 0.7,
        max_tokens: 500,
      });
      
      const responseText = aiResponse.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
      this.logger.log(`AI response: "${responseText.substring(0, 100)}..."`);
      
      return responseText;
    } catch (error) {
      this.logger.error('Error generating AI response:', error);
      throw error;
    }
  }
  
  // Generate text-to-speech audio from the AI response
  async generateSpeechAudio(text: string): Promise<Buffer> {
    try {
      this.logger.log('Generating audio response with TTS API...');
      const audioResponse = await this.openai.audio.speech.create({
        model: 'tts-1',
        voice: 'alloy',
        input: text,
      });
      
      // Get audio data as buffer
      const responseAudioBuffer = Buffer.from(await audioResponse.arrayBuffer());
      this.logger.log(`Generated audio response size: ${responseAudioBuffer.length} bytes`);
      
      return responseAudioBuffer;
    } catch (error) {
      this.logger.error('Error generating speech audio:', error);
      throw error;
    }
  }
  
  // Convert audio file to WAV format
  private async convertToWav(inputPath: string, outputPath: string): Promise<void> {
    this.logger.log(`Converting audio file to WAV format: ${inputPath} -> ${outputPath}`);
    
    return new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .inputOption('-y')
        .audioFrequency(16000)
        .audioChannels(1)
        .format('wav')
        .on('error', (err) => {
          this.logger.error('Error during ffmpeg conversion:', err);
          reject(err);
        })
        .on('end', () => {
          this.logger.log('Audio conversion successful');
          resolve();
        })
        .save(outputPath);
    });
  }
  
  // Clean up temporary files
  private cleanupFiles(filePaths: string[]): void {
    for (const filePath of filePaths) {
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        this.logger.error(`Error deleting temporary file ${filePath}:`, error);
      }
    }
    this.logger.verbose('Temporary audio files deleted');
  }
  
  // Process complete audio flow: transcribe, generate response, generate speech
  async processCompleteAudioFlow(audioBuffer: Buffer, mimeType: string = 'audio/webm'): Promise<{ 
    transcription: string; 
    aiResponse: string; 
    audioResponse: Buffer;
  }> {
    // Transcribe the audio to text
    const transcription = await this.transcribeAudio(audioBuffer, mimeType);
    
    // Generate AI text response
    const aiResponse = await this.generateAIResponse(transcription);
    
    // Generate speech audio from the AI response
    const audioResponse = await this.generateSpeechAudio(aiResponse);
    
    return {
      transcription,
      aiResponse,
      audioResponse
    };
  }

  // Add new method to get page content from prompt-data.json
  async getPageContent(pageNumber: number): Promise<{ 
    content: string; 
    pageTitle: string;
    pageCount: number;
  }> {
    try {
      // Read the prompt-data.json file
      const promptDataPath = path.join(process.cwd(), 'public', 'prompt-data.json');
      const promptDataContent = fs.readFileSync(promptDataPath, 'utf-8');
      const promptData = JSON.parse(promptDataContent);
      
      // Find the page data
      const pageData = promptData.pages?.find((page: any) => page.page === pageNumber.toString()) || 
                        promptData.find((page: any) => page.page === pageNumber.toString());
      
      if (!pageData) {
        throw new Error(`Page ${pageNumber} not found in prompt data`);
      }
      
      // Extract all step content for the page
      let combinedContent = '';
      const steps = pageData.steps || [];
      
      for (const step of steps) {
        combinedContent += step.content + ' ';
      }
      
      // Get total page count
      const pageCount = promptData.pages?.length || 
                        promptData.filter((page: any) => page.page !== undefined).length || 0;
      
      return {
        content: combinedContent.trim(),
        pageTitle: pageData.pageTitle || `Page ${pageNumber}`,
        pageCount
      };
    } catch (error) {
      this.logger.error(`Error fetching page content for page ${pageNumber}:`, error);
      throw error;
    }
  }

  // Add method to summarize page content and convert to speech
  async summarizePageContent(pageNumber: number): Promise<{ 
    summary: string; 
    audioResponse: Buffer;
    pageTitle: string;
    pageCount: number;
  }> {
    try {
      // Get page content
      const { content, pageTitle, pageCount } = await this.getPageContent(pageNumber);
      this.logger.log(`Summarizing content for page ${pageNumber}: ${pageTitle}`);
      
      // Generate summary with OpenAI
      const summary = await this.generatePageSummary(content, pageTitle, pageNumber);
      
      // Convert summary to speech
      const audioResponse = await this.generateSpeechAudio(summary);
      
      return {
        summary,
        audioResponse,
        pageTitle,
        pageCount
      };
    } catch (error) {
      this.logger.error(`Error summarizing page ${pageNumber}:`, error);
      throw error;
    }
  }

  // Generate summary of page content using OpenAI
  private async generatePageSummary(content: string, pageTitle: string, pageNumber: number): Promise<string> {
    try {
      this.logger.log(`Generating summary for "${pageTitle}" (Page ${pageNumber})...`);
      
      const aiResponse = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { 
            role: 'system', 
            content: `You are an expert guide explaining a PDF document. Summarize the following content from page ${pageNumber} titled "${pageTitle}" in a conversational tone. Speak directly to the user as if you're narrating the PDF for them. Keep your response clear, helpful, and engaging without being overly formal. Limit your response to 3-4 sentences.` 
          },
          { role: 'user', content }
        ],
        temperature: 0.7,
        max_tokens: 250,
      });
      
      const summaryText = aiResponse.choices[0]?.message?.content || 
        `I'm sorry, I couldn't generate a summary for page ${pageNumber}.`;
      
      this.logger.log(`Generated summary: "${summaryText.substring(0, 100)}..."`);
      
      return summaryText;
    } catch (error) {
      this.logger.error('Error generating page summary:', error);
      throw error;
    }
  }
} 