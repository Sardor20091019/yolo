import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { Database } from './database.types';
import { initializeDatabaseSchema } from './database.schema';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger = new Logger(DatabaseService.name);
  private pool: Pool | null = null;
  private kyselyDb: Kysely<Database> | null = null;

  constructor(private readonly configService: ConfigService) {}

  public async onModuleInit(): Promise<void> {
    const databaseUrl = this.configService.get<string>('database.url', { infer: true }) || process.env.DATABASE_URL || '';
    if (!databaseUrl) {
      throw new Error('Database connection URL is missing in ConfigService.');
    }

    const requiresSsl = databaseUrl.includes('sslmode=require') || databaseUrl.includes('ssl=true');
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      ssl: requiresSsl
        ? { rejectUnauthorized: !databaseUrl.includes('rejectUnauthorized=false') }
        : undefined,
    });

    this.kyselyDb = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: this.pool,
      }),
    });

    try {
      await initializeDatabaseSchema(this.kyselyDb);
      this.logger.log('Database schema successfully initialized.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Database connection or schema init deferred: ${message}`);
    }
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.kyselyDb) {
      await this.kyselyDb.destroy();
      this.kyselyDb = null;
    }
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  public get db(): Kysely<Database> {
    if (!this.kyselyDb) {
      throw new Error('Database is not initialized.');
    }
    return this.kyselyDb;
  }
}

