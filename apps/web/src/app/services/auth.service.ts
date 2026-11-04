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
  public readonly googleClientId: WritableSignal<string> = signal<string>('');
  public readonly isAuthModalOpen: WritableSignal<boolean> = signal<boolean>(false);

  public readonly isAuthenticated: Signal<boolean> = computed(() => {
    return this.currentUser() !== null;
  });

  constructor(private readonly http: HttpClient) {
    const isDev = typeof window !== 'undefined' && window.location.port === '4200';
    const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
    this.apiBaseUrl = isDev ? `http://${host}:3000/api` : '/api';

    this.restoreSession();
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
            this.verifyGoogleCredentialOnBackend(response.credential).subscribe();
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
        size: 'medium',
        type: 'standard',
        shape: 'rectangular',
        text: 'signin_with',
      });
    }
  }

  public promptGoogleOneTap(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const w = window as any;
    if (w.google?.accounts?.id) {
      w.google.accounts.id.prompt();
    }
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

  public loginAsOperator(name: string, email: string): void {
    const operatorUser: UserSession = {
      id: `usr_${Math.random().toString(36).substring(2, 9)}`,
      name: name.trim() || 'CCTV Operator',
      email: email.trim() || 'operator@cctv.local',
      picture: '',
      role: 'SURVEILLANCE_OPERATOR',
    };
    this.setUserSession(operatorUser);
    this.isAuthModalOpen.set(false);
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
    this.isAuthModalOpen.set(true);
  }

  public closeAuthModal(): void {
    this.isAuthModalOpen.set(false);
  }
}
