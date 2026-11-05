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

interface CameraLensDevice {
  deviceId: string;
  label: string;
  type: 'ultra-wide' | 'wide' | 'telephoto' | 'standard';
}

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
  public readonly zoomLevel: WritableSignal<number> = signal<number>(1.0);
  public readonly activeLensLabel: WritableSignal<string> = signal<string>('1.0x MAIN');
  public readonly hardwareZoomSupported: WritableSignal<boolean> = signal<boolean>(false);
  public readonly detectedObjectChips: WritableSignal<{ label: string; confidence: number }[]> = signal([]);
  public readonly latencyMs: WritableSignal<number> = signal<number>(16);

  public currentDetections: BoundingBox[] = [];
  public currentPoses: PoseSkeleton[] = [];
  public availableLenses: CameraLensDevice[] = [];
  public activeDeviceId: string = '';

  private mediaStream: MediaStream | null = null;
  private captureIntervalId: ReturnType<typeof setInterval> | null = null;
  private frameCounter: number = 0;
  private lastFpsTimestamp: number = Date.now();
  private framesSinceLastFps: number = 0;
  private renderAnimationId: number | null = null;
  private lastBackendTimestamp: number = 0;
  private lastSendTimestamp: number = 0;

  constructor(
    public readonly wsService: WebSocketService,
    public readonly detectionApi: DetectionApiService,
    public readonly logService: DetectionLogService,
  ) {
    effect(() => {
      const result = this.wsService.latestResult();
      if (result) {
        this.lastBackendTimestamp = Date.now();
        if (this.lastSendTimestamp > 0) {
          const roundTrip = Math.max(12, Math.min(180, this.lastBackendTimestamp - this.lastSendTimestamp));
          this.latencyMs.set(roundTrip);
        }

        const boxes = result.boxes || [];
        const poses = result.poses || [];

        this.currentDetections = boxes;
        this.currentPoses = poses;
        this.currentDetectionsCount.set(boxes.length);

        const chips = boxes.map((d) => ({
          label: d.label,
          confidence: Math.round(d.confidence * 100),
        }));
        this.detectedObjectChips.set(chips);

        if (boxes.length > 0) {
          this.logService.recordDetections(boxes);
        }
      }
    });
  }

  public ngOnInit(): void {
    this.enumerateCameraLenses();
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

  public async enumerateCameraLenses(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      const lenses: CameraLensDevice[] = [];

      videoInputs.forEach((device, index) => {
        const label = device.label.toLowerCase();
        let type: 'ultra-wide' | 'wide' | 'telephoto' | 'standard' = 'standard';

        if (label.includes('ultra') || label.includes('0.5') || label.includes('wide-angle')) {
          type = 'ultra-wide';
        } else if (label.includes('tele') || label.includes('2x') || label.includes('3x') || label.includes('zoom')) {
          type = 'telephoto';
        } else if (label.includes('back') || label.includes('rear') || label.includes('environment')) {
          type = 'wide';
        }

        lenses.push({
          deviceId: device.deviceId,
          label: device.label || `Camera ${index + 1}`,
          type,
        });
      });

      this.availableLenses = lenses;
    } catch {
      this.availableLenses = [];
    }
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
      const constraints = this.buildCameraConstraints();

      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: this.facingMode() },
              width: { ideal: 1280 },
              height: { ideal: 720 },
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

      await this.enumerateCameraLenses();
      this.detectTrackCapabilities();
      await this.applyHardwareZoom(this.zoomLevel());

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
  }

  private buildCameraConstraints(): MediaStreamConstraints {
    if (this.activeDeviceId) {
      return {
        video: {
          deviceId: { exact: this.activeDeviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };
    }

    return {
      video: {
        facingMode: { ideal: this.facingMode() },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };
  }

  private detectTrackCapabilities(): void {
    if (!this.mediaStream) {
      return;
    }
    const track = this.mediaStream.getVideoTracks()[0];
    if (!track) {
      return;
    }

    const caps = track.getCapabilities ? (track.getCapabilities() as unknown as { zoom?: { min: number; max: number } }) : null;
    const settings = track.getSettings ? (track.getSettings() as MediaTrackSettings) : null;

    if (settings && settings.deviceId) {
      this.activeDeviceId = settings.deviceId;
    }

    this.hardwareZoomSupported.set(!!(caps && 'zoom' in caps));
  }

  public async toggleCameraFacing(): Promise<void> {
    const nextFacing = this.facingMode() === 'environment' ? 'user' : 'environment';
    this.facingMode.set(nextFacing);
    this.activeDeviceId = '';
    this.zoomLevel.set(1.0);
    this.updateLensLabel(1.0);

    if (this.isStreaming()) {
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((track) => track.stop());
        this.mediaStream = null;
      }
      await this.startStream();
    }
  }

  public async setZoom(target: number): Promise<void> {
    const clamped = Math.max(0.5, Math.min(5.0, Math.round(target * 10) / 10));
    this.zoomLevel.set(clamped);
    this.updateLensLabel(clamped);

    if (this.facingMode() === 'environment' && this.availableLenses.length > 1) {
      if (clamped <= 0.6) {
        const ultraLens = this.availableLenses.find((l) => l.type === 'ultra-wide');
        if (ultraLens && ultraLens.deviceId !== this.activeDeviceId) {
          await this.switchPhysicalLensDevice(ultraLens.deviceId);
          return;
        }
      } else if (clamped >= 2.5) {
        const teleLens = this.availableLenses.find((l) => l.type === 'telephoto');
        if (teleLens && teleLens.deviceId !== this.activeDeviceId) {
          await this.switchPhysicalLensDevice(teleLens.deviceId);
          return;
        }
      } else {
        const wideLens = this.availableLenses.find((l) => l.type === 'wide');
        if (wideLens && wideLens.deviceId !== this.activeDeviceId && this.activeDeviceId !== '') {
          await this.switchPhysicalLensDevice(wideLens.deviceId);
          return;
        }
      }
    }

    await this.applyHardwareZoom(clamped);
  }

  public async zoomIn(): Promise<void> {
    const current = this.zoomLevel();
    const next = current >= 2.0 ? current + 1.0 : (current >= 1.0 ? current + 0.5 : 1.0);
    await this.setZoom(next);
  }

  public async zoomOut(): Promise<void> {
    const current = this.zoomLevel();
    const next = current > 2.0 ? current - 1.0 : (current > 1.0 ? 1.0 : 0.5);
    await this.setZoom(next);
  }

  private updateLensLabel(level: number): void {
    if (level <= 0.6) {
      this.activeLensLabel.set('0.5x ULTRA-WIDE');
    } else if (level === 1.0) {
      this.activeLensLabel.set('1.0x MAIN');
    } else if (level >= 2.5) {
      this.activeLensLabel.set(`${level.toFixed(1)}x TELEPHOTO`);
    } else {
      this.activeLensLabel.set(`${level.toFixed(1)}x ZOOM`);
    }
  }

  private async switchPhysicalLensDevice(deviceId: string): Promise<void> {
    this.activeDeviceId = deviceId;
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    await this.startStream();
  }

  private async applyHardwareZoom(level: number): Promise<void> {
    if (!this.mediaStream) {
      return;
    }
    const track = this.mediaStream.getVideoTracks()[0];
    if (!track) {
      return;
    }

    const caps = track.getCapabilities ? (track.getCapabilities() as unknown as { zoom?: { min: number; max: number } }) : null;
    if (caps && caps.zoom) {
      try {
        const minZ = caps.zoom.min || 1.0;
        const maxZ = caps.zoom.max || 5.0;
        const hardwareTarget = Math.max(minZ, Math.min(maxZ, level));
        await track.applyConstraints({
          advanced: [{ zoom: hardwareTarget } as unknown as MediaTrackConstraintSet],
        });
      } catch {
        return;
      }
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

    const intervalMs = Math.round(1000 / 12);
    this.captureIntervalId = setInterval(() => {
      this.captureAndProcessFrame();
    }, intervalMs);
  }

  private captureAndProcessFrame(): void {
    if (!this.isStreaming()) {
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
    hiddenCanvas.width = vWidth;
    hiddenCanvas.height = vHeight;

    const hudCanvas = this.hudCanvasRef?.nativeElement;
    if (hudCanvas && (hudCanvas.width !== vWidth || hudCanvas.height !== vHeight)) {
      hudCanvas.width = vWidth;
      hudCanvas.height = vHeight;
    }

    ctx.drawImage(video, 0, 0, vWidth, vHeight);
    const frameBase64 = hiddenCanvas.toDataURL('image/jpeg', 0.65);

    this.frameCounter++;
    this.framesSinceLastFps++;
    const now = Date.now();
    if (now - this.lastFpsTimestamp >= 1000) {
      this.fps.set(this.framesSinceLastFps);
      this.framesSinceLastFps = 0;
      this.lastFpsTimestamp = now;
    }

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
            const isFresh = now - this.lastBackendTimestamp < 2500;
            const posesToRender = isFresh ? this.currentPoses : [];
            const boxesToRender = isFresh ? this.currentDetections : [];

            this.renderPoses(ctx, posesToRender);
            this.renderBoxes(ctx, boxesToRender);
          }
        }
      }
      this.renderAnimationId = requestAnimationFrame(loop);
    };
    this.renderAnimationId = requestAnimationFrame(loop);
  }

  private renderPoses(ctx: CanvasRenderingContext2D, poses: PoseSkeleton[]): void {
    if (!poses || poses.length === 0) {
      return;
    }

    poses.forEach((pose) => {
      const kps = pose.keypoints;
      if (!kps || kps.length === 0) {
        return;
      }

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#06b6d4';

      if (pose.skeleton && pose.skeleton.length > 0) {
        pose.skeleton.forEach(([i1, i2]) => {
          if (i1 < kps.length && i2 < kps.length) {
            const kp1 = kps[i1];
            const kp2 = kps[i2];
            if (kp1 && kp2 && kp1.confidence >= 0.35 && kp2.confidence >= 0.35 && kp1.x > 0 && kp2.x > 0 && kp1.y > 0 && kp2.y > 0) {
              ctx.beginPath();
              ctx.moveTo(kp1.x, kp1.y);
              ctx.lineTo(kp2.x, kp2.y);
              ctx.stroke();
            }
          }
        });
      }

      kps.forEach((kp) => {
        if (kp.confidence >= 0.35 && kp.x > 0 && kp.y > 0) {
          ctx.beginPath();
          ctx.arc(kp.x, kp.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(kp.x, kp.y, 4, 0, Math.PI * 2);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#06b6d4';
          ctx.stroke();
        }
      });
    });
  }

  private renderBoxes(ctx: CanvasRenderingContext2D, boxes: BoundingBox[]): void {
    if (!boxes || boxes.length === 0) {
      return;
    }

    boxes.forEach((box) => {
      const [x1, y1, x2, y2] = box.bbox;
      const w = Math.max(2, x2 - x1);
      const h = Math.max(2, y2 - y1);
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
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, w, h);

      ctx.fillStyle = fillColor;
      ctx.fillRect(x1, y1, w, h);

      const confPct = Math.round((box.confidence || 0.85) * 100);
      const labelText = `ID #${box.trackId} · ${box.label.toUpperCase()} · ${confPct}%`;

      ctx.font = '600 11px "IBM Plex Mono", monospace';
      const textMetrics = ctx.measureText(labelText);
      const badgeH = 20;
      const badgeW = Math.max(textMetrics.width + 14, 80);
      const badgeY = Math.max(0, y1 - badgeH);

      ctx.fillStyle = '#111110';
      ctx.fillRect(x1, badgeY, badgeW, badgeH);

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x1, badgeY, badgeW, badgeH);

      ctx.fillStyle = '#f0ede6';
      ctx.fillText(labelText, x1 + 6, badgeY + 14);
    });
  }
}
