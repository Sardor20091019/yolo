import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
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
      if (!base64Data || typeof base64Data !== 'string') {
        return '';
      }
      const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
        return '';
      }

      const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
      const isWebp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';

      if (!isJpeg && !isPng && !isWebp) {
        return '';
      }

      const extension = isPng ? 'png' : isWebp ? 'webp' : 'jpg';
      const safeTrackId = Math.abs(Math.floor(Number(trackId) || 0));
      const randomPart = crypto.randomUUID();
      const filename = `snap_${safeTrackId}_${randomPart}.${extension}`;
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

