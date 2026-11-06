import { Component, OnInit, OnDestroy, signal, computed, effect, WritableSignal, Signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { WebSocketService } from '../../services/websocket.service';
import { WebrtcService } from '../../services/webrtc.service';
import { getApiBaseUrl } from '../../services/api-config';
import { CctvStationRecord, BoundingBox, PoseSkeleton, SuspicionBreakdown } from '../../models/detection.model';

@Component({
  selector: 'app-admin-cctv',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-cctv.component.html',
})
export class AdminCctvComponent implements OnInit, OnDestroy {
  @ViewChild('modalCanvas') public modalCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('modalVideo') public modalVideoRef?: ElementRef<HTMLVideoElement>;

  public readonly selectedStationId: WritableSignal<string | null> = signal<string | null>(null);
  public readonly filterText: WritableSignal<string> = signal<string>('');
  public readonly isLoading: WritableSignal<boolean> = signal<boolean>(false);
  public readonly activeWatchingStations: WritableSignal<string[]> = signal<string[]>([]);

  public readonly stations: Signal<CctvStationRecord[]> = computed(() => {
    return this.wsService.cctvStations();
  });

  public readonly selectedStation: Signal<CctvStationRecord | null> = computed(() => {
    const id = this.selectedStationId();
    if (!id) {
      return null;
    }
    return this.stations().find((s) => s.stationId === id) || null;
  });

  public readonly filteredStations: Signal<CctvStationRecord[]> = computed(() => {
    const q = this.filterText().toLowerCase().trim();
    const list = this.stations();
    if (!q) {
      return list;
    }
    return list.filter((s) => s.stationId.toLowerCase().includes(q) || s.stationName.toLowerCase().includes(q));
  });

  public readonly streamingCount: Signal<number> = computed(() => {
    return this.stations().filter((s) => s.status === 'STREAMING').length;
  });

  public readonly totalNetworkDetections: Signal<number> = computed(() => {
    return this.stations().reduce((acc, s) => acc + s.activeDetectionsCount, 0);
  });

  private pollIntervalId: ReturnType<typeof setInterval> | null = null;
  private animationId: number | null = null;
  private readonly apiBaseUrl: string;

  constructor(
    public readonly authService: AuthService,
    public readonly wsService: WebSocketService,
    public readonly webrtcService: WebrtcService,
    private readonly http: HttpClient,
  ) {
    this.apiBaseUrl = getApiBaseUrl();
  }

  public ngOnInit(): void {
    this.wsService.joinAsAdmin();
    this.fetchStations();
    this.startRenderLoop();
    this.pollIntervalId = setInterval(() => {
      this.fetchStations();
    }, 3000);
  }

  public ngOnDestroy(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
    }
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    this.activeWatchingStations().forEach((sid) => {
      this.webrtcService.stopWatchingStation(sid);
    });
  }

  private startRenderLoop(): void {
    const loop = (): void => {
      try {
        const sel = this.selectedStation();
        if (sel && this.modalCanvasRef?.nativeElement && this.modalVideoRef?.nativeElement) {
          const canvas = this.modalCanvasRef.nativeElement;
          const video = this.modalVideoRef.nativeElement;
          if (video.readyState >= 2) {
            const vw = video.videoWidth || 640;
            const vh = video.videoHeight || 360;
            if (canvas.width !== vw || canvas.height !== vh) {
              canvas.width = vw;
              canvas.height = vh;
            }
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              if (sel.lastBoxes && sel.lastBoxes.length > 0) {
                this.renderBoxes(ctx, sel.lastBoxes, canvas.width / 640, canvas.height / 360, sel.lastSuspicion || []);
              }
              if (sel.lastPoses && sel.lastPoses.length > 0) {
                this.renderPoses(ctx, sel.lastPoses, canvas.width / 640, canvas.height / 360);
              }
            }
          }
        }
      } catch {
        return;
      }
      this.animationId = requestAnimationFrame(loop);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  private renderBoxes(ctx: CanvasRenderingContext2D, boxes: BoundingBox[], scaleX: number, scaleY: number, suspicion: SuspicionBreakdown[]): void {
    if (!boxes || boxes.length === 0) return;
    const suspMap = new Map<number, SuspicionBreakdown>();
    suspicion.forEach((s) => {
      if (s && s.trackId !== undefined) {
        suspMap.set(s.trackId, s);
      }
    });

    boxes.forEach((box) => {
      if (!box || !box.bbox || box.bbox.length < 4) return;
      const [bx1, by1, bx2, by2] = box.bbox;
      const x1 = bx1 * scaleX;
      const y1 = by1 * scaleY;
      const x2 = bx2 * scaleX;
      const y2 = by2 * scaleY;
      const w = Math.max(4, x2 - x1);
      const h = Math.max(4, y2 - y1);
      const labelLower = (box.label || '').toLowerCase();

      let strokeColor = '#10b981';
      let fillColor = 'rgba(16, 185, 129, 0.08)';
      let labelText = `ID #${box.trackId} · ${box.label.toUpperCase()}`;

      if (labelLower === 'person') {
        const susp = suspMap.get(box.trackId);
        const score = susp ? susp.score : 0;
        if (score >= 50 || (susp?.triggers && susp.triggers.length > 0)) {
          strokeColor = '#ef4444';
          fillColor = 'rgba(239, 68, 68, 0.18)';
          labelText = `ALERT #${box.trackId} · SUSP: ${Math.round(score)}%`;
        } else if (score >= 25) {
          strokeColor = '#f59e0b';
          fillColor = 'rgba(245, 158, 11, 0.12)';
          labelText = `CAUTION #${box.trackId} · ${Math.round(score)}%`;
        } else {
          strokeColor = '#10b981';
          fillColor = 'rgba(16, 185, 129, 0.08)';
          labelText = `PERSON #${box.trackId} · SAFE`;
        }
      } else if (labelLower === 'face') {
        strokeColor = '#a855f7';
        fillColor = 'rgba(168, 85, 247, 0.12)';
        labelText = `FACE · ${Math.round((box.confidence || 0.95) * 100)}%`;
      } else {
        strokeColor = '#f59e0b';
        fillColor = 'rgba(245, 158, 11, 0.1)';
        labelText = `${box.label.toUpperCase()} · ${Math.round((box.confidence || 0.85) * 100)}%`;
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x1, y1, w, h);
      ctx.fillStyle = fillColor;
      ctx.fillRect(x1, y1, w, h);

      ctx.font = '600 12px "IBM Plex Mono", monospace';
      const textMetrics = ctx.measureText(labelText);
      const badgeH = 22;
      const badgeW = Math.max(textMetrics.width + 16, 80);
      const badgeY = Math.max(0, y1 - badgeH);

      ctx.fillStyle = '#111110';
      ctx.fillRect(x1, badgeY, badgeW, badgeH);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x1, badgeY, badgeW, badgeH);
      ctx.fillStyle = '#f0ede6';
      ctx.fillText(labelText, x1 + 8, badgeY + 15);
    });
  }

  private renderPoses(ctx: CanvasRenderingContext2D, poses: PoseSkeleton[], scaleX: number, scaleY: number): void {
    if (!poses || poses.length === 0) return;
    poses.forEach((pose) => {
      if (!pose || !pose.keypoints) return;
      const kps = pose.keypoints;
      if (!kps || kps.length === 0) return;

      ctx.lineWidth = 3;
      ctx.strokeStyle = '#06b6d4';

      if (pose.skeleton && pose.skeleton.length > 0) {
        pose.skeleton.forEach(([i1, i2]) => {
          if (i1 < kps.length && i2 < kps.length) {
            const kp1 = kps[i1];
            const kp2 = kps[i2];
            if (kp1 && kp2 && kp1.confidence >= 0.2 && kp2.confidence >= 0.2 && kp1.x > 0 && kp2.x > 0 && kp1.y > 0 && kp2.y > 0) {
              ctx.beginPath();
              ctx.moveTo(kp1.x * scaleX, kp1.y * scaleY);
              ctx.lineTo(kp2.x * scaleX, kp2.y * scaleY);
              ctx.stroke();
            }
          }
        });
      }

      kps.forEach((kp) => {
        if (kp && kp.confidence >= 0.2 && kp.x > 0 && kp.y > 0) {
          const sx = kp.x * scaleX;
          const sy = kp.y * scaleY;
          ctx.beginPath();
          ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#06b6d4';
          ctx.stroke();
        }
      });
    });
  }

  public fetchStations(): void {
    this.http.get<CctvStationRecord[]>(`${this.apiBaseUrl}/detection/cctv-stations`).subscribe({
      next: (data) => {
        if (Array.isArray(data)) {
          this.wsService.cctvStations.update((existingList) => {
            return data.map((serverStation) => {
              const local = existingList.find((s) => s.stationId === serverStation.stationId);
              if (local && local.lastFrameSnapshot && local.lastSeen >= serverStation.lastSeen) {
                return {
                  ...serverStation,
                  lastFrameSnapshot: local.lastFrameSnapshot,
                  lastSeen: local.lastSeen,
                };
              }
              return serverStation;
            });
          });
        }
      },
      error: () => {},
    });
  }

  public selectStation(station: CctvStationRecord): void {
    this.selectedStationId.set(station.stationId);
    this.connectWebRtc(station.stationId);
  }

  public connectWebRtc(stationId: string): void {
    this.webrtcService.watchStation(stationId);
    this.activeWatchingStations.update((list) => {
      if (!list.includes(stationId)) {
        return [...list, stationId];
      }
      return list;
    });
  }

  public getRemoteStream(stationId: string): MediaStream | null {
    return this.webrtcService.getRemoteStreamSignal(stationId)();
  }

  public isRemoteStreamActive(stationId: string): boolean {
    const stream = this.getRemoteStream(stationId);
    if (!stream) {
      return false;
    }
    const tracks = stream.getVideoTracks();
    return tracks.length > 0 && tracks[0].readyState === 'live' && tracks[0].enabled;
  }

  public closeSelectedStation(): void {
    const id = this.selectedStationId();
    if (id) {
      this.webrtcService.stopWatchingStation(id);
      this.activeWatchingStations.update((list) => list.filter((item) => item !== id));
    }
    this.selectedStationId.set(null);
  }

  public formatRelativeTime(timestamp: number): string {
    const diff = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diff < 3) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    return `${Math.floor(diff / 60)}m ago`;
  }
}
