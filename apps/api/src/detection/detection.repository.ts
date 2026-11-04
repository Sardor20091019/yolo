import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  DetectionZoneRecord,
  NewDetectionZoneRecord,
  DetectionZoneUpdateRecord,
  DetectionEventRecord,
  NewDetectionEventRecord,
  DetectionLogRecord,
  NewDetectionLogRecord,
} from '../database/database.types';
import { sql } from 'kysely';

@Injectable()
export class DetectionRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  public async findAllZones(): Promise<DetectionZoneRecord[]> {
    return await this.databaseService.db
      .selectFrom('detection_zones')
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute();
  }

  public async findActiveZones(): Promise<DetectionZoneRecord[]> {
    return await this.databaseService.db
      .selectFrom('detection_zones')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('created_at', 'asc')
      .execute();
  }

  public async findZoneById(id: string): Promise<DetectionZoneRecord | undefined> {
    return await this.databaseService.db
      .selectFrom('detection_zones')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  public async createZone(record: NewDetectionZoneRecord): Promise<DetectionZoneRecord> {
    return await this.databaseService.db
      .insertInto('detection_zones')
      .values(record)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async updateZone(id: string, updates: DetectionZoneUpdateRecord): Promise<DetectionZoneRecord | undefined> {
    const payload: DetectionZoneUpdateRecord = {
      ...updates,
      updated_at: sql`CURRENT_TIMESTAMP` as unknown as Date,
    };

    return await this.databaseService.db
      .updateTable('detection_zones')
      .set(payload)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  public async deleteZone(id: string): Promise<boolean> {
    const result = await this.databaseService.db
      .deleteFrom('detection_zones')
      .where('id', '=', id)
      .executeTakeFirst();

    return Number(result.numDeletedRows) > 0;
  }

  public async recordEvent(event: NewDetectionEventRecord): Promise<DetectionEventRecord> {
    return await this.databaseService.db
      .insertInto('detection_events')
      .values(event)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async getRecentEvents(limit: number = 100): Promise<DetectionEventRecord[]> {
    return await this.databaseService.db
      .selectFrom('detection_events')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  }

  public async createDetectionLog(record: NewDetectionLogRecord): Promise<DetectionLogRecord> {
    return await this.databaseService.db
      .insertInto('detection_logs')
      .values(record)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async createDetectionLogsBatch(records: NewDetectionLogRecord[]): Promise<DetectionLogRecord[]> {
    if (!records || records.length === 0) {
      return [];
    }
    return await this.databaseService.db
      .insertInto('detection_logs')
      .values(records)
      .returningAll()
      .execute();
  }

  public async getRecentDetectionLogs(limit: number = 100, userId?: string): Promise<DetectionLogRecord[]> {
    let query = this.databaseService.db
      .selectFrom('detection_logs')
      .selectAll();

    if (userId) {
      query = query.where('user_id', '=', userId);
    }

    return await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  }

  public async deleteDetectionLogs(userId?: string): Promise<boolean> {
    let query = this.databaseService.db
      .deleteFrom('detection_logs');

    if (userId) {
      query = query.where('user_id', '=', userId);
    }

    const res = await query.executeTakeFirst();
    return Number(res.numDeletedRows) > 0;
  }
}
