import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VoiceChatModule } from './voice-chat/voice-chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    VoiceChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {} 