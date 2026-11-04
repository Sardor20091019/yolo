import { Injectable, signal, WritableSignal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { FrameResult, StreamConfig } from '../models/detection.model';

@Injectable({
  providedIn: 'root',
})
export class WebSocketService {
  private socket: Socket | null = null;
  public readonly isConnected: WritableSignal<boolean> = signal<boolean>(false);
  public readonly latestResult: WritableSignal<FrameResult | null> = signal<FrameResult | null>(null);
  public readonly calibrationConfig: WritableSignal<StreamConfig | null> = signal<StreamConfig | null>(null);
  public readonly alertNotification: WritableSignal<Record<string, unknown> | null> = signal<Record<string, unknown> | null>(null);

  constructor() {
    this.connect();
  }

  public connect(): void {
    if (this.socket) {
      return;
    }

    const host = window.location.hostname || 'localhost';
    const socketUrl = `http://${host}:3000`;

    this.socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
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
  }

  public sendFrame(frameData: string, frameIndex: number, source: 'WEBCAM' | 'IP_CAMERA'): void {
    if (!this.socket || !this.isConnected()) {
      return;
    }
    this.socket.emit('stream_frame', {
      frameData,
      frameIndex,
      source,
    });
  }

  public updateCalibration(config: StreamConfig): void {
    if (!this.socket || !this.isConnected()) {
      return;
    }
    this.socket.emit('update_calibration', config);
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected.set(false);
    }
  }
}

