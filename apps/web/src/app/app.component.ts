import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CameraStreamComponent } from './components/camera-stream/camera-stream.component';
import { AlertsSidebarComponent } from './components/alerts-sidebar/alerts-sidebar.component';
import { CalibrationPanelComponent } from './components/calibration-panel/calibration-panel.component';
import { WebSocketService } from './services/websocket.service';

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
  constructor(public readonly wsService: WebSocketService) {}
}

