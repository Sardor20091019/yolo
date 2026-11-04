import { Injectable, signal, WritableSignal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { io, Socket } from 'socket.io-client';
import { FrameResult, StreamConfig } from '../models/detection.model';

@Injectable({
  providedIn: 'root',
})
export class WebSocketService {
  private socket: Socket | null = null;
  private isHttpSending: boolean = false;
  private readonly apiBaseUrl: string;

  public readonly isConnected: WritableSignal<boolean> = signal<boolean>(false);
  public readonly latestResult: WritableSignal<FrameResult | null> = signal<FrameResult | null>(null);
  public readonly calibrationConfig: WritableSignal<StreamConfig | null> = signal<StreamConfig | null>(null);
  public readonly alertNotification: WritableSignal<Record<string, unknown> | null> = signal<Record<string, unknown> | null>(null);

  constructor(private readonly http: HttpClient) {
    const isDev = typeof window !== 'undefined' && window.location.port === '4200';
    const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
    this.apiBaseUrl = isDev ? `http://${host}:3000/api` : '/api';
    this.connect();
  }

  public connect(): void {
    if (this.socket) {
      return;
    }

    const isDev = typeof window !== 'undefined' && window.location.port === '4200';
    const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
    const socketUrl = isDev ? `http://${host}:3000` : `${window.location.protocol}//${window.location.host}`;

    try {
      this.socket = io(socketUrl, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 3000,
        timeout: 5000,
      });

      this.socket.on('connect', () => {
        this.isConnected.set(true);
      });

      this.socket.on('disconnect', () => {
        this.isConnected.set(false);
      });

      this.socket.on('detection_results', (data: FrameResult) => {
        this.latestResult.set(data);
      });

      this.socket.on('calibration_updated', (config: StreamConfig) => {
        this.calibrationConfig.set(config);
      });

      this.socket.on('realtime_alert', (alertData: Record<string, unknown>) => {
        this.alertNotification.set(alertData);
      });
    } catch {
      this.isConnected.set(false);
    }
  }

  public sendFrame(
    frameData: string,
    frameIndex: number,
    source: 'WEBCAM' | 'IP_CAMERA' = 'WEBCAM',
    detectedBoxes?: any[],
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
        if (result.alertTriggered) {
          this.alertNotification.set({
            frameIndex: result.frameIndex,
            timestamp: result.timestamp,
            suspicion: result.suspicion.filter((s) => s.score >= 70),
          });
        }
        this.isHttpSending = false;
      },
      error: () => {
        this.isHttpSending = false;
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
