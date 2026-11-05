import {
  Component,
  ElementRef,
  ViewChild,
  OnInit,
  OnDestroy,
  signal,
  effect,
  WritableSignal,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WebSocketService } from '../../services/websocket.service';
import { DetectionApiService } from '../../services/detection.service';
import { DetectionLogService } from '../../services/detection-log.service';
import { BoundingBox, PoseSkeleton } from '../../models/detection.model';

@Component({
  selector: 'app-camera-stream',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './camera-stream.component.html',
})
export class CameraStreamComponent implements OnInit, OnDestroy {
  @ViewChild('cameraContainer') public containerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('videoElement') public videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('hudCanvas') public hudCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('hiddenCanvas') public hiddenCanvasRef!: ElementRef<HTMLCanvasElement>;

  public readonly isStreaming: WritableSignal<boolean> = signal<boolean>(false);
  public readonly isFullscreen: WritableSignal<boolean> = signal<boolean>(false);
  public readonly fps: WritableSignal<number> = signal<number>(0);
  public readonly facingMode: WritableSignal<'environment' | 'user'> = signal<'environment' | 'user'>('user');
  public readonly currentDetectionsCount: WritableSignal<number> = signal<number>(0);
  public readonly detectedObjectChips: WritableSignal<{ label: string; confidence: number }[]> = signal([]);
  public readonly latencyMs: WritableSignal<number> = signal<number>(16);

  public currentDetections: BoundingBox[] = [];
  public currentPoses: PoseSkeleton[] = [];

  private mediaStream: MediaStream | null = null;
  private captureIntervalId: ReturnType<typeof setInterval> | null = null;
  private frameCounter: number = 0;
  private lastFpsTimestamp: number = Date.now();
  private framesSinceLastFps: number = 0;
  private renderAnimationId: number | null = null;
  private lastBackendTimestamp: number = 0;
  private lastSendTimestamp: number = 0;
  private isProcessingFrame: boolean = false;
  private sentFrameWidth: number = 640;
  private sentFrameHeight: number = 360;

  constructor(
    public readonly wsService: WebSocketService,
    public readonly detectionApi: DetectionApiService,
    public readonly logService: DetectionLogService,
  ) {
    effect(() => {
      const result = this.wsService.latestResult();
      if (result) {
        this.isProcessingFrame = false;
        this.lastBackendTimestamp = Date.now();
        if (this.lastSendTimestamp > 0) {
          const roundTrip = Math.max(12, Math.min(250, this.lastBackendTimestamp - this.lastSendTimestamp));
          this.latencyMs.set(roundTrip);
        }

        const boxes = result.boxes || [];
        const poses = result.poses || [];

        if (boxes.length > 0 || poses.length > 0) {
          this.currentDetections = boxes;
          this.currentPoses = poses;
          this.currentDetectionsCount.set(boxes.length);

          const chips = boxes.map((d) => ({
            label: d.label,
            confidence: Math.round(d.confidence * 100),
          }));
          this.detectedObjectChips.set(chips);
          this.logService.recordDetections(boxes);
        } else if (Date.now() - this.lastBackendTimestamp > 1200) {
          this.currentDetections = [];
          this.currentPoses = [];
          this.currentDetectionsCount.set(0);
          this.detectedObjectChips.set([]);
        }
      }
    });
  }

  public ngOnInit(): void {
    this.startRenderLoop();
  }

  public ngOnDestroy(): void {
    this.stopStream();
    if (this.renderAnimationId !== null) {
      cancelAnimationFrame(this.renderAnimationId);
    }
  }

