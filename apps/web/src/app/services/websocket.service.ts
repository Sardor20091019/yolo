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
    const token = typeof window !== 'undefined' ? localStorage.getItem('astro_cctv_access_token') : null;

    try {
      this.socket = io(socketUrl, {
        transports: ['polling', 'websocket'],
        reconnectionAttempts: 15,
        reconnectionDelay: 1500,
        timeout: 10000,
        auth: token ? { token } : undefined,
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

      this.socket.on('connect_error', (err) => {
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

        const snap = preview['frameSnapshot'] as string | undefined;
        const boxes = (preview['boxes'] as any[]) || [];
        const poses = (preview['poses'] as any[]) || [];
        const suspicion = (preview['suspicion'] as any[]) || [];
        const detectedLabels = boxes.map((b) => b.label);

        this.cctvStations.update((list) => {
          const idx = list.findIndex((s) => s.stationId === stationId);
          if (idx >= 0) {
            const updated = [...list];
            updated[idx] = {
              ...updated[idx],
              lastFrameSnapshot: snap || updated[idx].lastFrameSnapshot,
              lastSeen: Date.now(),
              status: 'STREAMING',
              lastDetectedObjects: detectedLabels.length > 0 ? detectedLabels : updated[idx].lastDetectedObjects,
              activeDetectionsCount: detectedLabels.length > 0 ? detectedLabels.length : updated[idx].activeDetectionsCount,
              lastBoxes: boxes.length > 0 ? boxes : updated[idx].lastBoxes,
              lastPoses: poses.length > 0 ? poses : updated[idx].lastPoses,
              lastSuspicion: suspicion.length > 0 ? suspicion : updated[idx].lastSuspicion,
            };
            return updated;
          }
          const newStation: CctvStationRecord = {
            stationId,
            stationName: (preview['stationName'] as string) || `CCTV Node ${stationId}`,
            status: 'STREAMING',
            lastSeen: Date.now(),
            fps: 12,
            totalFrames: 1,
            activeDetectionsCount: detectedLabels.length,
            lastDetectedObjects: detectedLabels,
            lastFrameSnapshot: snap || '',
            lastBoxes: boxes,
            lastPoses: poses,
            lastSuspicion: suspicion,
          };
          return [...list, newStation];
        });
      });

      this.socket.on('station_disconnected', (payload: { stationId: string }) => {
        const sid = payload?.stationId;
        if (!sid) {
          return;
        }
        this.cctvStations.update((list) => {
          return list.map((s) => s.stationId === sid ? { ...s, status: 'DISCONNECTED' } : s);
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

  public unregisterCameraNode(stationId: string): void {
    if (this.socket && this.isConnected()) {
      this.socket.emit('unregister_camera_station', {
        stationId,
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
        this.latestResult.set({
          frameIndex,
          timestamp: Date.now(),
          boxes: [],
          poses: [],
          suspicion: [],
          alertTriggered: false,
          isYoloActive: false,
          engineError: `Inference API error: ${errMsg}`,
        });
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
