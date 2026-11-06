import { Component, OnInit, OnDestroy, signal, computed, WritableSignal, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { WebSocketService } from '../../services/websocket.service';
import { WebrtcService } from '../../services/webrtc.service';
import { getApiBaseUrl } from '../../services/api-config';
import { CctvStationRecord } from '../../models/detection.model';

@Component({
  selector: 'app-admin-cctv',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-cctv.component.html',
})
export class AdminCctvComponent implements OnInit, OnDestroy {
  public readonly selectedStation: WritableSignal<CctvStationRecord | null> = signal<CctvStationRecord | null>(null);
  public readonly filterText: WritableSignal<string> = signal<string>('');
  public readonly isLoading: WritableSignal<boolean> = signal<boolean>(false);
  public readonly activeWatchingStations: WritableSignal<string[]> = signal<string[]>([]);

  public readonly stations: Signal<CctvStationRecord[]> = computed(() => {
    return this.wsService.cctvStations();
  });

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

  private pollIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly apiBaseUrl: string;

  constructor(
    public readonly authService: AuthService,
    public readonly wsService: WebSocketService,
    public readonly webrtcService: WebrtcService,
    private readonly http: HttpClient,
  ) {
    this.apiBaseUrl = getApiBaseUrl();
  }

  public ngOnInit(): void {
    this.wsService.joinAsAdmin();
    this.fetchStations();
    this.pollIntervalId = setInterval(() => {
      this.fetchStations();
    }, 3000);
  }

  public ngOnDestroy(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
    }
    this.activeWatchingStations().forEach((sid) => {
      this.webrtcService.stopWatchingStation(sid);
    });
  }

  public fetchStations(): void {
    this.http.get<CctvStationRecord[]>(`${this.apiBaseUrl}/detection/cctv-stations`).subscribe({
      next: (data) => {
        if (Array.isArray(data)) {
          this.wsService.cctvStations.set(data);
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
    this.connectWebRtc(station.stationId);
  }

  public connectWebRtc(stationId: string): void {
    this.webrtcService.watchStation(stationId);
    this.activeWatchingStations.update((list) => {
      if (!list.includes(stationId)) {
        return [...list, stationId];
      }
      return list;
    });
  }

  public getRemoteStream(stationId: string): MediaStream | null {
    return this.webrtcService.getRemoteStreamSignal(stationId)();
  }

  public closeSelectedStation(): void {
    const sel = this.selectedStation();
    if (sel) {
      this.webrtcService.stopWatchingStation(sel.stationId);
      this.activeWatchingStations.update((list) => list.filter((id) => id !== sel.stationId));
    }
    this.selectedStation.set(null);
  }

  public formatRelativeTime(timestamp: number): string {
    const diff = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diff < 3) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    return `${Math.floor(diff / 60)}m ago`;
  }
}
