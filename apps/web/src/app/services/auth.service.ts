import { Injectable, signal, computed, WritableSignal, Signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of } from 'rxjs';
import { getApiBaseUrl } from './api-config';

export interface UserSession {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly STORAGE_KEY: string = 'astro_cctv_auth_session';
  private readonly ACCESS_TOKEN_KEY: string = 'astro_cctv_access_token';
  private readonly REFRESH_TOKEN_KEY: string = 'astro_cctv_refresh_token';
  private readonly apiBaseUrl: string;

  public readonly currentUser: WritableSignal<UserSession | null> = signal<UserSession | null>(null);
  public readonly accessToken: WritableSignal<string | null> = signal<string | null>(null);
  public readonly refreshToken: WritableSignal<string | null> = signal<string | null>(null);
  public readonly googleClientId: WritableSignal<string> = signal<string>(
    '1002685554488-10r19m3kgt1o89ocoup8id1bjo1a2o6v.apps.googleusercontent.com',
  );
  public readonly isAuthModalOpen: WritableSignal<boolean> = signal<boolean>(false);
  public readonly isAuthenticating: WritableSignal<boolean> = signal<boolean>(false);
  public readonly authErrorMessage: WritableSignal<string> = signal<string>('');

  public readonly isAuthenticated: Signal<boolean> = computed(() => {
    return this.currentUser() !== null;
  });

  public readonly isAdmin: Signal<boolean> = computed(() => {
    return this.currentUser() !== null;
  });

  constructor(private readonly http: HttpClient) {
    this.apiBaseUrl = getApiBaseUrl();

    this.restoreSession();
    this.checkForOAuthRedirectToken();
    this.fetchGoogleConfig();
  }

  private restoreSession(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const user: UserSession = JSON.parse(stored);
        this.currentUser.set(user);
      }
      const aToken = localStorage.getItem(this.ACCESS_TOKEN_KEY);
      if (aToken) {
        this.accessToken.set(aToken);
      }
      const rToken = localStorage.getItem(this.REFRESH_TOKEN_KEY);
      if (rToken) {
        this.refreshToken.set(rToken);
      }
    } catch {
      this.currentUser.set(null);
      this.accessToken.set(null);
      this.refreshToken.set(null);
    }
  }

  private checkForOAuthRedirectToken(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const hash = window.location.hash;
    const search = window.location.search;
    let token: string | null = null;

    if (hash && hash.length > 1) {
      const params = new URLSearchParams(hash.substring(1));
      token = params.get('id_token') || params.get('access_token');
    }

    if (!token && search && search.length > 1) {
      const qParams = new URLSearchParams(search.substring(1));
      token = qParams.get('id_token') || qParams.get('access_token') || qParams.get('token');
    }

    if (token) {
      window.history.replaceState(null, '', window.location.pathname);
      this.isAuthenticating.set(true);

      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const raw = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
          const payload = JSON.parse(raw);
          if (payload && (payload.email || payload.sub)) {
            const immediateUser: UserSession = {
              id: payload.sub || `google_${Date.now()}`,
              email: payload.email || 'operator@cctv.local',
              name: payload.name || payload.email || 'Admin Operator',
              picture: payload.picture || '',
              role: 'OPERATOR',
            };
            this.setUserSession(immediateUser, token, token);
          }
        }
      } catch {}

      this.verifyGoogleCredentialOnBackend(token).subscribe({
        next: (res) => {
          this.isAuthenticating.set(false);
          this.authErrorMessage.set('');
          if (res && res.user) {
            this.setUserSession(
              res.user,
              res.accessToken || res.token || token,
              res.refreshToken || '',
            );
          }
        },
        error: () => {
          this.isAuthenticating.set(false);
          if (!this.currentUser()) {
            this.authErrorMessage.set('Google authentication failed.');
          }
        },
      });
    }
  }

  public fetchGoogleConfig(): void {
    this.http.get<{ googleClientId: string }>(`${this.apiBaseUrl}/auth/config`).subscribe({
      next: (res) => {
        if (res && res.googleClientId) {
          this.googleClientId.set(res.googleClientId);
        }
      },
      error: () => {
        const fallback = '1002685554488-10r19m3kgt1o89ocoup8id1bjo1a2o6v.apps.googleusercontent.com';
        this.googleClientId.set(fallback);
      },
    });
  }

  public redirectToGoogleOAuth(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const clientId = this.googleClientId();
    const redirectUri = window.location.origin;
    const scope = encodeURIComponent('email profile openid');
    const nonce = Math.random().toString(36).substring(2);
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token%20id_token&scope=${scope}&nonce=${nonce}`;
    window.location.href = authUrl;
  }

  public loginViaGoogle(): void {
    this.redirectToGoogleOAuth();
  }

  public verifyGoogleCredentialOnBackend(
    credential: string,
  ): Observable<{ user: UserSession; accessToken?: string; refreshToken?: string; token?: string }> {
    return this.http
      .post<{ user: UserSession; accessToken?: string; refreshToken?: string; token?: string }>(
        `${this.apiBaseUrl}/auth/google`,
        { credential },
      )
      .pipe(
        tap((res) => {
          if (res && res.user) {
            this.setUserSession(
              res.user,
              res.accessToken || res.token || '',
              res.refreshToken || '',
            );
            this.isAuthModalOpen.set(false);
          }
        }),
      );
  }

  public refreshAccessToken(): Observable<boolean> {
    const rToken = this.refreshToken();
    if (!rToken) {
      this.signOut();
      return of(false);
    }

    return new Observable<boolean>((observer) => {
      this.http
        .post<{ user: UserSession; accessToken: string; refreshToken: string }>(
          `${this.apiBaseUrl}/auth/refresh`,
          { refreshToken: rToken },
        )
        .subscribe({
          next: (res) => {
            if (res && res.accessToken) {
              this.setUserSession(res.user, res.accessToken, res.refreshToken);
              observer.next(true);
              observer.complete();
            } else {
              this.signOut();
              observer.next(false);
              observer.complete();
            }
          },
          error: () => {
            this.signOut();
            observer.next(false);
            observer.complete();
          },
        });
    });
  }

  public getAuthorizationHeader(): Record<string, string> {
    const token = this.accessToken();
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
    return {};
  }

  private setUserSession(user: UserSession, accessToken: string, refreshToken: string): void {
    this.currentUser.set(user);
    this.accessToken.set(accessToken);
    this.refreshToken.set(refreshToken);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(user));
      if (accessToken) {
        localStorage.setItem(this.ACCESS_TOKEN_KEY, accessToken);
      }
      if (refreshToken) {
        localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
      }
    }
  }

  public signOut(): void {
    const rToken = this.refreshToken();
    if (rToken) {
      this.http
        .post(`${this.apiBaseUrl}/auth/logout`, { refreshToken: rToken })
        .pipe(catchError(() => of(null)))
        .subscribe();
    }

    this.currentUser.set(null);
    this.accessToken.set(null);
    this.refreshToken.set(null);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(this.STORAGE_KEY);
      localStorage.removeItem(this.ACCESS_TOKEN_KEY);
      localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    }
  }

  public openAuthModal(): void {
    this.authErrorMessage.set('');
    this.isAuthModalOpen.set(true);
  }

  public closeAuthModal(): void {
    this.isAuthModalOpen.set(false);
  }
}
