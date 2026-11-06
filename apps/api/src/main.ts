import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const port = configService.get<number>('port', 3000);
  const rawUploadsDir = configService.get<string>('uploadsDir', './uploads');
  const uploadsDir = path.isAbsolute(rawUploadsDir)
    ? rawUploadsDir
    : process.cwd().endsWith('apps/api')
      ? path.resolve(process.cwd(), '../..', rawUploadsDir)
      : path.resolve(process.cwd(), rawUploadsDir);

  const rawCorsOrigin = configService.get<string>('corsOrigin', 'http://localhost:4200');
  const allowedOrigins = rawCorsOrigin.split(',').map((o) => o.trim()).filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      const isExplicitMatch = allowedOrigins.some((allowed) => {
        if (allowed.startsWith('*.')) {
          return origin.endsWith(allowed.slice(2));
        }
        return allowed === origin;
      });
      if (
        isExplicitMatch ||
        origin.endsWith('.vercel.app') ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1')
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.use('/uploads', express.static(path.resolve(uploadsDir)));

  const clientCandidates = [
    path.resolve(process.cwd(), 'apps/web/dist/web/browser'),
    path.resolve(process.cwd(), '../web/dist/web/browser'),
    path.resolve(__dirname, '../../web/dist/web/browser'),
    path.resolve(__dirname, '../../../apps/web/dist/web/browser'),
  ];
  let clientBuildPath: string | null = null;
  for (const c of clientCandidates) {
    if (fs.existsSync(c)) {
      clientBuildPath = c;
      break;
    }
  }

  if (clientBuildPath) {
    app.use(express.static(clientBuildPath));
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/socket.io') && !req.path.startsWith('/uploads')) {
        res.sendFile(path.join(clientBuildPath!, 'index.html'));
      } else {
        next();
      }
    });
  } else {
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.method === 'GET' && (req.path === '/' || req.path === '')) {
        res.redirect('/api');
      } else {
        next();
      }
    });
  }

  await app.listen(port, '0.0.0.0');
  logger.log(`YOLO Detection API is running on http://localhost:${port}/api (0.0.0.0:${port})`);
}

bootstrap();

