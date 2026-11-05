import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DetectionLogService } from '../../services/detection-log.service';

@Component({
  selector: 'app-detection-log',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './detection-log.component.html',
})
export class DetectionLogComponent {
  constructor(public readonly logService: DetectionLogService) {}

  public roundConfidence(conf: number): number {
    return Math.round(conf * 100);
  }

  public onSearchChange(term: string): void {
    this.logService.searchTerm.set(term);
  }

  public clearAllLogs(): void {
    if (confirm('Clear all logged detections?')) {
      this.logService.clearLogs();
    }
  }

  public formatTime(isoString: string): string {
    if (!isoString) {
      return '--:--:--';
    }
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return isoString;
    }
  }
}
