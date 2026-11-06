import { Controller, Get } from '@nestjs/common';
import { AppService, SystemStatusDto, HealthCheckDto } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  public getStatus(): SystemStatusDto {
    return this.appService.getSystemStatus();
  }

  @Get('health')
  public getHealth(): HealthCheckDto {
    return this.appService.getHealth();
  }
}

