import { Injectable, signal, WritableSignal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { io, Socket } from 'socket.io-client';
import { FrameResult, StreamConfig, CctvStationRecord } from '../models/detection.model';
import { getApiBaseUrl, getSocketUrl } from './api-config';
import { WebrtcService } from './webrtc.service';

@Injectable({
  providedIn: 'root',
})
export class WebSocketService {
  private socket: Socket | null = null;
  private isHttpSending: boolean = false;
  private readonly apiBaseUrl: string;

  public readonly isConnected: WritableSignal<boolean> = signal<boolean>(false);
  public readonly isYoloActive: WritableSignal<boolean> = signal<boolean>(true);
  public readonly yoloErrorMessage: WritableSignal<string> = signal<string>('');
  public readonly latestResult: WritableSignal<FrameResult | null> = signal<FrameResult | null>(null);
  public readonly calibrationConfig: WritableSignal<StreamConfig | null> = signal<StreamConfig | null>(null);
  public readonly alertNotification: WritableSignal<Record<string, unknown> | null> = signal<Record<string, unknown> | null>(null);
  public readonly cctvStations: WritableSignal<CctvStationRecord[]> = signal<CctvStationRecord[]>([]);

  constructor(
    private readonly http: HttpClient,
    private readonly webrtcService: WebrtcService,
  ) {
    this.apiBaseUrl = getApiBaseUrl();
    this.connect();
  }

  public getRawSocket(): Socket | null {
    return this.socket;
  }

  public connect(): void {
    if (this.socket) {
      return;
    }

    const socketUrl = getSocketUrl();

    try {
      this.socket = io(socketUrl, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        timeout: 8000,
      });

      this.webrtcService.initSignaling(this.socket);

      this.socket.on('connect', () => {
        this.isConnected.set(true);
        if (this.socket) {
          this.socket.emit('admin_join_cctv');
        }
      });

      this.socket.on('disconnect', () => {
        this.isConnected.set(false);
      });

      this.socket.on('detection_results', (data: FrameResult) => {
        this.latestResult.set(data);
        if (data.isYoloActive !== undefined) {
          this.isYoloActive.set(data.isYoloActive);
          if (data.engineError) {
            this.yoloErrorMessage.set(data.engineError);
          } else if (data.isYoloActive) {
            this.yoloErrorMessage.set('');
          }
        }
      });

      this.socket.on('cctv_stations_updated', (stations: CctvStationRecord[]) => {
        if (Array.isArray(stations)) {
          this.cctvStations.set(stations);
        }
      });

      this.socket.on('station_frame_preview', (preview: Record<string, unknown>) => {
        const stationId = preview['stationId'] as string;
        if (!stationId) {
          return;
        }

        this.cctvStations.update((list) => {
          const idx = list.findIndex((s) => s.stationId === stationId);
          if (idx >= 0) {
            const updated = [...list];
            updated[idx] = {
              ...updated[idx],
              lastFrameSnapshot: (preview['frameSnapshot'] as string) || updated[idx].lastFrameSnapshot,
              lastSeen: Date.now(),
              status: 'STREAMING',
            };
            return updated;
          }
          return list;
        });
      });

      this.socket.on('calibration_updated', (config: StreamConfig) => {
        this.calibrationConfig.set(config);
      });

      this.socket.on('realtime_alert', (alertData: Record<string, unknown>) => {
        this.alertNotification.set(alertData);
      });
    } catch {
      this.isConnected.set(false);
      this.isYoloActive.set(false);
      this.yoloErrorMessage.set('Could not initialize WebSocket connection');
    }
  }

  public joinAsAdmin(): void {
    if (this.socket && this.isConnected()) {
      this.socket.emit('admin_join_cctv');
    }
  }

  public registerCameraNode(stationId: string, stationName: string): void {
    if (this.socket && this.isConnected()) {
      this.socket.emit('register_camera_station', {
        stationId,
        stationName,
      });
    }
  }

  public sendFrame(
    frameData: string,
    frameIndex: number,
    source: 'WEBCAM' | 'IP_CAMERA' = 'WEBCAM',
    detectedBoxes?: unknown[],
    stationId?: string,
    stationName?: string,
    userId?: string,
  ): void {
    if (this.socket && this.isConnected()) {
      this.socket.emit('stream_frame', {
        frameData,
        frameIndex,
        source,
        detectedBoxes,
        stationId,
        stationName,
        userId,
      });
      return;
    }

    if (this.isHttpSending) {
      return;
    }

    this.isHttpSending = true;
    this.http.post<FrameResult>(`${this.apiBaseUrl}/detection/process-frame`, {
      frameData,
      frameIndex,
      source,
      detectedBoxes,
      stationId,
      stationName,
      userId,
    }).subscribe({
      next: (result) => {
        this.latestResult.set(result);
        if (result.isYoloActive !== undefined) {
          this.isYoloActive.set(result.isYoloActive);
          if (result.engineError) {
            this.yoloErrorMessage.set(result.engineError);
          } else if (result.isYoloActive) {
            this.yoloErrorMessage.set('');
          }
        }
        if (result.alertTriggered) {
          this.alertNotification.set({
            stationId: result.stationId,
            stationName: result.stationName,
            frameIndex: result.frameIndex,
            timestamp: result.timestamp,
            suspicion: result.suspicion.filter((s) => s.score >= 50),
          });
        }
        this.isHttpSending = false;
      },
      error: (err: unknown) => {
        this.isHttpSending = false;
        this.isYoloActive.set(false);
        const errMsg = err instanceof Error ? err.message : 'API connection failed';
        this.yoloErrorMessage.set(`Inference API error: ${errMsg}`);
      },
    });
  }

  public updateCalibration(config: StreamConfig): void {
    if (this.socket && this.isConnected()) {
      this.socket.emit('update_calibration', config);
      return;
    }

    this.http.post<StreamConfig>(`${this.apiBaseUrl}/detection/config`, config).subscribe({
      next: (updated) => {
        this.calibrationConfig.set(updated);
      },
    });
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected.set(false);
    }
  }
}
