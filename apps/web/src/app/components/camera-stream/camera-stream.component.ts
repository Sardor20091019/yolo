import {
  Component,
  ElementRef,
  ViewChild,
  OnInit,
  OnDestroy,
  signal,
  effect,
  WritableSignal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WebSocketService } from '../../services/websocket.service';
import { DetectionApiService } from '../../services/detection.service';
import { FrameResult, BoundingBox, PoseSkeleton, SuspicionBreakdown, DetectionZone } from '../../models/detection.model';

@Component({
  selector: 'app-camera-stream',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './camera-stream.component.html',
})
export class CameraStreamComponent implements OnInit, OnDestroy {
  @ViewChild('videoElement') public videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('hudCanvas') public hudCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('hiddenCanvas') public hiddenCanvasRef!: ElementRef<HTMLCanvasElement>;

  public readonly isStreaming: WritableSignal<boolean> = signal<boolean>(false);
  public readonly mode: WritableSignal<'WEBCAM' | 'IP_CAMERA'> = signal<'WEBCAM' | 'IP_CAMERA'>('WEBCAM');
  public readonly ipStreamUrl: WritableSignal<string> = signal<string>('');
  public readonly fps: WritableSignal<number> = signal<number>(0);
  public readonly threatCount: WritableSignal<number> = signal<number>(0);
  public readonly isDrawingZone: WritableSignal<boolean> = signal<boolean>(false);
  public readonly activeDrawPoints: WritableSignal<[number, number][]> = signal<[number, number][]>([]);
  public newZoneName: string = 'Electronics Shelf 1';
  public newZoneDwell: number = 8;

  private mediaStream: MediaStream | null = null;
  private captureIntervalId: any = null;
  private frameCounter: number = 0;
  private lastFpsTimestamp: number = Date.now();
  private framesSinceLastFps: number = 0;
  private renderAnimationId: number | null = null;

  constructor(
    public readonly wsService: WebSocketService,
    public readonly detectionApi: DetectionApiService,
  ) {
    effect(() => {
      const result = this.wsService.latestResult();
      if (result) {
        this.renderHud(result);
        const highRisks = result.suspicion.filter((s) => s.score >= 70).length;
        this.threatCount.set(highRisks);
      }
    });
  }

  public ngOnInit(): void {
    this.detectionApi.fetchZones().subscribe();
    this.startRenderLoop();
  }

  public ngOnDestroy(): void {
    this.stopStream();
    if (this.renderAnimationId !== null) {
      cancelAnimationFrame(this.renderAnimationId);
    }
  }

  public async toggleStream(): Promise<void> {
    if (this.isStreaming()) {
      this.stopStream();
    } else {
      await this.startStream();
    }
  }

  public async startStream(): Promise<void> {
    if (this.mode() === 'WEBCAM') {
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
          audio: false,
        });

        if (this.videoRef?.nativeElement) {
          this.videoRef.nativeElement.srcObject = this.mediaStream;
          await this.videoRef.nativeElement.play();
        }

