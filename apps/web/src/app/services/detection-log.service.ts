import { Injectable, signal, computed, WritableSignal, Signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BoundingBox } from '../models/detection.model';
import { getApiBaseUrl } from './api-config';

export interface UserProfile {
  id: string;
  name: string;
  email?: string | null;
  picture?: string;
  createdAt: string;
}

export interface DetectionLogEntry {
  id: string;
  userId: string;
  label: string;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  stationId?: string;
  suspicionScore?: number;
}

@Injectable({
  providedIn: 'root',
})
export class DetectionLogService {
  private readonly USERS_STORAGE_KEY: string = 'astro_detection_users';
  private readonly ACTIVE_USER_STORAGE_KEY: string = 'astro_detection_active_user';
  private readonly apiBaseUrl: string;

  public readonly users: WritableSignal<UserProfile[]> = signal<UserProfile[]>([]);
  public readonly currentUser: WritableSignal<UserProfile> = signal<UserProfile>({
    id: 'usr_default',
    name: 'Primary Operator',
    createdAt: new Date().toISOString(),
  });
  public readonly logs: WritableSignal<DetectionLogEntry[]> = signal<DetectionLogEntry[]>([]);
  public readonly searchTerm: WritableSignal<string> = signal<string>('');

  public readonly filteredLogs: Signal<DetectionLogEntry[]> = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const all = this.logs();
    if (!term) {
      return all;
    }
    return all.filter((entry) => entry.label.toLowerCase().includes(term));
  });

  public readonly totalDetectionsCount: Signal<number> = computed(() => {
    return this.logs().reduce((sum, item) => sum + item.occurrences, 0);
  });

  public readonly uniqueObjectsCount: Signal<number> = computed(() => {
    const set = new Set<string>();
    this.logs().forEach((entry) => set.add(entry.label.toLowerCase()));
    return set.size;
  });

  public readonly topDetectedObject: Signal<string> = computed(() => {
    const counts = new Map<string, number>();
    this.logs().forEach((entry) => {
      const current = counts.get(entry.label) || 0;
      counts.set(entry.label, current + entry.occurrences);
    });
    let topName = 'None';
    let max = 0;
    counts.forEach((val, key) => {
      if (val > max) {
        max = val;
        topName = key;
      }
    });
    return topName;
  });

  private lastRecordedTimeByLabel: Map<string, number> = new Map<string, number>();

  constructor(private readonly http: HttpClient) {
    this.apiBaseUrl = getApiBaseUrl();

    this.restoreLocalCache();
    this.syncUsersFromDatabase();
  }

  private restoreLocalCache(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      const stored = localStorage.getItem(this.USERS_STORAGE_KEY);
      if (stored) {
        const parsed: UserProfile[] = JSON.parse(stored);
        if (parsed.length > 0) {
          this.users.set(parsed);
          const activeId = localStorage.getItem(this.ACTIVE_USER_STORAGE_KEY);
          const active = parsed.find((u) => u.id === activeId) || parsed[0];
          this.currentUser.set(active);
        }
      }
    } catch {}
  }

  public syncUsersFromDatabase(): void {
    this.http.get<any[]>(`${this.apiBaseUrl}/users`).subscribe({
      next: (dbUsers) => {
        if (Array.isArray(dbUsers) && dbUsers.length > 0) {
          const mapped: UserProfile[] = dbUsers.map((u) => ({
            id: u.id,
            name: u.name || 'Operator',
            email: u.email,
            picture: u.picture,
            createdAt: u.created_at ? new Date(u.created_at).toISOString() : new Date().toISOString(),
          }));

          this.users.set(mapped);
          this.persistUsersCache(mapped);

          let current = mapped.find((u) => u.id === this.currentUser().id);
          if (!current) {
            current = mapped[0];
          }
          this.currentUser.set(current);
          if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.setItem(this.ACTIVE_USER_STORAGE_KEY, current.id);
          }
          this.loadLogsForUser(current.id);
        } else {
          this.createInitialUserInDb();
        }
      },
      error: () => {
        this.loadLogsForUser(this.currentUser().id);
      },
    });
  }

  private createInitialUserInDb(): void {
    this.http.post<any>(`${this.apiBaseUrl}/users`, { name: 'Primary Operator' }).subscribe({
      next: (created) => {
        if (created) {
          const profile: UserProfile = {
            id: created.id,
            name: created.name,
            email: created.email,
            picture: created.picture,
            createdAt: created.created_at ? new Date(created.created_at).toISOString() : new Date().toISOString(),
          };
          this.users.set([profile]);
          this.currentUser.set(profile);
          this.persistUsersCache([profile]);
          this.loadLogsForUser(profile.id);
        }
      },
      error: () => {},
    });
  }

  public loadLogsForUser(userId: string): void {
    this.http.get<any[]>(`${this.apiBaseUrl}/detection/logs?userId=${encodeURIComponent(userId)}&limit=250`).subscribe({
      next: (records) => {
        if (!Array.isArray(records) || records.length === 0) {
          this.logs.set([]);
          return;
        }

        const map = new Map<string, DetectionLogEntry>();
        records.forEach((r) => {
          const lbl = (r.label || '').toLowerCase().trim();
          if (!lbl) return;
          const createdAt = r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString();
          const existing = map.get(lbl);
          if (existing) {
            existing.occurrences += 1;
            existing.confidence = Math.max(existing.confidence, r.confidence || 0);
            if (createdAt > existing.lastSeen) {
              existing.lastSeen = createdAt;
            }
            if (createdAt < existing.firstSeen) {
              existing.firstSeen = createdAt;
            }
          } else {
            map.set(lbl, {
              id: r.id || 'db_' + Math.random().toString(36).substring(2, 8),
              userId,
              label: r.label,
              confidence: r.confidence || 0.9,
              firstSeen: createdAt,
              lastSeen: createdAt,
              occurrences: 1,
              stationId: r.station_id,
              suspicionScore: r.suspicion_score,
            });
          }
        });

        const sorted = Array.from(map.values()).sort((a, b) => (b.lastSeen > a.lastSeen ? 1 : -1));
        this.logs.set(sorted);
      },
      error: () => {},
    });
  }

  public recordDetections(boxes: BoundingBox[]): void {
    if (!boxes || boxes.length === 0) {
      return;
    }

    const user = this.currentUser();
    const now = Date.now();
    const isoString = new Date().toISOString();
    let currentLogs = [...this.logs()];
    let hasModifications = false;

    const dbPayload = boxes.map((b) => ({
      user_id: user.id,
      station_id: 'CCTV-NODE-01',
      station_name: user.name,
      frame_index: 0,
      track_id: b.trackId || 0,
      label: b.label,
      confidence: b.confidence || 0.9,
      bbox: JSON.stringify(b.bbox || []),
      suspicion_score: 0,
      triggers: '[]',
    }));

    this.http.post(`${this.apiBaseUrl}/detection/logs`, dbPayload).subscribe({
      error: () => {},
    });

    boxes.forEach((box) => {
      const label = box.label.toLowerCase().trim();
      if (!label) {
        return;
      }

      const lastTimestamp = this.lastRecordedTimeByLabel.get(label) || 0;
      const isRecent = now - lastTimestamp < 4000;
      this.lastRecordedTimeByLabel.set(label, now);

      const existingIndex = currentLogs.findIndex((log) => log.label.toLowerCase() === label);

      if (existingIndex !== -1 && isRecent) {
        const existing = currentLogs[existingIndex];
        const updatedEntry: DetectionLogEntry = {
          ...existing,
          lastSeen: isoString,
          occurrences: existing.occurrences + 1,
          confidence: Math.max(existing.confidence, box.confidence),
        };
        currentLogs[existingIndex] = updatedEntry;
        hasModifications = true;
      } else {
        const newEntry: DetectionLogEntry = {
          id: 'log_' + now + '_' + Math.random().toString(36).substring(2, 6),
          userId: user.id,
          label: box.label,
          confidence: box.confidence,
          firstSeen: isoString,
          lastSeen: isoString,
          occurrences: 1,
        };
        currentLogs.unshift(newEntry);
        hasModifications = true;
      }
    });

    if (hasModifications) {
      if (currentLogs.length > 250) {
        currentLogs = currentLogs.slice(0, 250);
      }
      this.logs.set(currentLogs);
    }
  }

  public switchUser(userId: string): void {
    const user = this.users().find((u) => u.id === userId);
    if (!user) {
      return;
    }

    this.currentUser.set(user);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(this.ACTIVE_USER_STORAGE_KEY, user.id);
    }
    this.lastRecordedTimeByLabel.clear();
    this.loadLogsForUser(user.id);
  }

  public createUser(name: string): void {
    const trimmed = name.trim() || `Operator ${this.users().length + 1}`;
    this.http.post<any>(`${this.apiBaseUrl}/users`, { name: trimmed }).subscribe({
      next: (created) => {
        if (created) {
          const profile: UserProfile = {
            id: created.id,
            name: created.name,
            email: created.email,
            picture: created.picture,
            createdAt: created.created_at ? new Date(created.created_at).toISOString() : new Date().toISOString(),
          };
          const updated = [...this.users(), profile];
          this.users.set(updated);
          this.persistUsersCache(updated);
          this.switchUser(profile.id);
        }
      },
      error: () => {},
    });
  }

  public deleteUser(userId: string): void {
    if (this.users().length <= 1) {
      return;
    }

    this.http.delete(`${this.apiBaseUrl}/users/${encodeURIComponent(userId)}`).subscribe({
      next: () => {
        const filtered = this.users().filter((u) => u.id !== userId);
        this.users.set(filtered);
        this.persistUsersCache(filtered);

        this.http.delete(`${this.apiBaseUrl}/detection/logs?userId=${encodeURIComponent(userId)}`).subscribe({
          error: () => {},
        });

        if (this.currentUser().id === userId) {
          this.switchUser(filtered[0].id);
        }
      },
      error: () => {},
    });
  }

  public clearLogs(): void {
    const user = this.currentUser();
    this.logs.set([]);
    this.lastRecordedTimeByLabel.clear();
    this.http.delete(`${this.apiBaseUrl}/detection/logs?userId=${encodeURIComponent(user.id)}`).subscribe({
      error: () => {},
    });
  }

  private persistUsersCache(users: UserProfile[]): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(this.USERS_STORAGE_KEY, JSON.stringify(users));
    }
  }

  public exportLogsJson(): void {
    const user = this.currentUser();
    const data = {
      user,
      exportedAt: new Date().toISOString(),
      logs: this.logs(),
    };

    const jsonString = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', jsonString);
    downloadAnchor.setAttribute('download', `astro_vision_logs_${user.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }
}
