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
import { WebrtcService } from '../../services/webrtc.service';
import { DetectionApiService } from '../../services/detection.service';
import { DetectionLogService } from '../../services/detection-log.service';
import { BoundingBox, PoseSkeleton, SuspicionBreakdown } from '../../models/detection.model';

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

  public readonly stationId: WritableSignal<string> = signal<string>('');
  public readonly stationName: WritableSignal<string> = signal<string>('Phone CCTV Station');
  public readonly isEditingStationName: WritableSignal<boolean> = signal<boolean>(false);
  public readonly activeTheftAlerts: WritableSignal<string[]> = signal<string[]>([]);
  public readonly highestSuspicionScore: WritableSignal<number> = signal<number>(0);

  public currentDetections: BoundingBox[] = [];
  public currentPoses: PoseSkeleton[] = [];
  public currentSuspicion: SuspicionBreakdown[] = [];

  private mediaStream: MediaStream | null = null;
  private captureIntervalId: ReturnType<typeof setInterval> | null = null;
  private frameCounter: number = 0;
  private lastFpsTimestamp: number = Date.now();
  private framesSinceLastFps: number = 0;
  private renderAnimationId: number | null = null;
  private lastBackendTimestamp: number = 0;
  private lastSendTimestamp: number = 0;
  private lastDetectionReceivedAt: number = 0;
  private isProcessingFrame: boolean = false;
  private sentFrameWidth: number = 640;
  private sentFrameHeight: number = 360;
  private readonly smoothedBoxes: Map<string, [number, number, number, number]> = new Map();

  constructor(
    public readonly wsService: WebSocketService,
    public readonly webrtcService: WebrtcService,
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
        const suspicion = result.suspicion || [];

        if (boxes.length > 0 || poses.length > 0) {
          this.currentDetections = boxes;
          this.currentPoses = poses;
          this.currentSuspicion = suspicion;
          this.currentDetectionsCount.set(boxes.length);
          this.lastDetectionReceivedAt = Date.now();
        } else if (Date.now() - this.lastDetectionReceivedAt > 3500) {
          this.currentDetections = [];
          this.currentPoses = [];
          this.currentSuspicion = [];
          this.currentDetectionsCount.set(0);
        }

        if (boxes.length > 0) {
          const chips = boxes.map((d) => ({
            label: d.label,
            confidence: Math.round(d.confidence * 100),
          }));
          this.detectedObjectChips.set(chips);
          this.logService.recordDetections(boxes);
        } else if (Date.now() - this.lastDetectionReceivedAt > 3500) {
          this.detectedObjectChips.set([]);
        }

        const alerts: string[] = [];
        let maxScore = 0;
        suspicion.forEach((s) => {
          if (s.score > maxScore) {
            maxScore = s.score;
          }
          if (s.triggers && s.triggers.length > 0) {
            s.triggers.forEach((t) => alerts.push(`Person #${s.trackId}: ${t}`));
          }
        });
        this.highestSuspicionScore.set(maxScore);
        this.activeTheftAlerts.set(alerts);
      }
    });
  }

  public ngOnInit(): void {
    this.initStationIdentity();
    this.startRenderLoop();
  }

  public ngOnDestroy(): void {
    this.stopStream();
    if (this.renderAnimationId !== null) {
      cancelAnimationFrame(this.renderAnimationId);
    }
  }

  private initStationIdentity(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      this.stationId.set('cctv-phone-node');
      return;
    }

    const storedId = localStorage.getItem('cctv_station_id');
    const storedName = localStorage.getItem('cctv_station_name');

    if (storedId) {
      this.stationId.set(storedId);
    } else {
      const newId = 'cctv-' + Math.random().toString(36).substring(2, 7);
      this.stationId.set(newId);
      localStorage.setItem('cctv_station_id', newId);
    }

    if (storedName) {
      this.stationName.set(storedName);
    } else {
      const defaultName = `Mobile CCTV (${this.stationId()})`;
      this.stationName.set(defaultName);
      localStorage.setItem('cctv_station_name', defaultName);
    }
  }

  public saveStationName(newName: string): void {
    const trimmed = newName.trim();
    if (trimmed) {
      this.stationName.set(trimmed);
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem('cctv_station_name', trimmed);
      }
      if (this.isStreaming() && this.mediaStream) {
        this.webrtcService.startBroadcasting(this.stationId(), trimmed, this.mediaStream);
      }
    }
    this.isEditingStationName.set(false);
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
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

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
        const video = this.videoRef.nativeElement;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');
        video.srcObject = this.mediaStream;
        try {
          await video.play();
        } catch (playErr) {
          console.warn('Video play interrupted:', playErr);
        }
      }

      this.isStreaming.set(true);
      this.wsService.registerCameraNode(this.stationId(), this.stationName());
      this.webrtcService.startBroadcasting(this.stationId(), this.stationName(), this.mediaStream);
      this.startCaptureInterval();
    } catch (err: unknown) {
      console.error('Camera access failed:', err);
      this.stopStream();
    }
  }

  public stopStream(): void {
    this.isStreaming.set(false);
    this.isProcessingFrame = false;

    if (this.captureIntervalId) {
      clearInterval(this.captureIntervalId);
      this.captureIntervalId = null;
    }

    this.webrtcService.stopBroadcasting();
    this.wsService.unregisterCameraNode(this.stationId());

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          return;
        }
      });
      this.mediaStream = null;
    }

    if (this.videoRef?.nativeElement) {
      const video = this.videoRef.nativeElement;
      try {
        video.pause();
      } catch {
        return;
      }
      try {
        video.srcObject = null;
      } catch {
        return;
      }
    }

    if (this.hudCanvasRef?.nativeElement) {
      const canvas = this.hudCanvasRef.nativeElement;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    this.currentDetections = [];
    this.currentPoses = [];
    this.currentSuspicion = [];
    this.currentDetectionsCount.set(0);
    this.detectedObjectChips.set([]);
    this.activeTheftAlerts.set([]);
    this.highestSuspicionScore.set(0);
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

    const intervalMs = 60;
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

    if (hiddenCanvas.width !== targetW || hiddenCanvas.height !== targetH) {
      hiddenCanvas.width = targetW;
      hiddenCanvas.height = targetH;
    }
    this.sentFrameWidth = targetW;
    this.sentFrameHeight = targetH;

    try {
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
        this.stationId(),
        this.stationName(),
        this.logService.currentUser().id,
      );
    } catch {
      return;
    }
  }

  private startRenderLoop(): void {
    const loop = (): void => {
      try {
        if (this.isStreaming()) {
          const video = this.videoRef?.nativeElement;
          const canvas = this.hudCanvasRef?.nativeElement;

          if (video && canvas && video.readyState >= 2) {
            const vWidth = video.videoWidth || 1280;
            const vHeight = video.videoHeight || 720;

            if (vWidth > 0 && vHeight > 0 && (canvas.width !== vWidth || canvas.height !== vHeight)) {
              canvas.width = vWidth;
              canvas.height = vHeight;
            }

            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.clearRect(0, 0, canvas.width, canvas.height);

              const posesToRender = this.currentPoses;
              const boxesToRender = this.currentDetections;

              const scaleX = canvas.width / (this.sentFrameWidth || canvas.width);
              const scaleY = canvas.height / (this.sentFrameHeight || canvas.height);

              this.renderPoses(ctx, posesToRender, scaleX, scaleY);
              this.renderBoxes(ctx, boxesToRender, scaleX, scaleY);
            }
          }
        }
      } catch {
        return;
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
      if (!pose || !pose.keypoints) {
        return;
      }
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

  private renderBoxes(ctx: CanvasRenderingContext2D, boxes: BoundingBox[], scaleX: number, scaleY: number): void {
    if (!boxes || boxes.length === 0) {
      return;
    }

    const suspicionMap = new Map<number, SuspicionBreakdown>();
    this.currentSuspicion.forEach((s) => {
      if (s && s.trackId !== undefined) {
        suspicionMap.set(s.trackId, s);
      }
    });

    const activeKeys = new Set<string>();

    boxes.forEach((box) => {
      if (!box || !box.bbox || box.bbox.length < 4) {
        return;
      }
      const rawBbox = box.bbox;
      const targetX1 = rawBbox[0] * scaleX;
      const targetY1 = rawBbox[1] * scaleY;
      const targetX2 = rawBbox[2] * scaleX;
      const targetY2 = rawBbox[3] * scaleY;

      const boxKey = `${box.trackId}_${box.label}`;
      activeKeys.add(boxKey);

      let x1 = targetX1;
      let y1 = targetY1;
      let x2 = targetX2;
      let y2 = targetY2;

      const prev = this.smoothedBoxes.get(boxKey);
      if (prev) {
        x1 = prev[0] + (targetX1 - prev[0]) * 0.45;
        y1 = prev[1] + (targetY1 - prev[1]) * 0.45;
        x2 = prev[2] + (targetX2 - prev[2]) * 0.45;
        y2 = prev[3] + (targetY2 - prev[3]) * 0.45;
      }
      this.smoothedBoxes.set(boxKey, [x1, y1, x2, y2]);

      const w = Math.max(4, x2 - x1);
      const h = Math.max(4, y2 - y1);
      const labelLower = (box.label || '').toLowerCase();

      let strokeColor = '#10b981';
      let fillColor = 'rgba(16, 185, 129, 0.08)';
      let labelText = `ID #${box.trackId} · ${box.label.toUpperCase()}`;

      if (labelLower === 'person') {
        const susp = suspicionMap.get(box.trackId);
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

        if (susp?.waistBbox) {
          const [wx1, wy1, wx2, wy2] = susp.waistBbox;
          ctx.strokeStyle = '#c084fc';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(wx1 * scaleX, wy1 * scaleY, (wx2 - wx1) * scaleX, (wy2 - wy1) * scaleY);
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
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x1, y1, w, h);

      ctx.fillStyle = fillColor;
      ctx.fillRect(x1, y1, w, h);

      const bracketLen = Math.min(16, Math.min(w, h) * 0.25);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x1, y1 + bracketLen);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1 + bracketLen, y1);

      ctx.moveTo(x2 - bracketLen, y1);
      ctx.lineTo(x2, y1);
      ctx.lineTo(x2, y1 + bracketLen);

      ctx.moveTo(x1, y2 - bracketLen);
      ctx.lineTo(x1, y2);
      ctx.lineTo(x1 + bracketLen, y2);

      ctx.moveTo(x2 - bracketLen, y2);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2, y2 - bracketLen);
      ctx.stroke();

      ctx.font = '600 12px "IBM Plex Mono", monospace';
      const textMetrics = ctx.measureText(labelText);
      const badgeH = 22;
      const badgeW = Math.max(textMetrics.width + 16, 80);
      const badgeY = Math.max(0, y1 - badgeH - 3);

      ctx.fillStyle = '#111110';
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x1, badgeY, badgeW, badgeH, 4);
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.fillRect(x1, badgeY, badgeW, badgeH);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x1, badgeY, badgeW, badgeH);
      }

      ctx.fillStyle = '#f0ede6';
      ctx.fillText(labelText, x1 + 8, badgeY + 15);
    });

    if (this.smoothedBoxes.size > 20) {
      for (const key of this.smoothedBoxes.keys()) {
        if (!activeKeys.has(key)) {
          this.smoothedBoxes.delete(key);
        }
      }
    }
  }
}
