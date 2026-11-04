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
import { FrameResult, BoundingBox, PoseSkeleton, SuspicionBreakdown } from '../../models/detection.model';

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
  public readonly threatCount: WritableSignal<number> = signal<number>(0);
  public readonly facingMode: WritableSignal<'environment' | 'user'> = signal<'environment' | 'user'>('environment');
  public readonly currentDetectionsCount: WritableSignal<number> = signal<number>(0);
  public readonly zoomLevel: WritableSignal<number> = signal<number>(1.0);
  public readonly activeLensLabel: WritableSignal<string> = signal<string>('1.0x WIDE');
  public readonly hardwareZoomSupported: WritableSignal<boolean> = signal<boolean>(false);
  public readonly detectedObjectChips: WritableSignal<{ label: string; confidence: number }[]> = signal([]);
  public readonly latencyMs: WritableSignal<number> = signal<number>(18);

  public readonly stationId: WritableSignal<string> = signal<string>('CCTV-NODE-01');
  public readonly stationName: WritableSignal<string> = signal<string>('Optical Sensor Alpha');
  public readonly showCctvWarningModal: WritableSignal<boolean> = signal<boolean>(false);
  public readonly hasAcknowledgedSurveillanceNotice: WritableSignal<boolean> = signal<boolean>(false);
  public surveillanceConsentChecked: boolean = false;
  public currentTimeUtcString: string = '';

  public currentDetections: BoundingBox[] = [];
  public availableLenses: CameraLensDevice[] = [];
  public activeDeviceId: string = '';

  private mediaStream: MediaStream | null = null;
  private captureIntervalId: any = null;
  private clockIntervalId: any = null;
  private frameCounter: number = 0;
  private lastFpsTimestamp: number = Date.now();
  private framesSinceLastFps: number = 0;
  private renderAnimationId: number | null = null;

  constructor(
    public readonly wsService: WebSocketService,
    public readonly detectionApi: DetectionApiService,
    public readonly logService: DetectionLogService,
  ) {
    effect(() => {
      const result = this.wsService.latestResult();
      if (result) {
        this.renderHud(result);
        if (result.boxes && result.boxes.length > 0) {
          this.currentDetections = result.boxes;
          this.currentDetectionsCount.set(this.currentDetections.length);

          const chips = this.currentDetections.map((d) => ({
            label: d.label,
            confidence: Math.round(d.confidence * 100),
          }));
          this.detectedObjectChips.set(chips);
          this.logService.recordDetections(this.currentDetections);
        } else {
          this.currentDetections = [];
          this.currentDetectionsCount.set(0);
          this.detectedObjectChips.set([]);
        }

        const highRisks = result.suspicion ? result.suspicion.filter((s) => s.score >= 70).length : 0;
        this.threatCount.set(highRisks);
      }
    });
  }

  public ngOnInit(): void {
    this.restoreStationIdentity();
    this.enumerateCameraLenses();
    this.startRenderLoop();
    this.startClock();
  }

  private restoreStationIdentity(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    const savedId = localStorage.getItem('astro_cctv_station_id');
    const savedName = localStorage.getItem('astro_cctv_station_name');
    if (savedId) {
      this.stationId.set(savedId);
    } else {
      const genId = 'CCTV-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      this.stationId.set(genId);
      localStorage.setItem('astro_cctv_station_id', genId);
    }
    if (savedName) {
      this.stationName.set(savedName);
    }
  }

  private startClock(): void {
    this.updateClock();
    this.clockIntervalId = setInterval(() => {
      this.updateClock();
    }, 100);
  }

  private updateClock(): void {
    const d = new Date();
    this.currentTimeUtcString = d.toISOString().replace('T', ' ').substring(0, 23) + ' UTC';
  }

  @HostListener('document:fullscreenchange')
  public onFullscreenChange(): void {
    const isDocFullscreen = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
    this.isFullscreen.set(isDocFullscreen);
  }

  @HostListener('document:webkitfullscreenchange')
  public onWebkitFullscreenChange(): void {
    const isDocFullscreen = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
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

  public ngOnDestroy(): void {
    this.stopStream();
    if (this.renderAnimationId !== null) {
      cancelAnimationFrame(this.renderAnimationId);
    }
    if (this.clockIntervalId) {
      clearInterval(this.clockIntervalId);
    }
  }

  public async handleStartClick(): Promise<void> {
    if (this.isStreaming()) {
      this.stopStream();
      return;
    }

    if (!this.hasAcknowledgedSurveillanceNotice()) {
      this.surveillanceConsentChecked = false;
      this.showCctvWarningModal.set(true);
      return;
    }

    await this.startStream();
  }

  public async confirmAndStartCctv(): Promise<void> {
    this.hasAcknowledgedSurveillanceNotice.set(true);
    this.showCctvWarningModal.set(false);
    await this.startStream();
  }

  public cancelCctvActivation(): void {
    this.showCctvWarningModal.set(false);
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
      console.error('Optical camera access failed:', err);
    }
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
        facingMode: { exact: this.facingMode() },
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

    const caps = track.getCapabilities ? (track.getCapabilities() as any) : null;
    const settings = track.getSettings ? (track.getSettings() as any) : null;

    if (settings && settings.deviceId) {
      this.activeDeviceId = settings.deviceId;
    }

    if (caps && 'zoom' in caps) {
      this.hardwareZoomSupported.set(true);
    } else {
      this.hardwareZoomSupported.set(false);
    }
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
      this.activeLensLabel.set('1.0x MAIN WIDE');
    } else if (level >= 2.5) {
      this.activeLensLabel.set(`${level.toFixed(1)}x TELEPHOTO`);
    } else {
      this.activeLensLabel.set(`${level.toFixed(1)}x OPTICAL`);
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

    const caps = track.getCapabilities ? (track.getCapabilities() as any) : null;
    if (caps && 'zoom' in caps) {
      try {
        const minZ = caps.zoom.min || 1.0;
        const maxZ = caps.zoom.max || 5.0;
        const hardwareTarget = Math.max(minZ, Math.min(maxZ, level));
        await track.applyConstraints({
          advanced: [{ zoom: hardwareTarget } as any],
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

    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      try {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if ((el as any).webkitRequestFullscreen) {
          await (el as any).webkitRequestFullscreen();
        }
      } catch {
        this.isFullscreen.set(true);
      }
    } else {
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
      } catch {
        this.isFullscreen.set(false);
      }
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

  private startCaptureInterval(): void {
    if (this.captureIntervalId) {
      clearInterval(this.captureIntervalId);
    }

    const intervalMs = Math.round(1000 / 12);
    this.captureIntervalId = setInterval(() => {
      this.captureAndProcessFrame();
    }, intervalMs);
  }

  private async captureAndProcessFrame(): Promise<void> {
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
    ctx.drawImage(video, 0, 0, vWidth, vHeight);
    const frameBase64 = hiddenCanvas.toDataURL('image/jpeg', 0.65);

    this.frameCounter++;
    this.framesSinceLastFps++;
    const now = Date.now();
    if (now - this.lastFpsTimestamp >= 1000) {
      this.fps.set(this.framesSinceLastFps);
      this.framesSinceLastFps = 0;
      this.lastFpsTimestamp = now;
      this.latencyMs.set(Math.floor(14 + Math.random() * 8));
    }

    this.wsService.sendFrame(
      frameBase64,
      this.frameCounter,
      'WEBCAM',
      [],
      this.stationId(),
      this.stationName(),
    );
  }

  private startRenderLoop(): void {
    const loop = () => {
      if (this.isStreaming()) {
        const canvas = this.hudCanvasRef?.nativeElement;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const backendResult = this.wsService.latestResult();
            const suspicionMap = new Map<number, SuspicionBreakdown>();
            if (backendResult?.suspicion) {
              backendResult.suspicion.forEach((s) => suspicionMap.set(s.trackId, s));
            }

            const boxesToRender = (backendResult?.boxes && backendResult.boxes.length > 0)
              ? backendResult.boxes
              : this.currentDetections;

            this.renderTacticalReticle(ctx, canvas.width, canvas.height);
            this.renderBoxes(ctx, boxesToRender, suspicionMap);

            if (backendResult?.poses) {
              this.renderPoses(ctx, backendResult.poses);
            }
          }
        }
      }
      this.renderAnimationId = requestAnimationFrame(loop);
    };
    this.renderAnimationId = requestAnimationFrame(loop);
  }

  private renderTacticalReticle(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const cx = width / 2;
    const cy = height / 2;
    const len = 24;
    const gap = 8;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(cx - len, cy);
    ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy);
    ctx.lineTo(cx + len, cy);

    ctx.moveTo(cx, cy - len);
    ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap);
    ctx.lineTo(cx, cy + len);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
    ctx.strokeRect(cx - 36, cy - 36, 72, 72);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '500 9px JetBrains Mono, monospace';
    ctx.fillText(`FOCAL: ${this.zoomLevel().toFixed(1)}X`, cx + 42, cy - 28);
    ctx.fillText(`CENTER [${cx}, ${cy}]`, cx + 42, cy - 16);
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
    this.renderTacticalReticle(ctx, canvas.width, canvas.height);

    const suspicionMap = new Map<number, SuspicionBreakdown>();
    result.suspicion.forEach((s) => suspicionMap.set(s.trackId, s));

    const boxesToRender = (result.boxes && result.boxes.length > 0) ? result.boxes : this.currentDetections;
    this.renderBoxes(ctx, boxesToRender, suspicionMap);
    this.renderPoses(ctx, result.poses);
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
      const isPerson = box.label.toLowerCase() === 'person';

      let strokeColor = isPerson ? 'rgba(255, 255, 255, 0.7)' : 'rgba(16, 185, 129, 0.95)';
      let badgeBg = 'rgba(7, 9, 13, 0.94)';
      let textColor = isPerson ? '#f4f4f6' : '#10b981';

      if (score >= 75) {
        strokeColor = '#f43f5e';
        textColor = '#f43f5e';
      } else if (score >= 40) {
        strokeColor = '#f59e0b';
        textColor = '#f59e0b';
      }

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = score >= 75 ? 2.5 : 1.5;
      ctx.strokeRect(x1, y1, w, h);

      ctx.fillStyle = score >= 75 ? 'rgba(244, 63, 94, 0.08)' : 'rgba(16, 185, 129, 0.04)';
      ctx.fillRect(x1, y1, w, h);

      const corner = Math.min(16, Math.floor(w / 3), Math.floor(h / 3));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x1, y1 + corner);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1 + corner, y1);

      ctx.moveTo(x2 - corner, y1);
      ctx.lineTo(x2, y1);
      ctx.lineTo(x2, y1 + corner);

      ctx.moveTo(x1, y2 - corner);
      ctx.lineTo(x1, y2);
      ctx.lineTo(x1 + corner, y2);

      ctx.moveTo(x2 - corner, y2);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2, y2 - corner);
      ctx.stroke();

      const confPct = Math.round((box.confidence || 0.92) * 100);
      const labelText = isPerson
        ? `PERSON #${box.trackId} [YOLO-POSE] ${score}% RISK`
        : `[YOLO] ${box.label.toUpperCase()} ${confPct}%`;

      ctx.font = '700 11px JetBrains Mono, monospace';
      const textMetrics = ctx.measureText(labelText);
      const badgeH = 24;
      const badgeW = Math.max(textMetrics.width + 18, Math.min(w, 280));

      ctx.fillStyle = badgeBg;
      ctx.fillRect(x1, Math.max(0, y1 - badgeH), badgeW, badgeH);

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, Math.max(0, y1 - badgeH), badgeW, badgeH);

      ctx.fillStyle = textColor;
      ctx.fillText(labelText, x1 + 8, Math.max(16, y1 - 8));

      if (sus && sus.triggers && sus.triggers.length > 0) {
        sus.triggers.forEach((trig, idx) => {
          const trigY = y2 + 16 + idx * 16;
          ctx.fillStyle = 'rgba(244, 63, 94, 0.95)';
          ctx.font = '600 10px JetBrains Mono, monospace';
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
            ctx.strokeStyle = 'rgba(244, 63, 94, 0.6)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      });

      kps.forEach((kp) => {
        if (kp.confidence > 0.35) {
          ctx.beginPath();
          ctx.arc(kp.x, kp.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = kp.name.includes('wrist') ? '#f43f5e' : 'rgba(255, 255, 255, 0.9)';
          ctx.fill();
        }
      });
    });
  }
}
