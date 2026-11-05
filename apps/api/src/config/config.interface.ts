export interface AppConfig {
  port: number;
  frontendPort: number;
  nodeEnv: string;
  corsOrigin: string;
  wsPath: string;
  uploadsDir: string;
  snapshotsDir: string;
  database: {
    url: string;
  };
  python: {
    binPath: string;
    workerPath: string;
    workerHost: string;
    workerPort: number;
    workerUrl: string;
  };
  yolo: {
    detectionModel: string;
    detectionFallbackModel: string;
    poseModel: string;
    poseFallbackModel: string;
  };
  thresholds: {
    defaultConfidence: number;
    defaultSuspicionAlert: number;
    defaultLoiteringTimeLimit: number;
    defaultNervousCheckLimit: number;
  };
  google: {
    clientId: string;
    clientSecret: string;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresInSeconds: number;
    refreshExpiresInSeconds: number;
  };
}

