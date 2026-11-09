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
import { JwtSecurityService } from '../auth/jwt.service';
import { JwtTokenPayload } from '../auth/auth.dto';

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

interface RegisterCameraPayload {
  stationId: string;
  stationName?: string;
}

interface WatchStationPayload {
  stationId: string;
}

interface WebRtcSignalPayload {
  targetSocketId: string;
  stationId: string;
  sdp?: unknown;
  candidate?: unknown;
}

@WebSocketGateway({
  cors: {
    origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
      callback(null, true);
    },
    credentials: true,
  },
  maxHttpBufferSize: 1e8,
})
export class DetectionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  public server!: Server;

  private readonly logger: Logger = new Logger(DetectionGateway.name);
  private readonly cameraSockets: Map<string, { socketId: string; stationId: string; stationName: string }> = new Map();
  private readonly socketToStation: Map<string, string> = new Map();
  private readonly adminSockets: Set<string> = new Set();

  constructor(
    private readonly detectionService: DetectionService,
    private readonly jwtSecurityService: JwtSecurityService,
  ) {}

  public handleConnection(client: Socket): void {
    const rawToken =
      client.handshake.auth?.token ||
      (typeof client.handshake.headers?.authorization === 'string'
        ? client.handshake.headers.authorization.replace('Bearer ', '').trim()
        : '') ||
      client.handshake.query?.token;

    if (rawToken && typeof rawToken === 'string') {
      try {
        const claims: JwtTokenPayload = this.jwtSecurityService.verifyAccessToken(rawToken);
        client.data.user = claims;
        this.logger.log(`Authenticated client connected to DetectionGateway: ${client.id} (User: ${claims.sub}, Role: ${claims.role})`);
      } catch {
        client.data.user = null;
      }
    } else {
      client.data.user = null;
    }

    const currentConfig = this.detectionService.getConfig();
    client.emit('calibration_updated', currentConfig);
  }

  public handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected from DetectionGateway: ${client.id}`);
    this.adminSockets.delete(client.id);

    const stationId = this.socketToStation.get(client.id);
    if (stationId) {
      this.socketToStation.delete(client.id);
      this.cameraSockets.delete(stationId);
      this.broadcastStationsList();
      for (const adminId of this.adminSockets) {
        this.server.to(adminId).emit('station_disconnected', { stationId });
      }
    }
  }

  @SubscribeMessage('register_camera_station')
  public handleRegisterCameraStation(
    @MessageBody() payload: RegisterCameraPayload,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!payload?.stationId) {
      return;
    }

    const name = payload.stationName || `CCTV Node ${payload.stationId}`;
    this.cameraSockets.set(payload.stationId, {
      socketId: client.id,
      stationId: payload.stationId,
      stationName: name,
    });
    this.socketToStation.set(client.id, payload.stationId);

    this.detectionService.registerOrUpdateStation(payload.stationId, name);
    this.broadcastStationsList();
    client.emit('camera_registered', { stationId: payload.stationId, stationName: name });
  }

  @SubscribeMessage('unregister_camera_station')
  public handleUnregisterCameraStation(
    @MessageBody() payload: { stationId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    if (!payload?.stationId) {
      return;
    }
    this.detectionService.removeOrDisconnectStation(payload.stationId);
    this.cameraSockets.delete(payload.stationId);
    this.socketToStation.delete(client.id);
    this.broadcastStationsList();
    for (const adminId of this.adminSockets) {
      this.server.to(adminId).emit('station_disconnected', { stationId: payload.stationId });
    }
  }

  @SubscribeMessage('admin_join_cctv')
  public handleAdminJoinCctv(@ConnectedSocket() client: Socket): void {
    const user = client.data?.user as JwtTokenPayload | null;
    if (user && user.role !== 'admin') {
      client.emit('auth_error', { message: 'Administrative privileges required to monitor CCTV stream' });
      return;
    }

    this.adminSockets.add(client.id);
    const stations = this.detectionService.getAllCctvStations();
    client.emit('cctv_stations_updated', stations);
  }

  @SubscribeMessage('admin_watch_station')
  public handleAdminWatchStation(
    @MessageBody() payload: WatchStationPayload,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!payload?.stationId) {
      return;
    }

    const camera = this.cameraSockets.get(payload.stationId);
    if (!camera) {
      client.emit('webrtc_error', {
        stationId: payload.stationId,
        message: 'Camera station is offline or not registered',
      });
      return;
    }

    this.server.to(camera.socketId).emit('webrtc_viewer_joined', {
      viewerSocketId: client.id,
      stationId: payload.stationId,
    });
  }

  @SubscribeMessage('webrtc_offer')
  public handleWebRtcOffer(
    @MessageBody() payload: WebRtcSignalPayload,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!payload?.targetSocketId || !payload?.sdp) {
      return;
    }

    this.server.to(payload.targetSocketId).emit('webrtc_offer', {
      senderSocketId: client.id,
      stationId: payload.stationId,
      sdp: payload.sdp,
    });
  }

  @SubscribeMessage('webrtc_answer')
  public handleWebRtcAnswer(
    @MessageBody() payload: WebRtcSignalPayload,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!payload?.targetSocketId || !payload?.sdp) {
      return;
    }

    this.server.to(payload.targetSocketId).emit('webrtc_answer', {
      senderSocketId: client.id,
      stationId: payload.stationId,
      sdp: payload.sdp,
    });
  }

  @SubscribeMessage('webrtc_ice_candidate')
  public handleWebRtcIceCandidate(
    @MessageBody() payload: WebRtcSignalPayload,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!payload?.targetSocketId || !payload?.candidate) {
      return;
    }

    this.server.to(payload.targetSocketId).emit('webrtc_ice_candidate', {
      senderSocketId: client.id,
      stationId: payload.stationId,
      candidate: payload.candidate,
    });
  }

  @SubscribeMessage('stream_frame')
  public async handleStreamFrame(
    @MessageBody() payload: StreamFramePayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!payload?.frameData) {
      return;
    }

    const senderUserId = (client.data?.user as JwtTokenPayload | null)?.sub || payload.userId;

    if (payload.stationId) {
      this.detectionService.registerOrUpdateStation(
        payload.stationId,
        payload.stationName,
      );
    }

    const result: FrameProcessingResult = await this.detectionService.processFrame(
      payload.frameData,
      payload.frameIndex || 0,
      payload.source || 'WEBCAM',
      payload.detectedBoxes,
      payload.stationId,
      payload.stationName,
      senderUserId,
    );

    client.emit('detection_results', result);

    if (payload.stationId) {
      const previewPayload = {
        stationId: payload.stationId,
        stationName: payload.stationName,
        frameSnapshot: result.annotatedFrame || payload.frameData,
        boxes: result.boxes,
        poses: result.poses,
        suspicion: result.suspicion,
        alertTriggered: result.alertTriggered,
        isYoloActive: result.isYoloActive,
        engineError: result.engineError,
      };

      for (const adminId of this.adminSockets) {
        this.server.to(adminId).emit('station_frame_preview', previewPayload);
      }
    }

    if (result.alertTriggered) {
      const alertPayload = {
        stationId: payload.stationId,
        stationName: payload.stationName,
        frameIndex: result.frameIndex,
        timestamp: result.timestamp,
        suspicion: result.suspicion.filter((s) => s.score >= 50),
      };

      for (const adminId of this.adminSockets) {
        this.server.to(adminId).emit('realtime_alert', alertPayload);
      }
    }
  }

  @SubscribeMessage('update_calibration')
  public handleUpdateCalibration(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: StreamConfigDto,
  ): StreamConfigDto {
    const user = client.data?.user as JwtTokenPayload | null;
    if (user && user.role !== 'admin') {
      client.emit('auth_error', { message: 'Administrative privileges required to update calibration' });
      return this.detectionService.getConfig();
    }

    const updated = this.detectionService.updateConfig(payload);
    this.server.emit('calibration_updated', updated);
    return updated;
  }

  private broadcastStationsList(): void {
    const stations = this.detectionService.getAllCctvStations();
    for (const adminId of this.adminSockets) {
      this.server.to(adminId).emit('cctv_stations_updated', stations);
    }
  }
}
