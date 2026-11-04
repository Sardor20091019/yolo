import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertsRepository } from './alerts.repository';

@Module({
  controllers: [AlertsController],
  providers: [AlertsRepository, AlertsService],
  exports: [AlertsService, AlertsRepository],
})
export class AlertsModule {}

