export function getBackendBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const override = localStorage.getItem('API_BASE_URL');
    if (override && override.trim()) {
      return override.trim().replace(/\/$/, '');
    }
    const isDev = window.location.port === '4200';
    if (isDev) {
      const host = window.location.hostname || 'localhost';
      return `http://${host}:3000`;
    }
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:3000';
    }
  }
  return 'https://yolo-zt3r.onrender.com';
}

export function getApiBaseUrl(): string {
  return `${getBackendBaseUrl()}/api`;
}

export function getSocketUrl(): string {
  return getBackendBaseUrl();
}
