import { Module } from '@nestjs/common';
import { DetectionController } from './detection.controller';
import { DetectionService } from './detection.service';
import { DetectionGateway } from './detection.gateway';
import { DetectionRepository } from './detection.repository';
import { AlertsModule } from '../alerts/alerts.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AlertsModule, AuthModule],
  controllers: [DetectionController],
  providers: [DetectionRepository, DetectionService, DetectionGateway],
  exports: [DetectionService, DetectionRepository],
})
export class DetectionModule {}

