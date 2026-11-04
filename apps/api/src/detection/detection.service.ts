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
import { DetectionZoneRecord, NewDetectionZoneRecord, DetectionZoneUpdateRecord, DetectionLogRecord, NewDetectionLogRecord } from '../database/database.types';

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

export interface CctvStationInfo {
  stationId: string;
  stationName: string;
  status: 'ONLINE' | 'STREAMING' | 'DISCONNECTED';
  lastSeen: number;
  fps: number;
  totalFrames: number;
  activeDetectionsCount: number;
  lastDetectedObjects: string[];
  lastFrameSnapshot?: string;
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
  private zoneDwellTrackers: Map<number, { entryTime: number; zoneName: string }> = new Map();
  private cctvStations: Map<string, CctvStationInfo> = new Map();

  public getAllCctvStations(): CctvStationInfo[] {
    const now = Date.now();
    const stations: CctvStationInfo[] = [];
    this.cctvStations.forEach((station) => {
      const isAlive = now - station.lastSeen < 20000;
      stations.push({
        ...station,
        status: isAlive ? (now - station.lastSeen < 4000 ? 'STREAMING' : 'ONLINE') : 'DISCONNECTED',
      });
    });
    return stations;
  }

  public registerOrUpdateStation(
    stationId: string,
    stationName?: string,
    frameSnapshot?: string,
    detectedObjects: string[] = [],
  ): void {
    const existing = this.cctvStations.get(stationId);
    const now = Date.now();
    if (existing) {
      existing.lastSeen = now;
      existing.totalFrames++;
      if (stationName) existing.stationName = stationName;
      if (frameSnapshot) existing.lastFrameSnapshot = frameSnapshot;
      existing.activeDetectionsCount = detectedObjects.length;
      existing.lastDetectedObjects = detectedObjects;
    } else {
      this.cctvStations.set(stationId, {
        stationId,
        stationName: stationName || `CCTV Node ${stationId}`,
        status: 'STREAMING',
        lastSeen: now,
        fps: 12,
        totalFrames: 1,
        activeDetectionsCount: detectedObjects.length,
        lastDetectedObjects: detectedObjects,
        lastFrameSnapshot: frameSnapshot,
      });
    }
  }

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

    const venvCandidates = [
      path.resolve(process.cwd(), '.venv/bin/python'),
      path.resolve(process.cwd(), '../.venv/bin/python'),
      path.resolve(process.cwd(), '../../.venv/bin/python'),
      path.resolve(__dirname, '../../../../.venv/bin/python'),
      path.resolve(__dirname, '../../../.venv/bin/python'),
    ];
    let pythonBin = this.configService.get<string>('python.binPath', 'python3');
    for (const venvPath of venvCandidates) {
      if (fs.existsSync(venvPath)) {
        pythonBin = venvPath;
        break;
      }
    }

