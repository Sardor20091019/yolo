import { Injectable, signal, WritableSignal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { DetectionZone, StreamConfig, FrameResult } from '../models/detection.model';

@Injectable({
  providedIn: 'root',
})
export class DetectionApiService {
  private readonly baseUrl: string;
  public readonly zones: WritableSignal<DetectionZone[]> = signal<DetectionZone[]>([]);
  public readonly config: WritableSignal<StreamConfig> = signal<StreamConfig>({
    mode: 'WEBCAM',
    confidenceThreshold: 0.35,
    suspicionThreshold: 75,
    loiteringThresholdSeconds: 10,
    nervousCheckSensitivity: 3,
  });

  constructor(private readonly http: HttpClient) {
    const isDev = typeof window !== 'undefined' && window.location.port === '4200';
    const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
    this.baseUrl = isDev ? `http://${host}:3000/api/detection` : '/api/detection';
  }

  public processFrame(payload: { frameData: string; frameIndex: number; source?: 'WEBCAM' | 'IP_CAMERA' }): Observable<FrameResult> {
    return this.http.post<FrameResult>(`${this.baseUrl}/process-frame`, payload);
  }

  public fetchConfig(): Observable<StreamConfig> {
    return this.http.get<StreamConfig>(`${this.baseUrl}/config`).pipe(
      tap((cfg) => {
        this.config.set(cfg);
      }),
    );
  }

  public saveConfig(cfg: StreamConfig): Observable<StreamConfig> {
    return this.http.post<StreamConfig>(`${this.baseUrl}/config`, cfg).pipe(
      tap((updated) => {
        this.config.set(updated);
      }),
    );
  }

  public fetchZones(): Observable<DetectionZone[]> {
    return this.http.get<DetectionZone[]>(`${this.baseUrl}/zones`).pipe(
      tap((items) => {
        this.zones.set(items);
      }),
    );
  }

  public createZone(zone: Partial<DetectionZone>): Observable<DetectionZone> {
    return this.http.post<DetectionZone>(`${this.baseUrl}/zones`, zone).pipe(
      tap((created) => {
        this.zones.update((list) => [created, ...list]);
      }),
    );
  }

  public updateZone(id: string, zone: Partial<DetectionZone>): Observable<DetectionZone> {
    return this.http.patch<DetectionZone>(`${this.baseUrl}/zones/${id}`, zone).pipe(
      tap((updated) => {
        this.zones.update((list) => list.map((z) => (z.id === id ? updated : z)));
      }),
    );
  }

  public deleteZone(id: string): Observable<{ success: boolean; id: string }> {
    return this.http.delete<{ success: boolean; id: string }>(`${this.baseUrl}/zones/${id}`).pipe(
      tap(() => {
        this.zones.update((list) => list.filter((z) => z.id !== id));
      }),
    );
  }
}

