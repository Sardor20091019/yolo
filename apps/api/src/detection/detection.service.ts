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

    const result = await new Promise<FrameProcessingResult>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          resolve(this.createFallbackResult(frameIndex));
        }
      }, 2500);

      this.pendingRequests.set(requestId, (res) => {
        clearTimeout(timeout);
        resolve(res);
      });

      if (this.pythonProcess && !this.pythonProcess.killed && this.pythonProcess.stdin.writable) {
        this.pythonProcess.stdin.write(JSON.stringify(payload) + '\n');
      } else {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        resolve(this.createFallbackResult(frameIndex));
      }
    });

    await this.evaluateSuspicionAndTriggerAlerts(result, frameData);
    return result;
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

