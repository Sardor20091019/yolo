import { Component, signal, WritableSignal, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
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
export class AppComponent implements AfterViewInit {
  @ViewChild('headerGoogleBtn') public headerGoogleBtnRef?: ElementRef<HTMLDivElement>;
  @ViewChild('modalGoogleBtn') public modalGoogleBtnRef?: ElementRef<HTMLDivElement>;

  public readonly activeTab: WritableSignal<'feed' | 'admin' | 'logs' | 'alerts'> = signal<'feed' | 'admin' | 'logs' | 'alerts'>('feed');

  constructor(
    public readonly wsService: WebSocketService,
    public readonly alertsService: AlertsService,
    public readonly logService: DetectionLogService,
    public readonly authService: AuthService,
  ) {}

  public ngAfterViewInit(): void {
    if (this.headerGoogleBtnRef?.nativeElement) {
      this.authService.renderGoogleButton(this.headerGoogleBtnRef.nativeElement);
    }
  }

  public setActiveTab(tab: 'feed' | 'admin' | 'logs' | 'alerts'): void {
    this.activeTab.set(tab);
  }

  public openLoginModal(): void {
    this.authService.openAuthModal();
    setTimeout(() => {
      if (this.modalGoogleBtnRef?.nativeElement) {
        this.authService.renderGoogleButton(this.modalGoogleBtnRef.nativeElement);
      }
    }, 150);
  }

  public triggerGoogleSignIn(): void {
    this.authService.triggerGoogleOAuth();
  }

  public triggerDirectGoogleRedirect(): void {
    this.authService.redirectToGoogleOAuth();
  }

  public triggerOperatorQuickAccess(): void {
    this.authService.loginWithOperatorClearance();
  }
}
