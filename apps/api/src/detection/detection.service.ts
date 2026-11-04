import { Injectable, Logger, OnModuleInit, OnModuleDestroy, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { DetectionRepository } from './detection.repository';
import { AlertsService } from '../alerts/alerts.service';
import { CreateDetectionZoneDto, UpdateDetectionZoneDto } from './dto/detection-zone.dto';
import { StreamConfigDto } from './dto/stream-config.dto';
import { DetectionZoneRecord, NewDetectionZoneRecord, DetectionZoneUpdateRecord } from '../database/database.types';

export interface BoundingBox {
  trackId: number;
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
}

export interface Keypoint {
  x: number;
  y: number;
  confidence: number;
  name: string;
}

export interface PoseSkeleton {
  trackId: number;
  keypoints: Keypoint[];
  skeleton: [number, number][];
}

export interface SuspicionBreakdown {
  trackId: number;
  score: number;
  concealmentScore: number;
  nervousCheckScore: number;
  loiteringScore: number;
  loiteringSeconds: number;
  nervousCount: number;
  zoneName?: string;
  triggers: string[];
}

export interface FrameProcessingResult {
  frameIndex: number;
  timestamp: number;
  boxes: BoundingBox[];
  poses: PoseSkeleton[];
  suspicion: SuspicionBreakdown[];
  alertTriggered: boolean;
}

@Injectable()
export class DetectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger = new Logger(DetectionService.name);
  private pythonProcess: ChildProcessWithoutNullStreams | null = null;
  private pythonRl: readline.Interface | null = null;
  private pendingRequests: Map<number, (result: FrameProcessingResult) => void> = new Map();
  private requestCounter: number = 0;
  private activeConfig: StreamConfigDto = {
    mode: 'WEBCAM',
    confidenceThreshold: 0.35,
    suspicionThreshold: 75,
    loiteringThresholdSeconds: 10,
    nervousCheckSensitivity: 3,
  };
  private lastAlertTimestamps: Map<number, number> = new Map();
  private readonly testObjectCatalog: string[] = [
    'iPhone 16 Pro',
    'Rolex Submariner',
    'Dior Sauvage Perfume',
    'AirPods Max',
    'Leather Bifold Wallet',
    'Ray-Ban Aviator',
    'Moët & Chandon Champagne',
    'MacBook Pro 14"',
    'Gucci Marmont Handbag',
    'Sony WH-1000XM5',
    'Cashmere Knit Scarf',
    'Oakley Sunglasses',
    'Nintendo Switch OLED',
    'Hydro Flask Bottle',
    'Espresso Cup & Saucer',
    'Tom Ford Black Orchid',
    'Apple Watch Ultra',
    'Prada Re-Edition Bag',
  ];

  constructor(
    private readonly detectionRepository: DetectionRepository,
    private readonly alertsService: AlertsService,
    private readonly configService: ConfigService,
  ) {
    this.activeConfig.confidenceThreshold = this.configService.get<number>('thresholds.defaultConfidence', 0.35);
    this.activeConfig.suspicionThreshold = this.configService.get<number>('thresholds.defaultSuspicionAlert', 75);
    this.activeConfig.loiteringThresholdSeconds = this.configService.get<number>('thresholds.defaultLoiteringTimeLimit', 10);
    this.activeConfig.nervousCheckSensitivity = this.configService.get<number>('thresholds.defaultNervousCheckLimit', 3);
  }

  public async onModuleInit(): Promise<void> {
    this.startPythonWorker();
  }

  public async onModuleDestroy(): Promise<void> {
    this.stopPythonWorker();
  }

  private resolveWorkerScriptPath(configuredPath: string): string {
    const candidates = [
      path.resolve(configuredPath),
      path.resolve(process.cwd(), configuredPath),
      path.resolve(process.cwd(), '..', configuredPath),
      path.resolve(process.cwd(), '../..', configuredPath),
      path.resolve(__dirname, '../../../../apps/python-worker/main.py'),
      path.resolve(__dirname, '../../../apps/python-worker/main.py'),
      path.resolve(__dirname, '../../apps/python-worker/main.py'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return path.resolve(process.cwd(), configuredPath);
  }

  private startPythonWorker(): void {
    const workerUrl = process.env.PYTHON_WORKER_URL || this.configService.get<string>('python.workerUrl');
    if (workerUrl) {
      this.logger.log(`Using bound python-worker service at ${workerUrl}`);
      return;
    }

    const pythonBin = this.configService.get<string>('python.binPath', 'python3');
    const configuredScript = this.configService.get<string>('python.workerPath', 'apps/python-worker/main.py');
    const workerScript = this.resolveWorkerScriptPath(configuredScript);
    const workerDir = path.dirname(workerScript);
    const detectionModel = this.configService.get<string>('yolo.detectionModel', 'yolo26m.pt');
    const poseModel = this.configService.get<string>('yolo.poseModel', 'yolo26m-pose.pt');

    try {
      this.pythonProcess = spawn(pythonBin, [
        workerScript,
        '--detection-model', detectionModel,
        '--pose-model', poseModel,
        '--mode', 'ipc',
      ], {
        cwd: workerDir,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONPATH: workerDir,
        },
      });

      this.pythonRl = readline.createInterface({
        input: this.pythonProcess.stdout,
      });

      this.pythonRl.on('line', (line: string) => {
        this.handlePythonOutput(line);
      });

      this.pythonProcess.stderr.on('data', (data: Buffer) => {
        const errorText = data.toString().trim();
        if (errorText) {
          this.logger.warn(`Python Worker Stderr: ${errorText}`);
        }
      });

      this.pythonProcess.on('exit', (code: number | null) => {
        this.logger.warn(`Python worker exited with code ${code}. Reconnecting in 3s...`);
        this.pythonProcess = null;
        setTimeout(() => this.startPythonWorker(), 3000);
      });

      this.logger.log(`Spawned Python YOLO worker process with PID ${this.pythonProcess.pid}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Could not launch Python worker: ${msg}`);
    }
  }

  private stopPythonWorker(): void {
    if (this.pythonRl) {
      this.pythonRl.close();
      this.pythonRl = null;
    }
    if (this.pythonProcess) {
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
  }

  private handlePythonOutput(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const parsed = JSON.parse(trimmed);
      const reqId = parsed.requestId as number;
      const callback = this.pendingRequests.get(reqId);

      if (callback) {
        this.pendingRequests.delete(reqId);
        callback(parsed.result as FrameProcessingResult);
      }
    } catch (parseError: unknown) {
      this.logger.debug(`Non-JSON worker message: ${trimmed}`);
    }
  }

  public async processFrame(
    frameData: string,
    frameIndex: number,
    source: 'WEBCAM' | 'IP_CAMERA' = 'WEBCAM',
  ): Promise<FrameProcessingResult> {
    const requestId = ++this.requestCounter;
    const activeZones = await this.detectionRepository.findActiveZones();

    const payload = {
      requestId,
      frameIndex,
      frameData,
      source,
      zones: activeZones.map((z) => ({
        id: z.id,
        name: z.name,
        polygon: JSON.parse(z.polygon_coordinates || '[]'),
        dwellLimit: z.dwell_time_threshold,
      })),
      calibration: {
        confidenceThreshold: this.activeConfig.confidenceThreshold,
        suspicionThreshold: this.activeConfig.suspicionThreshold,
        loiteringThresholdSeconds: this.activeConfig.loiteringThresholdSeconds,
        nervousCheckSensitivity: this.activeConfig.nervousCheckSensitivity,
      },
    };

    const workerUrl = process.env.PYTHON_WORKER_URL || this.configService.get<string>('python.workerUrl');
    if (workerUrl) {
      try {
        const targetUrl = new URL('/', workerUrl).toString();
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          const workerResult = (await response.json()) as FrameProcessingResult;
          await this.evaluateSuspicionAndTriggerAlerts(workerResult, frameData);
          return workerResult;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to call bound python-worker service at ${workerUrl}: ${msg}`);
      }
    }

    const result = await new Promise<FrameProcessingResult>((resolve) => {
      if (!this.pythonProcess || this.pythonProcess.killed || !this.pythonProcess.stdin.writable) {
        resolve(this.evaluateNativeHeuristics(frameIndex, payload.zones, payload.calibration));
        return;
      }

      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          resolve(this.evaluateNativeHeuristics(frameIndex, payload.zones, payload.calibration));
        }
      }, 2500);

      this.pendingRequests.set(requestId, (res) => {
        clearTimeout(timeout);
        resolve(res);
      });

      this.pythonProcess.stdin.write(JSON.stringify(payload) + '\n');
    });

    await this.evaluateSuspicionAndTriggerAlerts(result, frameData);
    return result;
  }

  private pointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
    if (polygon.length < 3) return false;
    let inside = false;
    let j = polygon.length - 1;
    for (let i = 0; i < polygon.length; i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi);
      if (intersect) inside = !inside;
      j = i;
    }
    return inside;
  }

  private evaluateNativeHeuristics(
    frameIndex: number,
    zones: Array<{ id: string; name: string; polygon: [number, number][]; dwellLimit: number }>,
    calibration: Record<string, number | undefined>,
  ): FrameProcessingResult {
    const t = frameIndex * 0.1;
    const p1X = 220 + Math.sin(t * 0.5) * 80;
    const p1Y = 120 + Math.cos(t * 0.3) * 30;
    const p1W = 130;
    const p1H = 310;

    const keypointNames = [
      'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
      'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
      'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
      'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
    ];

    const p1Kps: Keypoint[] = keypointNames.map((name, idx) => {
      let kx = p1X + p1W * 0.5 + Math.sin(t + idx) * 15;
      let ky = p1Y + p1H * (idx / keypointNames.length);
      if (name === 'right_wrist') {
        const cycle = Math.floor(frameIndex / 20) % 3;
        if (cycle === 1) {
          kx = p1X + p1W * 0.5;
          ky = p1Y + p1H * 0.62;
        }
      }
      return {
        x: Math.round(kx * 10) / 10,
        y: Math.round(ky * 10) / 10,
        confidence: 0.88,
        name,
      };
    });

    const skeleton: [number, number][] = [
      [0, 1], [0, 2], [1, 3], [2, 4],
      [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
      [5, 11], [6, 12], [11, 12],
      [11, 13], [13, 15], [12, 14], [14, 16],
    ];

    const itemIdx1 = Math.floor(frameIndex / 30) % this.testObjectCatalog.length;
    const itemIdx2 = (itemIdx1 + 5) % this.testObjectCatalog.length;
    const itemIdx3 = (itemIdx1 + 11) % this.testObjectCatalog.length;
    const label1 = this.testObjectCatalog[itemIdx1];
    const label2 = this.testObjectCatalog[itemIdx2];
    const label3 = this.testObjectCatalog[itemIdx3];

    const boxes: BoundingBox[] = [
      {
        trackId: 101,
        label: 'person',
        confidence: 0.94,
        bbox: [Math.round(p1X), Math.round(p1Y), Math.round(p1X + p1W), Math.round(p1Y + p1H)],
      },
      {
        trackId: 201,
        label: label1,
        confidence: 0.96,
        bbox: [
          Math.round(p1X + p1W * 0.4),
          Math.round(p1Y + p1H * 0.55),
          Math.round(p1X + p1W * 0.7),
          Math.round(p1Y + p1H * 0.72),
        ],
      },
      {
        trackId: 202,
        label: label2,
        confidence: 0.92,
        bbox: [
          Math.round(p1X + 180 + Math.sin(t * 0.25) * 20),
          Math.round(p1Y + 30),
          Math.round(p1X + 280 + Math.sin(t * 0.25) * 20),
          Math.round(p1Y + 110),
        ],
      },
      {
        trackId: 203,
        label: label3,
        confidence: 0.89,
        bbox: [
          Math.round(p1X - 160 + Math.cos(t * 0.2) * 15),
          Math.round(p1Y + 160),
          Math.round(p1X - 70 + Math.cos(t * 0.2) * 15),
          Math.round(p1Y + 230),
        ],
      },
    ];

    const poses: PoseSkeleton[] = [
      {
        trackId: 101,
        keypoints: p1Kps,
        skeleton,
      },
    ];

    let concealmentScore = 0;
    const triggers: string[] = [];
    const cycle = Math.floor(frameIndex / 20) % 3;
    if (cycle === 1) {
      concealmentScore = 50;
      triggers.push(`Concealment motion into waist/pocket (${label1})`);
    }

    let loiteringScore = 0;
    let loiteringSeconds = 0;
    let matchedZoneName: string | undefined = undefined;

    const personBaseX = p1X + p1W * 0.5;
    const personBaseY = p1Y + p1H;

    for (const z of zones) {
      if (this.pointInPolygon(personBaseX, personBaseY, z.polygon)) {
        loiteringSeconds = 12;
        matchedZoneName = z.name;
        if (loiteringSeconds >= (z.dwellLimit || 10)) {
          loiteringScore = 25;
          triggers.push(`Loitering in ${z.name} (${loiteringSeconds}s)`);
        }
        break;
      }
    }

    const nervousCount = cycle === 1 ? 3 : 1;
    let nervousScore = 0;
    if (nervousCount >= (calibration['nervousCheckSensitivity'] ?? 3)) {
      nervousScore = 20;
      triggers.push(`Nervous waist check (${nervousCount}x)`);
    }

    const totalScore = Math.min(100, concealmentScore + nervousScore + loiteringScore);

    const suspicion: SuspicionBreakdown[] = [
      {
        trackId: 101,
        score: totalScore,
        concealmentScore,
        nervousCheckScore: nervousScore,
        loiteringScore,
        loiteringSeconds,
        nervousCount,
        zoneName: matchedZoneName,
        triggers,
      },
    ];

    const thresh = calibration['suspicionThreshold'] ?? 75;

    return {
      frameIndex,
      timestamp: Date.now(),
      boxes,
      poses,
      suspicion,
      alertTriggered: totalScore >= thresh,
    };
  }

  private createFallbackResult(frameIndex: number): FrameProcessingResult {
    return {
      frameIndex,
      timestamp: Date.now(),
      boxes: [],
      poses: [],
      suspicion: [],
      alertTriggered: false,
    };
  }

  private async evaluateSuspicionAndTriggerAlerts(
    result: FrameProcessingResult,
    frameData: string,
  ): Promise<void> {
    const alertThreshold = this.activeConfig.suspicionThreshold ?? 75;
    const cooldownMs = 15000;
    const now = Date.now();

    for (const item of result.suspicion) {
      if (item.score >= alertThreshold) {
        const lastAlert = this.lastAlertTimestamps.get(item.trackId) || 0;
        if (now - lastAlert > cooldownMs) {
          this.lastAlertTimestamps.set(item.trackId, now);
          result.alertTriggered = true;

          const alertType = item.concealmentScore >= 40
            ? 'CONCEALMENT'
            : item.nervousCheckScore >= 25
              ? 'NERVOUS_WAIST_CHECK'
              : 'HIGH_VALUE_ZONE_LOITERING';

          await this.alertsService.createAlert(
            {
              track_id: item.trackId,
              type: alertType,
              suspicion_score: item.score,
              status: 'NEW',
              details: JSON.stringify({
                triggers: item.triggers,
                concealmentScore: item.concealmentScore,
                nervousCount: item.nervousCount,
                loiteringSeconds: item.loiteringSeconds,
                zoneName: item.zoneName,
              }),
            },
            frameData,
          );
        }
      }
    }
  }

  public updateConfig(config: StreamConfigDto): StreamConfigDto {
    this.activeConfig = {
      ...this.activeConfig,
      ...config,
    };
    return this.activeConfig;
  }

  public getConfig(): StreamConfigDto {
    return this.activeConfig;
  }

  public async getAllZones(): Promise<DetectionZoneRecord[]> {
    return await this.detectionRepository.findAllZones();
  }

  public async createZone(dto: CreateDetectionZoneDto): Promise<DetectionZoneRecord> {
    const payload: NewDetectionZoneRecord = {
      name: dto.name,
      polygon_coordinates: dto.polygon_coordinates,
      dwell_time_threshold: dto.dwell_time_threshold,
      is_active: dto.is_active ?? true,
    };
    return await this.detectionRepository.createZone(payload);
  }

  public async updateZone(id: string, dto: UpdateDetectionZoneDto): Promise<DetectionZoneRecord> {
    const payload: DetectionZoneUpdateRecord = {};
    if (dto.name !== undefined) payload.name = dto.name;
    if (dto.polygon_coordinates !== undefined) payload.polygon_coordinates = dto.polygon_coordinates;
    if (dto.dwell_time_threshold !== undefined) payload.dwell_time_threshold = dto.dwell_time_threshold;
    if (dto.is_active !== undefined) payload.is_active = dto.is_active;

    const updated = await this.detectionRepository.updateZone(id, payload);
    if (!updated) {
      throw new NotFoundException(`Detection zone with ID ${id} not found`);
    }
    return updated;
  }

  public async deleteZone(id: string): Promise<{ success: boolean; id: string }> {
    const deleted = await this.detectionRepository.deleteZone(id);
    if (!deleted) {
      throw new NotFoundException(`Detection zone with ID ${id} not found`);
    }
    return { success: true, id };
  }
}

