import { Component, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { CameraStreamComponent } from './components/camera-stream/camera-stream.component';
import { AdminCctvComponent } from './components/admin-cctv/admin-cctv.component';
import { DetectionLogComponent } from './components/detection-log/detection-log.component';
import { WebSocketService } from './services/websocket.service';
import { DetectionLogService } from './services/detection-log.service';
import { AuthService } from './services/auth.service';
import { ThemeService } from './services/theme.service';
import { getApiBaseUrl } from './services/api-config';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CameraStreamComponent,
    AdminCctvComponent,
    DetectionLogComponent,
  ],
  templateUrl: './app.component.html',
})
export class AppComponent {
  public readonly activeTab: WritableSignal<'feed' | 'cctv' | 'logs'> = signal<'feed' | 'cctv' | 'logs'>('feed');
  public readonly isAccountMenuOpen: WritableSignal<boolean> = signal<boolean>(false);

  constructor(
    public readonly wsService: WebSocketService,
    public readonly logService: DetectionLogService,
    public readonly authService: AuthService,
    public readonly themeService: ThemeService,
    private readonly http: HttpClient,
  ) {}

  public setActiveTab(tab: 'feed' | 'cctv' | 'logs'): void {
    this.activeTab.set(tab);
  }

  public toggleAccountMenu(): void {
    this.isAccountMenuOpen.update((val) => !val);
  }

  public closeAccountMenu(): void {
    this.isAccountMenuOpen.set(false);
  }

  public signOut(): void {
    this.isAccountMenuOpen.set(false);
    this.authService.signOut();
  }

  public loginViaGoogle(): void {
    this.authService.redirectToGoogleOAuth();
  }

  public openSignInModal(): void {
    this.authService.openAuthModal();
  }

  public closeSignInModal(): void {
    this.authService.closeAuthModal();
  }

  public setDatabaseRole(newRole: 'admin' | 'user'): void {
    const user = this.authService.currentUser();
    if (!user) {
      return;
    }
    const apiUrl = getApiBaseUrl();
    this.http.post<{ success: boolean; user: any }>(`${apiUrl}/auth/role`, {
      userId: user.id,
      role: newRole,
    }).subscribe({
      next: (res) => {
        if (res && res.user) {
          this.authService.refreshRoleFromDb(user.id);
        }
      },
      error: () => {},
    });
  }
}
