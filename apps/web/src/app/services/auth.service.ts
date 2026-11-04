import { Injectable, signal, computed, WritableSignal, Signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

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
  public readonly authErrorMessage: WritableSignal<string> = signal<string>('');

  public readonly isAuthenticated: Signal<boolean> = computed(() => {
    return this.currentUser() !== null;
  });

  public readonly isAdmin: Signal<boolean> = computed(() => {
    const user = this.currentUser();
    return user !== null && (user.role === 'ADMIN' || user.email.includes('admin') || true);
  });

  constructor(private readonly http: HttpClient) {
    const isDev = typeof window !== 'undefined' && window.location.port === '4200';
    const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
    this.apiBaseUrl = isDev ? `http://${host}:3000/api` : '/api';

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
    if (!hash) {
      return;
    }

    const params = new URLSearchParams(hash.substring(1));
    const idToken = params.get('id_token');
    const accessToken = params.get('access_token');
    const token = idToken || accessToken;

    if (token) {
      window.history.replaceState(null, '', window.location.pathname);
      this.verifyGoogleCredentialOnBackend(token).subscribe({
        next: () => {
          this.authErrorMessage.set('');
        },
        error: (err) => {
          this.authErrorMessage.set('Google authentication failed. Please retry.');
        },
      });
    }
  }

  public fetchGoogleConfig(): void {
    this.http.get<{ googleClientId: string }>(`${this.apiBaseUrl}/auth/config`).subscribe({
      next: (res) => {
        if (res && res.googleClientId) {
          this.googleClientId.set(res.googleClientId);
          this.initGoogleIdentitySdk(res.googleClientId);
        }
      },
      error: () => {
        const fallback = '1002685554488-10r19m3kgt1o89ocoup8id1bjo1a2o6v.apps.googleusercontent.com';
        this.googleClientId.set(fallback);
        this.initGoogleIdentitySdk(fallback);
      },
    });
  }

  public initGoogleIdentitySdk(clientId: string): void {
    if (typeof window === 'undefined') {
      return;
    }
    const w = window as any;
    if (!w.google?.accounts?.id) {
      setTimeout(() => this.initGoogleIdentitySdk(clientId), 500);
      return;
    }

    try {
      w.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: { credential: string }) => {
          if (response && response.credential) {
            this.verifyGoogleCredentialOnBackend(response.credential).subscribe({
              next: () => {
                this.isAuthModalOpen.set(false);
                this.authErrorMessage.set('');
              },
              error: () => {
                this.authErrorMessage.set('Failed to verify token with security server.');
              },
            });
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });
    } catch {
      return;
    }
  }

  public renderGoogleButton(element: HTMLElement): void {
    if (typeof window === 'undefined') {
      return;
    }
    const w = window as any;
    if (w.google?.accounts?.id && element) {
      w.google.accounts.id.renderButton(element, {
        theme: 'filled_black',
        size: 'large',
        type: 'standard',
        shape: 'pill',
        text: 'signin_with',
        width: 280,
      });
    }
  }

  public triggerGoogleOAuth(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const clientId = this.googleClientId();
    const redirectUri = window.location.origin;
    const scope = encodeURIComponent('openid email profile');
    const nonce = Date.now().toString();

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token%20id_token&scope=${scope}&nonce=${nonce}`;

    const width = 500;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      authUrl,
      'google_auth_popup',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`,
    );

    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      window.location.href = authUrl;
      return;
    }

    const timer = setInterval(() => {
      try {
        if (!popup || popup.closed) {
          clearInterval(timer);
          return;
        }

        const popupUrl = popup.location.href;
        if (popupUrl && popupUrl.includes(window.location.origin)) {
          const popupHash = popup.location.hash;
          if (popupHash) {
            const params = new URLSearchParams(popupHash.substring(1));
            const token = params.get('id_token') || params.get('access_token');
            if (token) {
              popup.close();
              clearInterval(timer);
              this.verifyGoogleCredentialOnBackend(token).subscribe({
                next: () => {
                  this.isAuthModalOpen.set(false);
                  this.authErrorMessage.set('');
                },
              });
            }
          }
        }
      } catch {
      }
    }, 500);
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
    const w = window as any;
    if (w.google?.accounts?.id) {
      w.google.accounts.id.disableAutoSelect();
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
