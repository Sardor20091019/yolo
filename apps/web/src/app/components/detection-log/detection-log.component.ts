import { Component, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DetectionLogService, UserProfile } from '../../services/detection-log.service';

@Component({
  selector: 'app-detection-log',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './detection-log.component.html',
})
export class DetectionLogComponent {
  public readonly isCreatingUser: WritableSignal<boolean> = signal<boolean>(false);
  public newUserName: string = '';

  constructor(public readonly logService: DetectionLogService) {}

  public roundConfidence(conf: number): number {
    return Math.round(conf * 100);
  }

  public onSearchChange(term: string): void {
    this.logService.searchTerm.set(term);
  }

  public handleUserChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    if (target && target.value) {
      this.logService.switchUser(target.value);
    }
  }

  public toggleNewUserForm(): void {
    this.isCreatingUser.update((val) => !val);
    this.newUserName = '';
  }

  public submitNewUser(): void {
    if (!this.newUserName.trim()) {
      return;
    }
    this.logService.createUser(this.newUserName);
    this.newUserName = '';
    this.isCreatingUser.set(false);
  }

  public deleteCurrentUser(): void {
    const current = this.logService.currentUser();
    if (confirm(`Delete logs and profile for ${current.name}?`)) {
      this.logService.deleteUser(current.id);
    }
  }

  public clearAllLogs(): void {
    if (confirm('Clear all logged detections for this user?')) {
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
