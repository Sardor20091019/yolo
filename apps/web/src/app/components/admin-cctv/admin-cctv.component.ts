import { Component, OnInit, OnDestroy, signal, computed, WritableSignal, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';

export interface CctvStationRecord {
  stationId: string;
  stationName: string;
  status: 'ONLINE' | 'STREAMING' | 'DISCONNECTED';
  lastSeen: number;
  fps: number;
  totalFrames: number;
  activeDetectionsCount: number;
  lastDetectedObjects: string[];
  lastFrameSnapshot?: string;
}

@Component({
  selector: 'app-admin-cctv',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-cctv.component.html',
})
export class AdminCctvComponent implements OnInit, OnDestroy {
  public readonly stations: WritableSignal<CctvStationRecord[]> = signal<CctvStationRecord[]>([]);
  public readonly selectedStation: WritableSignal<CctvStationRecord | null> = signal<CctvStationRecord | null>(null);
  public readonly filterText: WritableSignal<string> = signal<string>('');
  public readonly isLoading: WritableSignal<boolean> = signal<boolean>(false);

  public readonly filteredStations: Signal<CctvStationRecord[]> = computed(() => {
    const q = this.filterText().toLowerCase().trim();
    const list = this.stations();
    if (!q) {
      return list;
    }
    return list.filter((s) => s.stationId.toLowerCase().includes(q) || s.stationName.toLowerCase().includes(q));
  });

  public readonly streamingCount: Signal<number> = computed(() => {
    return this.stations().filter((s) => s.status === 'STREAMING').length;
  });

  public readonly totalNetworkDetections: Signal<number> = computed(() => {
    return this.stations().reduce((acc, s) => acc + s.activeDetectionsCount, 0);
  });

  private pollIntervalId: any = null;
  private readonly apiBaseUrl: string;

  constructor(
    public readonly authService: AuthService,
    private readonly http: HttpClient,
  ) {
    const isDev = typeof window !== 'undefined' && window.location.port === '4200';
    const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
    this.apiBaseUrl = isDev ? `http://${host}:3000/api` : '/api';
  }

  public ngOnInit(): void {
    this.fetchStations();
    this.pollIntervalId = setInterval(() => {
      this.fetchStations();
    }, 2000);
  }

  public ngOnDestroy(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
    }
  }

  public fetchStations(): void {
    this.http.get<CctvStationRecord[]>(`${this.apiBaseUrl}/detection/cctv-stations`).subscribe({
      next: (data) => {
        if (Array.isArray(data)) {
          this.stations.set(data);
          const sel = this.selectedStation();
          if (sel) {
            const updated = data.find((s) => s.stationId === sel.stationId);
            if (updated) {
              this.selectedStation.set(updated);
            }
          }
        }
      },
      error: () => {
        return;
      },
    });
  }

  public selectStation(station: CctvStationRecord): void {
    this.selectedStation.set(station);
  }

  public closeSelectedStation(): void {
    this.selectedStation.set(null);
  }

  public formatRelativeTime(timestamp: number): string {
    const diff = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diff < 3) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    return `${Math.floor(diff / 60)}m ago`;
  }
}

