import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AlertRecord, NewAlertRecord, AlertUpdateRecord } from '../database/database.types';
import { sql } from 'kysely';

export interface AlertMetrics {
  total: number;
  newCount: number;
  confirmedCount: number;
  highRiskCount: number;
}

@Injectable()
export class AlertsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  public async findAll(limit: number = 50, offset: number = 0, status?: string): Promise<AlertRecord[]> {
    let query = this.databaseService.db
      .selectFrom('alerts')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    if (status) {
      query = query.where('status', '=', status as AlertRecord['status']);
    }

    return await query.execute();
  }

  public async findById(id: string): Promise<AlertRecord | undefined> {
    return await this.databaseService.db
      .selectFrom('alerts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  public async create(record: NewAlertRecord): Promise<AlertRecord> {
    return await this.databaseService.db
      .insertInto('alerts')
      .values(record)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async updateStatus(id: string, status: AlertRecord['status']): Promise<AlertRecord | undefined> {
    const updatePayload: AlertUpdateRecord = {
      status,
      updated_at: sql`CURRENT_TIMESTAMP` as unknown as Date,
    };

    return await this.databaseService.db
      .updateTable('alerts')
      .set(updatePayload)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  public async delete(id: string): Promise<boolean> {
    const result = await this.databaseService.db
      .deleteFrom('alerts')
      .where('id', '=', id)
      .executeTakeFirst();

    return Number(result.numDeletedRows) > 0;
  }

  public async getMetrics(): Promise<AlertMetrics> {
    const rawMetrics = await this.databaseService.db
      .selectFrom('alerts')
      .select([
        sql<number>`count(*)::int`.as('total'),
        sql<number>`count(case when status = 'NEW' then 1 end)::int`.as('new_count'),
        sql<number>`count(case when status = 'CONFIRMED' then 1 end)::int`.as('confirmed_count'),
        sql<number>`count(case when suspicion_score >= 75 then 1 end)::int`.as('high_risk_count'),
      ])
      .executeTakeFirst();

    return {
      total: Number(rawMetrics?.total || 0),
      newCount: Number(rawMetrics?.new_count || 0),
      confirmedCount: Number(rawMetrics?.confirmed_count || 0),
      highRiskCount: Number(rawMetrics?.high_risk_count || 0),
    };
  }
}
