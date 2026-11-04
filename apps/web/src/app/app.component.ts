import { Component, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CameraStreamComponent } from './components/camera-stream/camera-stream.component';
import { AlertsSidebarComponent } from './components/alerts-sidebar/alerts-sidebar.component';
import { DetectionLogComponent } from './components/detection-log/detection-log.component';
import { AdminCctvComponent } from './components/admin-cctv/admin-cctv.component';
import { WebSocketService } from './services/websocket.service';
import { AlertsService } from './services/alerts.service';
import { DetectionLogService } from './services/detection-log.service';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CameraStreamComponent,
    AlertsSidebarComponent,
    DetectionLogComponent,
    AdminCctvComponent,
  ],
  templateUrl: './app.component.html',
})
export class AppComponent {
  public readonly activeTab: WritableSignal<'feed' | 'admin' | 'logs' | 'alerts'> = signal<'feed' | 'admin' | 'logs' | 'alerts'>('feed');
  public readonly isAccountMenuOpen: WritableSignal<boolean> = signal<boolean>(false);

  constructor(
    public readonly wsService: WebSocketService,
    public readonly alertsService: AlertsService,
    public readonly logService: DetectionLogService,
    public readonly authService: AuthService,
  ) {}

  public setActiveTab(tab: 'feed' | 'admin' | 'logs' | 'alerts'): void {
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
}