    const configuredScript = this.configService.get<string>('python.workerPath', 'apps/python-worker/main.py');
    const workerScript = this.resolveWorkerScriptPath(configuredScript);
    const workerDir = path.dirname(workerScript);
    const detectionModel = this.configService.get<string>('yolo.detectionModel', 'yolo11n.pt');
    const poseModel = this.configService.get<string>('yolo.poseModel', 'yolo11n-pose.pt');

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
    clientDetectedBoxes?: BoundingBox[],
    stationId?: string,
    stationName?: string,
    userId?: string,
  ): Promise<FrameProcessingResult> {
    const activeZones = await this.detectionRepository.findActiveZones();
    const zones = activeZones.map((z) => ({
      id: z.id,
      name: z.name,
      polygon: JSON.parse(z.polygon_coordinates || '[]') as [number, number][],
      dwellLimit: z.dwell_time_threshold,
    }));

    const requestId = ++this.requestCounter;
    const payload = {
      requestId,
      frameIndex,
      frameData,
      source,
      stationId: stationId || 'CCTV-MAIN',
      stationName: stationName || 'CCTV Optical Sensor',
      userId,
      zones,
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
          this.registerOrUpdateStation(
            stationId || 'CCTV-MAIN',
            stationName,
            frameData,
            workerResult.boxes.map((b) => b.label),
          );
          await this.evaluateSuspicionAndTriggerAlerts(workerResult, frameData);
          await this.persistAnalyzedDetections(workerResult, stationId, stationName, userId);
          return workerResult;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to call bound python-worker service at ${workerUrl}: ${msg}`);
      }
    }

    if (this.pythonProcess && !this.pythonProcess.killed && this.pythonProcess.stdin.writable) {
      const result = await new Promise<FrameProcessingResult>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.pendingRequests.has(requestId)) {
            this.pendingRequests.delete(requestId);
            resolve(this.createFallbackResult(frameIndex));
          }
        }, 5000);

        this.pendingRequests.set(requestId, (res) => {
          clearTimeout(timeout);
          resolve(res);
        });

        this.pythonProcess?.stdin.write(JSON.stringify(payload) + '\n');
      });

      this.registerOrUpdateStation(
        stationId || 'CCTV-MAIN',
        stationName,
        frameData,
        result.boxes.map((b) => b.label),
      );
      await this.evaluateSuspicionAndTriggerAlerts(result, frameData);
      await this.persistAnalyzedDetections(result, stationId, stationName, userId);
      return result;
    }

    const fallback = this.createFallbackResult(frameIndex);
    this.registerOrUpdateStation(
      stationId || 'CCTV-MAIN',
      stationName,
      frameData,
      [],
    );
    return fallback;
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

  private evaluateRealDetections(
    frameIndex: number,
    boxes: BoundingBox[],
    zones: Array<{ id: string; name: string; polygon: [number, number][]; dwellLimit: number }>,
    calibration: Record<string, number | undefined>,
  ): FrameProcessingResult {
    const suspicion: SuspicionBreakdown[] = [];
    const alertThreshold = calibration['suspicionThreshold'] ?? 75;
    let anyAlert = false;

    for (const box of boxes) {
      const [x1, y1, x2, y2] = box.bbox;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;

      let matchedZone: { id: string; name: string; dwellLimit: number } | undefined;
      for (const z of zones) {
        if (this.pointInPolygon(cx, cy, z.polygon)) {
          matchedZone = z;
          break;
        }
      }

      let loiteringScore = 0;
      let loiteringSeconds = 0;
      const triggers: string[] = [];

      if (matchedZone) {
        const trackerKey = box.trackId;
        const now = Date.now();
        const tracker = this.zoneDwellTrackers.get(trackerKey);
        if (tracker && tracker.zoneName === matchedZone.name) {
          loiteringSeconds = Math.round((now - tracker.entryTime) / 1000);
        } else {
          this.zoneDwellTrackers.set(trackerKey, { entryTime: now, zoneName: matchedZone.name });
          loiteringSeconds = 1;
        }

        if (loiteringSeconds >= (matchedZone.dwellLimit || 10)) {
          loiteringScore = 40;
          triggers.push(`Zone loitering in ${matchedZone.name} (${loiteringSeconds}s)`);
        }
      }

      const totalScore = Math.min(100, loiteringScore);
      if (totalScore >= alertThreshold) {
        anyAlert = true;
      }

      suspicion.push({
        trackId: box.trackId,
        score: totalScore,
        concealmentScore: 0,
        nervousCheckScore: 0,
        loiteringScore,
        loiteringSeconds,
        nervousCount: 0,
        zoneName: matchedZone?.name,
        triggers,
      });
    }

    return {
      frameIndex,
      timestamp: Date.now(),
      boxes,
      poses: [],
      suspicion,
      alertTriggered: anyAlert,
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

  private async persistAnalyzedDetections(
    result: FrameProcessingResult,
    stationId?: string,
    stationName?: string,
    userId?: string,
  ): Promise<void> {
    if (!result.boxes || result.boxes.length === 0) {
      return;
    }
    const suspicionMap = new Map<number, SuspicionBreakdown>();
    if (result.suspicion) {
      result.suspicion.forEach((s) => suspicionMap.set(s.trackId, s));
    }
    const records: NewDetectionLogRecord[] = result.boxes.map((box) => {
      const sus = suspicionMap.get(box.trackId);
      return {
        user_id: userId || null,
        station_id: stationId || 'CCTV-MAIN',
        station_name: stationName || 'CCTV Optical Sensor',
        frame_index: result.frameIndex,
        track_id: box.trackId,
        label: box.label,
        confidence: box.confidence,
        bbox: JSON.stringify(box.bbox),
        suspicion_score: sus ? sus.score : 0,
        triggers: JSON.stringify(sus ? sus.triggers : []),
      };
    });
    try {
      await this.detectionRepository.createDetectionLogsBatch(records);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to persist detection logs: ${msg}`);
    }
  }

  public async getDetectionLogs(limit: number = 100, userId?: string): Promise<DetectionLogRecord[]> {
    return await this.detectionRepository.getRecentDetectionLogs(limit, userId);
  }

  public async saveDetectionLogsBatch(logs: NewDetectionLogRecord[]): Promise<DetectionLogRecord[]> {
    return await this.detectionRepository.createDetectionLogsBatch(logs);
  }

  public async deleteDetectionLogs(userId?: string): Promise<boolean> {
    return await this.detectionRepository.deleteDetectionLogs(userId);
  }
}

