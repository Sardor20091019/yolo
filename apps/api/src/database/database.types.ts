import { ColumnType, Generated, Selectable, Insertable, Updateable } from 'kysely';

export interface AlertsTable {
  id: Generated<string>;
  track_id: number;
  type: string;
  suspicion_score: number;
  snapshot_url: string;
  status: 'NEW' | 'REVIEWED' | 'DISMISSED' | 'CONFIRMED';
  details: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type AlertRecord = Selectable<AlertsTable>;
export type NewAlertRecord = Insertable<AlertsTable>;
export type AlertUpdateRecord = Updateable<AlertsTable>;

export interface DetectionZonesTable {
  id: Generated<string>;
  name: string;
  polygon_coordinates: string;
  dwell_time_threshold: number;
  is_active: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type DetectionZoneRecord = Selectable<DetectionZonesTable>;
export type NewDetectionZoneRecord = Insertable<DetectionZonesTable>;
export type DetectionZoneUpdateRecord = Updateable<DetectionZonesTable>;

export interface DetectionEventsTable {
  id: Generated<string>;
  track_id: number;
  frame_index: number;
  score: number;
  concealment_detected: boolean;
  nervous_checks_count: number;
  loitering_seconds: number;
  zone_id: string | null;
  created_at: Generated<Date>;
}

export type DetectionEventRecord = Selectable<DetectionEventsTable>;
export type NewDetectionEventRecord = Insertable<DetectionEventsTable>;

export interface DetectionLogsTable {
  id: Generated<string>;
  station_id: string;
  station_name: string;
  frame_index: number;
  track_id: number;
  label: string;
  confidence: number;
  bbox: string;
  suspicion_score: number;
  triggers: string;
  created_at: Generated<Date>;
}

export type DetectionLogRecord = Selectable<DetectionLogsTable>;
export type NewDetectionLogRecord = Insertable<DetectionLogsTable>;

export interface Database {
  alerts: AlertsTable;
  detection_zones: DetectionZonesTable;
  detection_events: DetectionEventsTable;
  detection_logs: DetectionLogsTable;
}
