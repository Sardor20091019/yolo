import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Request, Response } from 'express';
import { AppModule } from '../apps/api/src/app.module';

let cachedServer: express.Express | null = null;

async function bootstrapServer(): Promise<express.Express> {
  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));

  app.enableCors({
    origin: '*',
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.init();
  return server;
}

export default async function handler(req: Request, res: Response): Promise<void> {
  if (!cachedServer) {
    cachedServer = await bootstrapServer();
  }
  return (cachedServer as any)(req, res);
}
