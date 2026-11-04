import { Component, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CameraStreamComponent } from './components/camera-stream/camera-stream.component';
import { AlertsSidebarComponent } from './components/alerts-sidebar/alerts-sidebar.component';
import { CalibrationPanelComponent } from './components/calibration-panel/calibration-panel.component';
import { WebSocketService } from './services/websocket.service';
import { AlertsService } from './services/alerts.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    CameraStreamComponent,
    AlertsSidebarComponent,
    CalibrationPanelComponent,
  ],
  templateUrl: './app.component.html',
})
export class AppComponent {
  public readonly activeMobileTab: WritableSignal<'feed' | 'alerts' | 'calibration'> = signal<'feed' | 'alerts' | 'calibration'>('feed');

  constructor(
    public readonly wsService: WebSocketService,
    public readonly alertsService: AlertsService,
  ) {}

  public setMobileTab(tab: 'feed' | 'alerts' | 'calibration'): void {
    this.activeMobileTab.set(tab);
  }
}
