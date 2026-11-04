import { Injectable, signal, computed, WritableSignal, Signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { getApiBaseUrl } from './api-config';

export interface UserSession {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly STORAGE_KEY: string = 'astro_cctv_auth_session';
  private readonly apiBaseUrl: string;

  public readonly currentUser: WritableSignal<UserSession | null> = signal<UserSession | null>(null);
  public readonly googleClientId: WritableSignal<string> = signal<string>('1002685554488-10r19m3kgt1o89ocoup8id1bjo1a2o6v.apps.googleusercontent.com');
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
    } catch {
      this.currentUser.set(null);
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
      token = params.get('access_token') || params.get('id_token');
    }

    if (!token && search && search.length > 1) {
      const qParams = new URLSearchParams(search.substring(1));
      token = qParams.get('access_token') || qParams.get('id_token') || qParams.get('token');
    }

    if (token) {
      window.history.replaceState(null, '', window.location.pathname);
      this.isAuthenticating.set(true);
      this.verifyGoogleCredentialOnBackend(token).subscribe({
        next: () => {
          this.isAuthenticating.set(false);
          this.authErrorMessage.set('');
        },
        error: () => {
          this.isAuthenticating.set(false);
          this.authErrorMessage.set('Google authentication failed.');
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

  public verifyGoogleCredentialOnBackend(credential: string): Observable<{ user: UserSession; token: string }> {
    return this.http.post<{ user: UserSession; token: string }>(`${this.apiBaseUrl}/auth/google`, { credential }).pipe(
      tap((res) => {
        if (res && res.user) {
          this.setUserSession(res.user);
          this.isAuthModalOpen.set(false);
        }
      }),
    );
  }

  private setUserSession(user: UserSession): void {
    this.currentUser.set(user);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(user));
    }
  }

  public signOut(): void {
    this.currentUser.set(null);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(this.STORAGE_KEY);
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