        this.isStreaming.set(true);
        this.startCaptureInterval();
      } catch (err: unknown) {
        console.error('Camera access failed:', err);
      }
    } else {
      this.isStreaming.set(true);
      this.startCaptureInterval();
    }
  }

  public stopStream(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.videoRef?.nativeElement) {
      this.videoRef.nativeElement.srcObject = null;
    }
    if (this.captureIntervalId) {
      clearInterval(this.captureIntervalId);
      this.captureIntervalId = null;
    }
    this.isStreaming.set(false);
  }

  public setMode(newMode: 'WEBCAM' | 'IP_CAMERA'): void {
    if (this.isStreaming()) {
      this.stopStream();
    }
    this.mode.set(newMode);
  }

  private startCaptureInterval(): void {
    if (this.captureIntervalId) {
      clearInterval(this.captureIntervalId);
    }

    const intervalMs = Math.round(1000 / 15);
    this.captureIntervalId = setInterval(() => {
      this.captureAndSendFrame();
    }, intervalMs);
  }

  private captureAndSendFrame(): void {
    if (!this.isStreaming()) {
      return;
    }

    const video = this.videoRef?.nativeElement;
    const hiddenCanvas = this.hiddenCanvasRef?.nativeElement;
    if (!hiddenCanvas) {
      return;
    }

    const ctx = hiddenCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    let frameBase64 = '';

    if (this.mode() === 'WEBCAM' && video && video.readyState >= 2) {
      hiddenCanvas.width = video.videoWidth || 640;
      hiddenCanvas.height = video.videoHeight || 360;
      ctx.drawImage(video, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
      frameBase64 = hiddenCanvas.toDataURL('image/jpeg', 0.65);
    } else {
      hiddenCanvas.width = 640;
      hiddenCanvas.height = 360;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 640, 360);
      frameBase64 = hiddenCanvas.toDataURL('image/jpeg', 0.5);
    }

    this.frameCounter++;
    this.framesSinceLastFps++;
    const now = Date.now();
    if (now - this.lastFpsTimestamp >= 1000) {
      this.fps.set(this.framesSinceLastFps);
      this.framesSinceLastFps = 0;
      this.lastFpsTimestamp = now;
    }

    this.wsService.sendFrame(frameBase64, this.frameCounter, this.mode());
  }

  private startRenderLoop(): void {
    const loop = () => {
      const result = this.wsService.latestResult();
      if (result) {
        this.renderHud(result);
      }
      this.renderAnimationId = requestAnimationFrame(loop);
    };
    this.renderAnimationId = requestAnimationFrame(loop);
  }

  public handleCanvasClick(event: MouseEvent): void {
    if (!this.isDrawingZone()) {
      return;
    }
    const canvas = this.hudCanvasRef?.nativeElement;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((event.clientX - rect.left) * scaleX);
    const y = Math.round((event.clientY - rect.top) * scaleY);

    this.activeDrawPoints.update((pts) => [...pts, [x, y]]);
  }

  public toggleDrawZone(): void {
    if (this.isDrawingZone()) {
      this.isDrawingZone.set(false);
      this.activeDrawPoints.set([]);
    } else {
      this.isDrawingZone.set(true);
      this.activeDrawPoints.set([]);
    }
  }

  public saveDrawnZone(): void {
    const points = this.activeDrawPoints();
    if (points.length < 3) {
      return;
    }

    const newZone: Partial<DetectionZone> = {
      name: this.newZoneName,
      polygon_coordinates: JSON.stringify(points),
      dwell_time_threshold: Number(this.newZoneDwell),
      is_active: true,
    };

    this.detectionApi.createZone(newZone).subscribe({
      next: () => {
        this.isDrawingZone.set(false);
        this.activeDrawPoints.set([]);
      },
    });
  }

  public cancelDrawZone(): void {
    this.isDrawingZone.set(false);
    this.activeDrawPoints.set([]);
  }

  private renderHud(result: FrameResult): void {
    const canvas = this.hudCanvasRef?.nativeElement;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    this.renderZones(ctx);
    this.renderActiveDrawing(ctx);

    const suspicionMap = new Map<number, SuspicionBreakdown>();
    result.suspicion.forEach((s) => suspicionMap.set(s.trackId, s));

    this.renderBoxes(ctx, result.boxes, suspicionMap);
    this.renderPoses(ctx, result.poses);
  }

  private renderZones(ctx: CanvasRenderingContext2D): void {
    const zones = this.detectionApi.zones();
    zones.forEach((zone) => {
      try {
        const polygon: [number, number][] = JSON.parse(zone.polygon_coordinates || '[]');
        if (polygon.length < 3) return;

        ctx.beginPath();
        ctx.moveTo(polygon[0][0], polygon[0][1]);
        for (let i = 1; i < polygon.length; i++) {
          ctx.lineTo(polygon[i][0], polygon[i][1]);
        }
        ctx.closePath();

        ctx.fillStyle = 'rgba(0, 240, 255, 0.08)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#00f0ff';
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#00f0ff';
        ctx.font = '11px JetBrains Mono';
        ctx.fillText(`ZONE: ${zone.name}`, polygon[0][0] + 6, polygon[0][1] + 16);
      } catch (e) {
        return;
      }
    });
  }

  private renderActiveDrawing(ctx: CanvasRenderingContext2D): void {
    const points = this.activeDrawPoints();
    if (points.length === 0) return;

    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }

    ctx.strokeStyle = '#ffb800';
    ctx.lineWidth = 2;
    ctx.stroke();

    points.forEach(([px, py]) => {
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffb800';
      ctx.fill();
    });
  }

  private renderBoxes(
    ctx: CanvasRenderingContext2D,
    boxes: BoundingBox[],
    suspicionMap: Map<number, SuspicionBreakdown>,
  ): void {
    boxes.forEach((box) => {
      const [x1, y1, x2, y2] = box.bbox;
      const w = x2 - x1;
      const h = y2 - y1;
      const sus = suspicionMap.get(box.trackId);
      const score = sus ? sus.score : 0;

      let color = '#00e599';
      if (score >= 75) {
        color = '#ff2a5f';
      } else if (score >= 40) {
        color = '#ffb800';
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = score >= 75 ? 2.5 : 1.8;
      ctx.strokeRect(x1, y1, w, h);

      const cornerLen = 12;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1 + cornerLen);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1 + cornerLen, y1);

      ctx.moveTo(x2 - cornerLen, y1);
      ctx.lineTo(x2, y1);
      ctx.lineTo(x2, y1 + cornerLen);

      ctx.moveTo(x1, y2 - cornerLen);
      ctx.lineTo(x1, y2);
      ctx.lineTo(x1 + cornerLen, y2);

      ctx.moveTo(x2 - cornerLen, y2);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2, y2 - cornerLen);
      ctx.stroke();

      const badgeH = 22;
      const badgeW = Math.max(130, w);
      ctx.fillStyle = 'rgba(10, 13, 20, 0.85)';
      ctx.fillRect(x1, Math.max(0, y1 - badgeH), badgeW, badgeH);

      ctx.fillStyle = color;
      ctx.font = 'bold 11px JetBrains Mono';
      ctx.fillText(`ID:${box.trackId} ${box.label.toUpperCase()} ${score}%`, x1 + 4, Math.max(14, y1 - 6));

      if (sus && sus.triggers && sus.triggers.length > 0) {
        sus.triggers.forEach((trig, idx) => {
          const trigY = y2 + 16 + idx * 16;
          ctx.fillStyle = 'rgba(255, 42, 95, 0.9)';
          ctx.font = 'bold 10px JetBrains Mono';
          ctx.fillText(`! ${trig}`, x1, trigY);
        });
      }
    });
  }

  private renderPoses(ctx: CanvasRenderingContext2D, poses: PoseSkeleton[]): void {
    poses.forEach((pose) => {
      const kps = pose.keypoints;

      pose.skeleton.forEach(([i1, i2]) => {
        if (i1 < kps.length && i2 < kps.length) {
          const kp1 = kps[i1];
          const kp2 = kps[i2];
          if (kp1.confidence > 0.35 && kp2.confidence > 0.35) {
            ctx.beginPath();
            ctx.moveTo(kp1.x, kp1.y);
            ctx.lineTo(kp2.x, kp2.y);
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.65)';
            ctx.lineWidth = 1.8;
            ctx.stroke();
          }
        }
      });

      kps.forEach((kp) => {
        if (kp.confidence > 0.35) {
          ctx.beginPath();
          ctx.arc(kp.x, kp.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = kp.name.includes('wrist') ? '#ff2a5f' : '#00f0ff';
          ctx.fill();
        }
      });
    });
  }
}

