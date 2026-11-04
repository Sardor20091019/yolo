import { Kysely, sql } from 'kysely';
import { Database } from './database.types';

export async function initializeDatabaseSchema(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('users')
    .ifNotExists()
    .addColumn('id', 'varchar(128)', (col) => col.primaryKey())
    .addColumn('email', 'varchar(255)')
    .addColumn('name', 'varchar(128)', (col) => col.notNull())
    .addColumn('picture', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('role', 'varchar(32)', (col) => col.notNull().defaultTo('OPERATOR'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createTable('alerts')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('track_id', 'integer', (col) => col.notNull())
    .addColumn('type', 'varchar(64)', (col) => col.notNull())
    .addColumn('suspicion_score', 'real', (col) => col.notNull())
    .addColumn('snapshot_url', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('status', 'varchar(32)', (col) => col.notNull().defaultTo('NEW'))
    .addColumn('details', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createTable('detection_zones')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'varchar(128)', (col) => col.notNull())
    .addColumn('polygon_coordinates', 'text', (col) => col.notNull())
    .addColumn('dwell_time_threshold', 'real', (col) => col.notNull().defaultTo(10.0))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createTable('detection_events')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('track_id', 'integer', (col) => col.notNull())
    .addColumn('frame_index', 'integer', (col) => col.notNull())
    .addColumn('score', 'real', (col) => col.notNull())
    .addColumn('concealment_detected', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('nervous_checks_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('loitering_seconds', 'real', (col) => col.notNull().defaultTo(0))
    .addColumn('zone_id', 'uuid')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createTable('detection_logs')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'varchar(128)')
    .addColumn('station_id', 'varchar(64)', (col) => col.notNull().defaultTo('CCTV-NODE-01'))
    .addColumn('station_name', 'varchar(128)', (col) => col.notNull().defaultTo('Optical Sensor Alpha'))
    .addColumn('frame_index', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('track_id', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('label', 'varchar(64)', (col) => col.notNull())
    .addColumn('confidence', 'real', (col) => col.notNull().defaultTo(0))
    .addColumn('bbox', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('suspicion_score', 'real', (col) => col.notNull().defaultTo(0))
    .addColumn('triggers', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  try {
    await db.schema
      .alterTable('detection_logs')
      .addColumn('user_id', 'varchar(128)')
      .execute();
  } catch {}
}
