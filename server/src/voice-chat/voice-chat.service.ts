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
  
  // Process a buffer for transcription
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
} 