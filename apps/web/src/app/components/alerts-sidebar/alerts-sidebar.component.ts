import { Component, OnInit, signal, WritableSignal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertsService } from '../../services/alerts.service';
import { WebSocketService } from '../../services/websocket.service';
import { AlertIncident } from '../../models/alert.model';

@Component({
  selector: 'app-alerts-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './alerts-sidebar.component.html',
})
export class AlertsSidebarComponent implements OnInit {
  public readonly activeFilter: WritableSignal<string> = signal<string>('ALL');
  public readonly selectedModalAlert: WritableSignal<AlertIncident | null> = signal<AlertIncident | null>(null);

  constructor(
    public readonly alertsService: AlertsService,
    private readonly wsService: WebSocketService,
  ) {
    effect(() => {
      const notif = this.wsService.alertNotification();
      if (notif) {
        this.alertsService.fetchAlerts(this.activeFilter()).subscribe();
        this.alertsService.fetchMetrics().subscribe();
      }
    });
  }

  public ngOnInit(): void {
    this.alertsService.fetchAlerts().subscribe();
    this.alertsService.fetchMetrics().subscribe();
  }

  public setFilter(status: string): void {
    this.activeFilter.set(status);
    this.alertsService.fetchAlerts(status).subscribe();
  }

  public updateStatus(alert: AlertIncident, newStatus: AlertIncident['status']): void {
    this.alertsService.updateStatus(alert.id, newStatus).subscribe();
  }

  public deleteAlert(alert: AlertIncident): void {
    this.alertsService.deleteAlert(alert.id).subscribe();
  }

  public openModal(alert: AlertIncident): void {
    this.selectedModalAlert.set(alert);
  }

  public closeModal(): void {
    this.selectedModalAlert.set(null);
  }

  public parseDetails(detailsStr: string): Record<string, any> {
    try {
      return JSON.parse(detailsStr || '{}');
    } catch {
      return {};
    }
  }

  public formatTime(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  public getSnapshotUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('data:')) return url;
    const host = window.location.hostname || 'localhost';
    return `http://${host}:3000${url}`;
  }
}
