import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import * as path from 'path';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const port = configService.get<number>('port', 3000);
  const corsOrigin = configService.get<string>('corsOrigin', 'http://localhost:4200');
  const rawUploadsDir = configService.get<string>('uploadsDir', './uploads');
  const uploadsDir = path.isAbsolute(rawUploadsDir)
    ? rawUploadsDir
    : process.cwd().endsWith('apps/api')
      ? path.resolve(process.cwd(), '../..', rawUploadsDir)
      : path.resolve(process.cwd(), rawUploadsDir);

  app.enableCors({
    origin: corsOrigin.includes(',') ? corsOrigin.split(',') : corsOrigin,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.use('/uploads', express.static(path.resolve(uploadsDir)));

  await app.listen(port);
  logger.log(`Shoplifting Detection API is running on port ${port}`);
}

bootstrap();

