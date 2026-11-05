import { Component, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CameraStreamComponent } from './components/camera-stream/camera-stream.component';
import { DetectionLogComponent } from './components/detection-log/detection-log.component';
import { WebSocketService } from './services/websocket.service';
import { DetectionLogService } from './services/detection-log.service';
import { AuthService } from './services/auth.service';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CameraStreamComponent,
    DetectionLogComponent,
  ],
  templateUrl: './app.component.html',
})
export class AppComponent {
  public readonly activeTab: WritableSignal<'feed' | 'logs'> = signal<'feed' | 'logs'>('feed');
  public readonly isAccountMenuOpen: WritableSignal<boolean> = signal<boolean>(false);

  constructor(
    public readonly wsService: WebSocketService,
    public readonly logService: DetectionLogService,
    public readonly authService: AuthService,
    public readonly themeService: ThemeService,
  ) {}

  public setActiveTab(tab: 'feed' | 'logs'): void {
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
}
