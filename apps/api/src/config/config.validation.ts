export function validateConfig(config: Record<string, unknown>): Record<string, unknown> {
  const databaseUrl = config['DATABASE_URL'];
  if (!databaseUrl || typeof databaseUrl !== 'string' || databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL environment variable is required and must not be empty.');
  }

  const port = config['PORT'];
  if (port && isNaN(Number(port))) {
    throw new Error('PORT environment variable must be a valid number.');
  }

  return config;
}
