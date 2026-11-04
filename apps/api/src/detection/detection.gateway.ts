import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { DetectionService, FrameProcessingResult } from './detection.service';
import { StreamConfigDto } from './dto/stream-config.dto';

interface StreamFramePayload {
  frameData: string;
  frameIndex: number;
  source?: 'WEBCAM' | 'IP_CAMERA';
  stationId?: string;
  stationName?: string;
  userId?: string;
  detectedBoxes?: Array<{
    trackId: number;
    label: string;
    confidence: number;
    bbox: [number, number, number, number];
  }>;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class DetectionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  public server!: Server;

  private readonly logger: Logger = new Logger(DetectionGateway.name);

  constructor(private readonly detectionService: DetectionService) {}

  public handleConnection(client: Socket): void {
    this.logger.log(`Client connected to DetectionGateway: ${client.id}`);
    const currentConfig = this.detectionService.getConfig();
    client.emit('calibration_updated', currentConfig);
  }

  public handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected from DetectionGateway: ${client.id}`);
  }

  @SubscribeMessage('stream_frame')
  public async handleStreamFrame(
    @MessageBody() payload: StreamFramePayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!payload?.frameData) {
      return;
    }

    const result: FrameProcessingResult = await this.detectionService.processFrame(
      payload.frameData,
      payload.frameIndex || 0,
      payload.source || 'WEBCAM',
      payload.detectedBoxes,
      payload.stationId,
      payload.stationName,
      payload.userId,
    );

    client.emit('detection_results', result);

    if (result.alertTriggered) {
      this.server.emit('realtime_alert', {
        frameIndex: result.frameIndex,
        timestamp: result.timestamp,
        suspicion: result.suspicion.filter((s) => s.score >= 70),
      });
    }
  }

  @SubscribeMessage('update_calibration')
  public handleUpdateCalibration(
    @MessageBody() payload: StreamConfigDto,
  ): StreamConfigDto {
    const updated = this.detectionService.updateConfig(payload);
    this.server.emit('calibration_updated', updated);
    return updated;
  }
}
