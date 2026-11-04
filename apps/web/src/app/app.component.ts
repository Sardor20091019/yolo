import { Component, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CameraStreamComponent } from './components/camera-stream/camera-stream.component';
import { AlertsSidebarComponent } from './components/alerts-sidebar/alerts-sidebar.component';
import { DetectionLogComponent } from './components/detection-log/detection-log.component';
import { WebSocketService } from './services/websocket.service';
import { AlertsService } from './services/alerts.service';
import { DetectionLogService } from './services/detection-log.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    CameraStreamComponent,
    AlertsSidebarComponent,
    DetectionLogComponent,
  ],
  templateUrl: './app.component.html',
})
export class AppComponent {
  public readonly activeMobileTab: WritableSignal<'feed' | 'logs' | 'alerts'> = signal<'feed' | 'logs' | 'alerts'>('feed');

  constructor(
    public readonly wsService: WebSocketService,
    public readonly alertsService: AlertsService,
    public readonly logService: DetectionLogService,
  ) {}

  public setMobileTab(tab: 'feed' | 'logs' | 'alerts'): void {
    this.activeMobileTab.set(tab);
  }
}
