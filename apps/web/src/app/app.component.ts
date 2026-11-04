import { Component, signal, WritableSignal, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CameraStreamComponent } from './components/camera-stream/camera-stream.component';
import { AlertsSidebarComponent } from './components/alerts-sidebar/alerts-sidebar.component';
import { DetectionLogComponent } from './components/detection-log/detection-log.component';
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
  ],
  templateUrl: './app.component.html',
})
export class AppComponent implements AfterViewInit {
  @ViewChild('googleButtonContainer') public googleBtnRef?: ElementRef<HTMLDivElement>;

  public readonly activeMobileTab: WritableSignal<'feed' | 'logs' | 'alerts'> = signal<'feed' | 'logs' | 'alerts'>('feed');
  public operatorInputName: string = '';
  public operatorInputEmail: string = '';

  constructor(
    public readonly wsService: WebSocketService,
    public readonly alertsService: AlertsService,
    public readonly logService: DetectionLogService,
    public readonly authService: AuthService,
  ) {}

  public ngAfterViewInit(): void {
    if (this.googleBtnRef?.nativeElement) {
      this.authService.renderGoogleButton(this.googleBtnRef.nativeElement);
    }
  }

  public setMobileTab(tab: 'feed' | 'logs' | 'alerts'): void {
    this.activeMobileTab.set(tab);
  }

  public submitManualOperatorLogin(): void {
    if (!this.operatorInputName.trim() && !this.operatorInputEmail.trim()) {
      return;
    }
    this.authService.loginAsOperator(this.operatorInputName, this.operatorInputEmail);
    this.operatorInputName = '';
    this.operatorInputEmail = '';
  }
}
