import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { validateConfig } from './config/config.validation';
import { DatabaseModule } from './database/database.module';
import { DetectionModule } from './detection/detection.module';
import { AlertsModule } from './alerts/alerts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateConfig,
      envFilePath: ['.env', '../../.env', '../.env'],
    }),
    DatabaseModule,
    AlertsModule,
    DetectionModule,
  ],
})
export class AppModule {}

