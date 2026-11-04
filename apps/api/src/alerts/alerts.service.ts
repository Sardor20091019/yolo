import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { AlertsRepository, AlertMetrics } from './alerts.repository';
import { CreateAlertDto } from './dto/create-alert.dto';
import { AlertRecord, NewAlertRecord } from '../database/database.types';

@Injectable()
export class AlertsService {
  private readonly logger: Logger = new Logger(AlertsService.name);
  private readonly snapshotsDir: string;

  constructor(
    private readonly alertsRepository: AlertsRepository,
    private readonly configService: ConfigService,
  ) {
    const rawSnapshotsDir = this.configService.get<string>('snapshotsDir', './uploads/snapshots');
    this.snapshotsDir = path.isAbsolute(rawSnapshotsDir)
      ? rawSnapshotsDir
      : process.cwd().endsWith('apps/api')
        ? path.resolve(process.cwd(), '../..', rawSnapshotsDir)
        : path.resolve(process.cwd(), rawSnapshotsDir);
    this.ensureDirectoryExists(this.snapshotsDir);
  }

  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  public async saveSnapshotFromBase64(base64Data: string, trackId: number): Promise<string> {
    try {
      const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      const filename = `snapshot_${Date.now()}_track_${trackId}.jpg`;
      const filePath = path.join(this.snapshotsDir, filename);

      await fs.promises.writeFile(filePath, buffer);
      return `/uploads/snapshots/${filename}`;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to save alert snapshot: ${msg}`);
      return '';
    }
  }

  public async createAlert(dto: CreateAlertDto, snapshotBase64?: string): Promise<AlertRecord> {
    let snapshotUrl = dto.snapshot_url || '';

    if (snapshotBase64 && !snapshotUrl) {
      snapshotUrl = await this.saveSnapshotFromBase64(snapshotBase64, dto.track_id);
    }

    const payload: NewAlertRecord = {
      track_id: dto.track_id,
      type: dto.type,
      suspicion_score: dto.suspicion_score,
      snapshot_url: snapshotUrl,
      status: dto.status || 'NEW',
      details: dto.details || '{}',
    };

    const created = await this.alertsRepository.create(payload);
    this.logger.log(`New alert recorded: ${created.id} (Score: ${created.suspicion_score}%, Track: ${created.track_id})`);
    return created;
  }

  public async findAll(limit: number = 50, offset: number = 0, status?: string): Promise<AlertRecord[]> {
    return await this.alertsRepository.findAll(limit, offset, status);
  }

  public async findById(id: string): Promise<AlertRecord> {
    const alert = await this.alertsRepository.findById(id);
    if (!alert) {
      throw new NotFoundException(`Alert with ID ${id} not found`);
    }
    return alert;
  }

  public async updateStatus(id: string, status: AlertRecord['status']): Promise<AlertRecord> {
    const updated = await this.alertsRepository.updateStatus(id, status);
    if (!updated) {
      throw new NotFoundException(`Alert with ID ${id} not found`);
    }
    return updated;
  }

  public async deleteAlert(id: string): Promise<{ success: boolean; id: string }> {
    const deleted = await this.alertsRepository.delete(id);
    if (!deleted) {
      throw new NotFoundException(`Alert with ID ${id} not found`);
    }
    return { success: true, id };
  }

  public async getMetrics(): Promise<AlertMetrics> {
    return await this.alertsRepository.getMetrics();
  }
}

