import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  // Configure CORS
  const corsOptions: CorsOptions = {
    origin: ['http://localhost:5173'], // Vite dev server default port
    methods: ['GET', 'POST'],
    credentials: true,
  };
  app.enableCors(corsOptions);
  
  // Serve static files
  app.useStaticAssets(join(__dirname, '..', 'public'));
  
  await app.listen(3000);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap(); 