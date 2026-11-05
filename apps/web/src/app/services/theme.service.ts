import { Injectable, signal, WritableSignal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  public readonly isDark: WritableSignal<boolean> = signal<boolean>(true);

  constructor() {
    this.initTheme();
  }

  private initTheme(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const saved = localStorage.getItem('yolo_theme');
    if (saved === 'light') {
      this.setLight();
    } else if (saved === 'dark') {
      this.setDark();
    } else {
      const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      if (prefersLight) {
        this.setLight();
      } else {
        this.setDark();
      }
    }
  }

  public toggleTheme(): void {
    if (this.isDark()) {
      this.setLight();
    } else {
      this.setDark();
    }
  }

  public setDark(): void {
    this.isDark.set(true);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem('yolo_theme', 'dark');
    }
  }

  public setLight(): void {
    this.isDark.set(false);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem('yolo_theme', 'light');
    }
  }
}
