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
  zoneName?: string | null;
  triggers: string[];
  waistBbox?: [number, number, number, number];
}

export interface FrameResult {
  frameIndex: number;
  timestamp: number;
  boxes: BoundingBox[];
  poses: PoseSkeleton[];
  suspicion: SuspicionBreakdown[];
  alertTriggered: boolean;
  annotatedFrame?: string;
  isYoloActive?: boolean;
  engineError?: string;
  stationId?: string;
  stationName?: string;
}

export interface CctvStationRecord {
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

export interface DetectionZone {
  id?: string;
  name: string;
  polygon_coordinates: string;
  dwell_time_threshold: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface StreamConfig {
  mode: 'WEBCAM' | 'IP_CAMERA';
  streamUrl?: string;
  confidenceThreshold?: number;
  suspicionThreshold?: number;
  loiteringThresholdSeconds?: number;
  nervousCheckSensitivity?: number;
}
