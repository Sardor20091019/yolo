import { AppConfig } from './config.interface';

export default (): AppConfig => ({
  port: parseInt(process.env.PORT || '3000', 10),
  frontendPort: parseInt(process.env.FRONTEND_PORT || '4200', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:4200',
  wsPath: process.env.WS_PATH || '/socket.io',
  uploadsDir: process.env.UPLOADS_DIR || './uploads',
  snapshotsDir: process.env.SNAPSHOTS_DIR || './uploads/snapshots',
  database: {
    url: process.env.DATABASE_URL || '',
  },
  python: {
    binPath: process.env.PYTHON_BIN_PATH || 'python3',
    workerPath: process.env.PYTHON_WORKER_PATH || 'apps/python-worker/main.py',
    workerHost: process.env.PYTHON_WORKER_HOST || '127.0.0.1',
    workerPort: parseInt(process.env.PYTHON_WORKER_PORT || '5001', 10),
    workerUrl: process.env.PYTHON_WORKER_URL || '',
  },
  yolo: {
    detectionModel: process.env.YOLO_DETECTION_MODEL || 'yolo11n.pt',
    detectionFallbackModel: process.env.YOLO_DETECTION_FALLBACK_MODEL || 'yolo11n.pt',
    poseModel: process.env.YOLO_POSE_MODEL || 'yolo11n-pose.pt',
    poseFallbackModel: process.env.YOLO_POSE_FALLBACK_MODEL || 'yolo11n-pose.pt',
  },
  thresholds: {
    defaultConfidence: parseFloat(process.env.DEFAULT_CONFIDENCE_THRESHOLD || '0.35'),
    defaultSuspicionAlert: parseFloat(process.env.DEFAULT_SUSPICION_ALERT_THRESHOLD || '75'),
    defaultLoiteringTimeLimit: parseFloat(process.env.DEFAULT_LOITERING_TIME_LIMIT || '10'),
    defaultNervousCheckLimit: parseInt(process.env.DEFAULT_NERVOUS_CHECK_LIMIT || '3', 10),
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'astro_cctv_access_secret_key_prod_32chars!',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'astro_cctv_refresh_secret_key_prod_32chars!',
    accessExpiresInSeconds: parseInt(process.env.JWT_ACCESS_EXPIRES_IN_SECONDS || '900', 10),
    refreshExpiresInSeconds: parseInt(process.env.JWT_REFRESH_EXPIRES_IN_SECONDS || '604800', 10),
  },
});

