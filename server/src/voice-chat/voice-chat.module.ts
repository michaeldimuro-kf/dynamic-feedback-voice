import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VoiceChatService } from './voice-chat.service';
import { VoiceChatGateway } from './voice-chat.gateway';
import { WebRTCGateway } from './webrtc.gateway';
import { WebRTCService } from './webrtc.service';

@Module({
  imports: [ConfigModule],
  providers: [
    VoiceChatGateway, 
    VoiceChatService,
    WebRTCGateway,
    WebRTCService
  ],
  exports: [VoiceChatService, WebRTCService]
})
export class VoiceChatModule {} 