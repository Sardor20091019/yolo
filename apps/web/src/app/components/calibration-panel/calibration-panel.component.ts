import { Component, OnInit, signal, WritableSignal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WebSocketService } from '../../services/websocket.service';
import { DetectionApiService } from '../../services/detection.service';
import { StreamConfig, DetectionZone } from '../../models/detection.model';

@Component({
  selector: 'app-calibration-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './calibration-panel.component.html',
})
export class CalibrationPanelComponent implements OnInit {
  public confidenceThreshold: number = 0.35;
  public suspicionThreshold: number = 75;
  public loiteringThresholdSeconds: number = 10;
  public nervousCheckSensitivity: number = 3;

  public readonly saveSuccess: WritableSignal<boolean> = signal<boolean>(false);

  constructor(
    public readonly detectionApi: DetectionApiService,
    private readonly wsService: WebSocketService,
  ) {
    effect(() => {
      const liveConfig = this.wsService.calibrationConfig();
      if (liveConfig) {
        if (liveConfig.confidenceThreshold !== undefined) {
          this.confidenceThreshold = liveConfig.confidenceThreshold;
        }
        if (liveConfig.suspicionThreshold !== undefined) {
          this.suspicionThreshold = liveConfig.suspicionThreshold;
        }
        if (liveConfig.loiteringThresholdSeconds !== undefined) {
          this.loiteringThresholdSeconds = liveConfig.loiteringThresholdSeconds;
        }
        if (liveConfig.nervousCheckSensitivity !== undefined) {
          this.nervousCheckSensitivity = liveConfig.nervousCheckSensitivity;
        }
      }
    });
  }

  public ngOnInit(): void {
    this.detectionApi.fetchConfig().subscribe({
      next: (cfg) => {
        if (cfg.confidenceThreshold !== undefined) this.confidenceThreshold = cfg.confidenceThreshold;
        if (cfg.suspicionThreshold !== undefined) this.suspicionThreshold = cfg.suspicionThreshold;
        if (cfg.loiteringThresholdSeconds !== undefined) this.loiteringThresholdSeconds = cfg.loiteringThresholdSeconds;
        if (cfg.nervousCheckSensitivity !== undefined) this.nervousCheckSensitivity = cfg.nervousCheckSensitivity;
      },
    });
  }

  public onSliderChange(): void {
    const updated: StreamConfig = {
      mode: this.detectionApi.config().mode || 'WEBCAM',
      confidenceThreshold: Number(this.confidenceThreshold),
      suspicionThreshold: Number(this.suspicionThreshold),
      loiteringThresholdSeconds: Number(this.loiteringThresholdSeconds),
      nervousCheckSensitivity: Number(this.nervousCheckSensitivity),
    };

    this.wsService.updateCalibration(updated);
    this.detectionApi.saveConfig(updated).subscribe({
      next: () => {
        this.saveSuccess.set(true);
        setTimeout(() => this.saveSuccess.set(false), 1500);
      },
    });
  }

  public toggleZoneActive(zone: DetectionZone): void {
    if (!zone.id) return;
    this.detectionApi.updateZone(zone.id, { is_active: !zone.is_active }).subscribe();
  }

  public deleteZone(zone: DetectionZone): void {
    if (!zone.id) return;
    this.detectionApi.deleteZone(zone.id).subscribe();
  }
}