  @HostListener('document:fullscreenchange')
  public onFullscreenChange(): void {
    const isDocFullscreen = !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);
    this.isFullscreen.set(isDocFullscreen);
  }

  @HostListener('document:webkitfullscreenchange')
  public onWebkitFullscreenChange(): void {
    const isDocFullscreen = !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);
    this.isFullscreen.set(isDocFullscreen);
  }

  public async toggleStreaming(): Promise<void> {
    if (this.isStreaming()) {
      this.stopStream();
    } else {
      await this.startStream();
    }
  }

  public async startStream(): Promise<void> {
    try {
      let stream: MediaStream;
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: this.facingMode() },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: this.facingMode() },
            },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
      }

      this.mediaStream = stream;

      if (this.videoRef?.nativeElement) {
        this.videoRef.nativeElement.srcObject = this.mediaStream;
        await this.videoRef.nativeElement.play();
      }

      this.isStreaming.set(true);
      this.startCaptureInterval();
    } catch (err: unknown) {
      console.error('Camera access failed:', err);
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
    this.currentDetections = [];
    this.currentPoses = [];
    this.currentDetectionsCount.set(0);
    this.detectedObjectChips.set([]);
    this.isStreaming.set(false);
    this.isProcessingFrame = false;
  }

  public async toggleCameraFacing(): Promise<void> {
    const nextFacing = this.facingMode() === 'environment' ? 'user' : 'environment';
    this.facingMode.set(nextFacing);

    if (this.isStreaming()) {
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((track) => track.stop());
        this.mediaStream = null;
      }
      await this.startStream();
    }
  }

  public async toggleFullscreen(): Promise<void> {
    const el = this.containerRef?.nativeElement;
    if (!el) {
      return;
    }

    if (!document.fullscreenElement && !(document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement) {
      try {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if ((el as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen) {
          await (el as unknown as { webkitRequestFullscreen: () => Promise<void> }).webkitRequestFullscreen();
        }
      } catch {
        this.isFullscreen.set(true);
      }
    } else {
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as unknown as { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen) {
          await (document as unknown as { webkitExitFullscreen: () => Promise<void> }).webkitExitFullscreen();
        }
      } catch {
        this.isFullscreen.set(false);
      }
    }
  }

  private startCaptureInterval(): void {
    if (this.captureIntervalId) {
      clearInterval(this.captureIntervalId);
    }

    const intervalMs = 120;
    this.captureIntervalId = setInterval(() => {
      this.captureAndProcessFrame();
    }, intervalMs);
  }

  private captureAndProcessFrame(): void {
    if (!this.isStreaming()) {
      return;
    }

    const now = Date.now();
    if (this.isProcessingFrame && now - this.lastSendTimestamp < 1500) {
      return;
    }

    const video = this.videoRef?.nativeElement;
    const hiddenCanvas = this.hiddenCanvasRef?.nativeElement;
    if (!hiddenCanvas || !video || video.readyState < 2) {
      return;
    }

    const ctx = hiddenCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const vWidth = video.videoWidth || 640;
    const vHeight = video.videoHeight || 360;

    const maxDim = 640;
    let targetW = vWidth;
    let targetH = vHeight;
    if (vWidth > maxDim || vHeight > maxDim) {
      if (vWidth >= vHeight) {
        targetW = maxDim;
        targetH = Math.round((vHeight / vWidth) * maxDim);
      } else {
        targetH = maxDim;
        targetW = Math.round((vWidth / vHeight) * maxDim);
      }
    }

    hiddenCanvas.width = targetW;
    hiddenCanvas.height = targetH;
    this.sentFrameWidth = targetW;
    this.sentFrameHeight = targetH;

    ctx.drawImage(video, 0, 0, targetW, targetH);
    const frameBase64 = hiddenCanvas.toDataURL('image/jpeg', 0.6);

    this.frameCounter++;
    this.framesSinceLastFps++;
    if (now - this.lastFpsTimestamp >= 1000) {
      this.fps.set(this.framesSinceLastFps);
      this.framesSinceLastFps = 0;
      this.lastFpsTimestamp = now;
    }

    this.isProcessingFrame = true;
    this.lastSendTimestamp = now;
    this.wsService.sendFrame(
      frameBase64,
      this.frameCounter,
      'WEBCAM',
      this.currentDetections,
      'YOLO26-CLIENT',
      'Live Video Stream',
      this.logService.currentUser().id,
    );
  }

  private startRenderLoop(): void {
    const loop = (): void => {
      if (this.isStreaming()) {
        const video = this.videoRef?.nativeElement;
        const canvas = this.hudCanvasRef?.nativeElement;

        if (video && canvas && video.readyState >= 2) {
          const vWidth = video.videoWidth || 1280;
          const vHeight = video.videoHeight || 720;

          if (canvas.width !== vWidth || canvas.height !== vHeight) {
            canvas.width = vWidth;
            canvas.height = vHeight;
          }

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const now = Date.now();
            const isFresh = now - this.lastBackendTimestamp < 1800;
            const posesToRender = isFresh ? this.currentPoses : [];
            const boxesToRender = isFresh ? this.currentDetections : [];

            const scaleX = canvas.width / (this.sentFrameWidth || canvas.width);
            const scaleY = canvas.height / (this.sentFrameHeight || canvas.height);

            this.renderPoses(ctx, posesToRender, scaleX, scaleY);
            this.renderBoxes(ctx, boxesToRender, scaleX, scaleY);
          }
        }
      }
      this.renderAnimationId = requestAnimationFrame(loop);
    };
    this.renderAnimationId = requestAnimationFrame(loop);
  }

  private renderPoses(ctx: CanvasRenderingContext2D, poses: PoseSkeleton[], scaleX: number, scaleY: number): void {
    if (!poses || poses.length === 0) {
      return;
    }

    poses.forEach((pose) => {
      const kps = pose.keypoints;
      if (!kps || kps.length === 0) {
        return;
      }

      ctx.lineWidth = 3;
      ctx.strokeStyle = '#06b6d4';

      if (pose.skeleton && pose.skeleton.length > 0) {
        pose.skeleton.forEach(([i1, i2]) => {
          if (i1 < kps.length && i2 < kps.length) {
            const kp1 = kps[i1];
            const kp2 = kps[i2];
            if (kp1 && kp2 && kp1.confidence >= 0.3 && kp2.confidence >= 0.3 && kp1.x > 0 && kp2.x > 0 && kp1.y > 0 && kp2.y > 0) {
              ctx.beginPath();
              ctx.moveTo(kp1.x * scaleX, kp1.y * scaleY);
              ctx.lineTo(kp2.x * scaleX, kp2.y * scaleY);
              ctx.stroke();
            }
          }
        });
      }

      kps.forEach((kp) => {
        if (kp.confidence >= 0.3 && kp.x > 0 && kp.y > 0) {
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

  private renderBoxes(ctx: CanvasRenderingContext2D, boxes: BoundingBox[], scaleX: number, scaleY: number): void {
    if (!boxes || boxes.length === 0) {
      return;
    }

    boxes.forEach((box) => {
      const rawBbox = box.bbox;
      const x1 = rawBbox[0] * scaleX;
      const y1 = rawBbox[1] * scaleY;
      const x2 = rawBbox[2] * scaleX;
      const y2 = rawBbox[3] * scaleY;
      const w = Math.max(4, x2 - x1);
      const h = Math.max(4, y2 - y1);
      const labelLower = (box.label || '').toLowerCase();

      let strokeColor = '#10b981';
      let fillColor = 'rgba(16, 185, 129, 0.08)';

      if (labelLower === 'face') {
        strokeColor = '#a855f7';
        fillColor = 'rgba(168, 85, 247, 0.12)';
      } else if (labelLower === 'person') {
        strokeColor = '#38bdf8';
        fillColor = 'rgba(56, 189, 248, 0.08)';
      } else if (labelLower === 'cell phone' || labelLower === 'phone') {
        strokeColor = '#f59e0b';
        fillColor = 'rgba(245, 158, 11, 0.1)';
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x1, y1, w, h);

      ctx.fillStyle = fillColor;
      ctx.fillRect(x1, y1, w, h);

      const confPct = Math.round((box.confidence || 0.85) * 100);
      const labelText = `ID #${box.trackId} · ${box.label.toUpperCase()} · ${confPct}%`;

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
}
