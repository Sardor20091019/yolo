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
        } else if (Date.now() - this.lastDetectionReceivedAt > 1500) {
          this.currentDetections = [];
          this.currentPoses = [];
          this.currentSuspicion = [];
          this.currentDetectionsCount.set(0);
        }

        if (boxes.length > 0) {
          const chips = boxes.map((d) => ({
            label: (d.label || 'object').toLowerCase(),
            confidence: Math.round((Number(d.confidence) || 0.85) * 100),
          }));
          this.detectedObjectChips.set(chips);
          this.logService.recordDetections(boxes);
        } else if (Date.now() - this.lastDetectionReceivedAt > 1500) {
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

          if (video && canvas && (video.readyState >= 1 || video.videoWidth > 0)) {
            const vWidth = video.videoWidth || 1280;
            const vHeight = video.videoHeight || 720;

            if (vWidth > 0 && vHeight > 0 && (canvas.width !== vWidth || canvas.height !== vHeight)) {
              canvas.width = vWidth;
              canvas.height = vHeight;
            }

            const ctx = canvas.getContext('2d');
            if (ctx && canvas.width > 0 && canvas.height > 0) {
              ctx.clearRect(0, 0, canvas.width, canvas.height);

              const posesToRender = this.currentPoses;
              const boxesToRender = this.currentDetections;

              const sentW = this.sentFrameWidth > 0 ? this.sentFrameWidth : canvas.width;
              const sentH = this.sentFrameHeight > 0 ? this.sentFrameHeight : canvas.height;
              const scaleX = sentW > 0 && isFinite(canvas.width / sentW) ? canvas.width / sentW : 1;
              const scaleY = sentH > 0 && isFinite(canvas.height / sentH) ? canvas.height / sentH : 1;

              this.renderPoses(ctx, posesToRender, scaleX, scaleY);
              this.renderBoxes(ctx, boxesToRender, scaleX, scaleY);
            }
          }
        }
      } catch (err: unknown) {
        console.error('HUD render error:', err);
      } finally {
        this.renderAnimationId = requestAnimationFrame(loop);
      }
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
              const x1 = kp1.x * scaleX;
              const y1 = kp1.y * scaleY;
              const x2 = kp2.x * scaleX;
              const y2 = kp2.y * scaleY;
              if (isFinite(x1) && isFinite(y1) && isFinite(x2) && isFinite(y2)) {
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
              }
            }
          }
        });
      }

      kps.forEach((kp) => {
        if (kp && kp.confidence >= 0.2 && kp.x > 0 && kp.y > 0) {
          const sx = kp.x * scaleX;
          const sy = kp.y * scaleY;

          if (isFinite(sx) && isFinite(sy)) {
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
        }
      });
    });
  }

  private renderBoxes(ctx: CanvasRenderingContext2D, boxes: BoundingBox[], scaleX: number, scaleY: number): void {
    if (!boxes || boxes.length === 0) {
      return;
    }

    const suspicionMap = new Map<number, SuspicionBreakdown>();
    (this.currentSuspicion || []).forEach((s) => {
      if (s && s.trackId !== undefined) {
        suspicionMap.set(s.trackId, s);
      }
    });

    const activeKeys = new Set<string>();

    boxes.forEach((box) => {
      if (!box || !Array.isArray(box.bbox) || box.bbox.length < 4) {
        return;
      }
      const rawBbox = box.bbox;
      const b0 = Number(rawBbox[0]) || 0;
      const b1 = Number(rawBbox[1]) || 0;
      const b2 = Number(rawBbox[2]) || 0;
      const b3 = Number(rawBbox[3]) || 0;

      const targetX1 = b0 * scaleX;
      const targetY1 = b1 * scaleY;
      const targetX2 = b2 * scaleX;
      const targetY2 = b3 * scaleY;

      const trackId = box.trackId !== undefined && box.trackId !== null ? box.trackId : 1;
      const rawLabel = (box.label || 'object').trim();
      const boxKey = `${trackId}_${rawLabel}`;
      activeKeys.add(boxKey);

      let x1 = targetX1;
      let y1 = targetY1;
      let x2 = targetX2;
      let y2 = targetY2;

      const prev = this.smoothedBoxes.get(boxKey);
      if (prev && isFinite(prev[0]) && isFinite(prev[1]) && isFinite(prev[2]) && isFinite(prev[3])) {
        x1 = prev[0] + (targetX1 - prev[0]) * 0.55;
        y1 = prev[1] + (targetY1 - prev[1]) * 0.55;
        x2 = prev[2] + (targetX2 - prev[2]) * 0.55;
        y2 = prev[3] + (targetY2 - prev[3]) * 0.55;
      }
      this.smoothedBoxes.set(boxKey, [x1, y1, x2, y2]);

      const w = Math.max(8, x2 - x1);
      const h = Math.max(8, y2 - y1);
      const labelLower = rawLabel.toLowerCase();
      const labelUpper = rawLabel.toUpperCase();

      let strokeColor = '#10b981';
      let fillColor = 'rgba(16, 185, 129, 0.12)';
      let labelText = `ID #${trackId} · ${labelUpper}`;

      if (labelLower === 'person') {
        const susp = suspicionMap.get(trackId);
        const score = susp ? Number(susp.score) || 0 : 0;
        if (score >= 50 || (susp?.triggers && susp.triggers.length > 0)) {
          strokeColor = '#ef4444';
          fillColor = 'rgba(239, 68, 68, 0.2)';
          labelText = `ALERT #${trackId} · SUSP: ${Math.round(score)}%`;
        } else if (score >= 25) {
          strokeColor = '#f59e0b';
          fillColor = 'rgba(245, 158, 11, 0.15)';
          labelText = `CAUTION #${trackId} · ${Math.round(score)}%`;
        } else {
          strokeColor = '#10b981';
          fillColor = 'rgba(16, 185, 129, 0.1)';
          labelText = `PERSON #${trackId} · SAFE`;
        }

        if (susp?.waistBbox && Array.isArray(susp.waistBbox) && susp.waistBbox.length === 4) {
          const wx1 = (Number(susp.waistBbox[0]) || 0) * scaleX;
          const wy1 = (Number(susp.waistBbox[1]) || 0) * scaleY;
          const wx2 = (Number(susp.waistBbox[2]) || 0) * scaleX;
          const wy2 = (Number(susp.waistBbox[3]) || 0) * scaleY;
          if (isFinite(wx1) && isFinite(wy1) && isFinite(wx2) && isFinite(wy2)) {
            ctx.strokeStyle = '#c084fc';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(wx1, wy1, Math.max(4, wx2 - wx1), Math.max(4, wy2 - wy1));
          }
        }
      } else if (labelLower === 'face') {
        strokeColor = '#a855f7';
        fillColor = 'rgba(168, 85, 247, 0.15)';
        labelText = `FACE · ${Math.round((Number(box.confidence) || 0.95) * 100)}%`;
      } else {
        strokeColor = '#f59e0b';
        fillColor = 'rgba(245, 158, 11, 0.12)';
        labelText = `${labelUpper} · ${Math.round((Number(box.confidence) || 0.85) * 100)}%`;
      }

      if (!isFinite(x1) || !isFinite(y1) || !isFinite(w) || !isFinite(h)) {
        return;
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, w, h);

      ctx.fillStyle = fillColor;
      ctx.fillRect(x1, y1, w, h);

      const bracketLen = Math.min(20, Math.min(w, h) * 0.25);
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
      const badgeW = Math.max(textMetrics.width + 16, 70);
      const badgeY = Math.max(0, y1 - badgeH - 3);

      const safeX = Math.max(0, Math.min(ctx.canvas.width - badgeW, x1));
      const safeY = Math.max(0, Math.min(ctx.canvas.height - badgeH, badgeY));

      ctx.fillStyle = '#111110';
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(safeX, safeY, badgeW, badgeH, 4);
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.fillRect(safeX, safeY, badgeW, badgeH);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(safeX, safeY, badgeW, badgeH);
      }

      ctx.fillStyle = '#f0ede6';
      ctx.fillText(labelText, safeX + 8, safeY + 15);
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
