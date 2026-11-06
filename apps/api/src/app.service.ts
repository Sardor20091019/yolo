import { Injectable } from '@nestjs/common';
import { DetectionService } from './detection/detection.service';

export interface SystemStatusDto {
  name: string;
  version: string;
  status: string;
  yoloActive: boolean;
  activeCctvStations: number;
  endpoints: string[];
}

export interface HealthCheckDto {
  status: string;
  timestamp: string;
  yoloActive: boolean;
}

@Injectable()
export class AppService {
  constructor(private readonly detectionService: DetectionService) {}

  public getSystemStatus(): SystemStatusDto {
    return {
      name: 'YOLO CCTV & Anti-Theft YOLO Detection Engine',
      version: '1.0.0',
      status: 'operational',
      yoloActive: this.detectionService.isWorkerActive(),
      activeCctvStations: this.detectionService.getAllCctvStations().length,
      endpoints: [
        '/api/health',
        '/api/detection/config',
        '/api/detection/cctv-stations',
        '/api/detection/logs',
        '/api/alerts',
        '/api/auth/profile',
      ],
    };
  }

  public getHealth(): HealthCheckDto {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      yoloActive: this.detectionService.isWorkerActive(),
    };
  }
}

