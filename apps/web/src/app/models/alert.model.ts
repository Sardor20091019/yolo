export interface AlertIncident {
  id: string;
  track_id: number;
  type: string;
  suspicion_score: number;
  snapshot_url: string;
  status: 'NEW' | 'REVIEWED' | 'DISMISSED' | 'CONFIRMED';
  details: string;
  created_at: string;
  updated_at: string;
}

export interface AlertMetrics {
  total: number;
  newCount: number;
  confirmedCount: number;
  highRiskCount: number;
}
