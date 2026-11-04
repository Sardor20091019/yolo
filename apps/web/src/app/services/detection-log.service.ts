import { Injectable, signal, computed, WritableSignal, Signal } from '@angular/core';
import { BoundingBox } from '../models/detection.model';

export interface UserProfile {
  id: string;
  name: string;
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
}

@Injectable({
  providedIn: 'root',
})
export class DetectionLogService {
  private readonly USERS_STORAGE_KEY: string = 'astro_detection_users';
  private readonly ACTIVE_USER_STORAGE_KEY: string = 'astro_detection_active_user';
  private readonly LOGS_STORAGE_PREFIX: string = 'astro_detection_logs_';
  private readonly MAX_LOGS_PER_USER: number = 250;

  public readonly users: WritableSignal<UserProfile[]> = signal<UserProfile[]>([]);
  public readonly currentUser: WritableSignal<UserProfile> = signal<UserProfile>({
    id: 'usr_default',
    name: 'Operator 1',
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

  constructor() {
    this.initializeState();
  }

  private initializeState(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      const storedUsersJson = localStorage.getItem(this.USERS_STORAGE_KEY);
      let loadedUsers: UserProfile[] = [];
      if (storedUsersJson) {
        loadedUsers = JSON.parse(storedUsersJson);
      }

      if (loadedUsers.length === 0) {
        const initialUser: UserProfile = {
          id: 'usr_' + Math.random().toString(36).substring(2, 9),
          name: 'Primary User',
          createdAt: new Date().toISOString(),
        };
        loadedUsers = [initialUser];
        localStorage.setItem(this.USERS_STORAGE_KEY, JSON.stringify(loadedUsers));
      }

      this.users.set(loadedUsers);

      const activeUserId = localStorage.getItem(this.ACTIVE_USER_STORAGE_KEY);
      const matchedUser = loadedUsers.find((u) => u.id === activeUserId);
      const selectedUser = matchedUser || loadedUsers[0];

      this.currentUser.set(selectedUser);
      localStorage.setItem(this.ACTIVE_USER_STORAGE_KEY, selectedUser.id);

      this.loadLogsForUser(selectedUser.id);
    } catch {
      const fallbackUser: UserProfile = {
        id: 'usr_default',
        name: 'Primary User',
        createdAt: new Date().toISOString(),
      };
      this.users.set([fallbackUser]);
      this.currentUser.set(fallbackUser);
    }
  }

  public loadLogsForUser(userId: string): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      const key = `${this.LOGS_STORAGE_PREFIX}${userId}`;
      const data = localStorage.getItem(key);
      if (data) {
        const parsed: DetectionLogEntry[] = JSON.parse(data);
        this.logs.set(parsed);
      } else {
        this.logs.set([]);
      }
    } catch {
      this.logs.set([]);
    }
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
      if (currentLogs.length > this.MAX_LOGS_PER_USER) {
        currentLogs = currentLogs.slice(0, this.MAX_LOGS_PER_USER);
      }
      this.logs.set(currentLogs);
      this.persistLogs(user.id, currentLogs);
    }
  }

  private persistLogs(userId: string, entries: DetectionLogEntry[]): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      const key = `${this.LOGS_STORAGE_PREFIX}${userId}`;
      localStorage.setItem(key, JSON.stringify(entries));
    } catch {
      return;
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

  public createUser(name: string): UserProfile {
    const trimmed = name.trim() || `User ${this.users().length + 1}`;
    const newUser: UserProfile = {
      id: 'usr_' + Math.random().toString(36).substring(2, 9),
      name: trimmed,
      createdAt: new Date().toISOString(),
    };

    const updatedUsers = [...this.users(), newUser];
    this.users.set(updatedUsers);

    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(this.USERS_STORAGE_KEY, JSON.stringify(updatedUsers));
    }

    this.switchUser(newUser.id);
    return newUser;
  }

  public deleteUser(userId: string): void {
    if (this.users().length <= 1) {
      return;
    }

    const filtered = this.users().filter((u) => u.id !== userId);
    this.users.set(filtered);

    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(this.USERS_STORAGE_KEY, JSON.stringify(filtered));
      localStorage.removeItem(`${this.LOGS_STORAGE_PREFIX}${userId}`);
    }

    if (this.currentUser().id === userId) {
      this.switchUser(filtered[0].id);
    }
  }

  public clearLogs(): void {
    const user = this.currentUser();
    this.logs.set([]);
    this.lastRecordedTimeByLabel.clear();
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(`${this.LOGS_STORAGE_PREFIX}${user.id}`);
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
