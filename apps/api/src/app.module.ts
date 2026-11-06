import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { validateConfig } from './config/config.validation';
import { DatabaseModule } from './database/database.module';
import { DetectionModule } from './detection/detection.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateConfig,
      envFilePath: ['.env', '../../.env', '../.env'],
    }),
    DatabaseModule,
    AuthModule,
    AlertsModule,
    DetectionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

