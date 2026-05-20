import { Injectable, signal } from '@angular/core';
import { applyVoltTheme } from '@voltui/components';

const STORAGE_KEY = 'forgecms-theme';

type ThemeMode = 'light' | 'dark' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(this.getStoredMode());
  readonly isDark = signal<boolean>(this.resolveIsDark(this.getStoredMode()));

  constructor() {
    if (typeof window !== 'undefined') {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener('change', () => {
        if (this.mode() === 'system') {
          this.apply('system');
        }
      });
      this.apply(this.mode());
    }
  }

  toggle(): void {
    const next: ThemeMode = this.isDark() ? 'light' : 'dark';
    this.setMode(next);
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
    this.save(mode);
    this.apply(mode);
  }

  private apply(mode: ThemeMode): void {
    const dark = this.resolveIsDark(mode);
    this.isDark.set(dark);
    applyVoltTheme({ dark });
  }

  private getStoredMode(): ThemeMode {
    if (typeof localStorage === 'undefined') return 'system';
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    return stored ?? 'system';
  }

  private save(mode: ThemeMode): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, mode);
  }

  private resolveIsDark(mode: ThemeMode): boolean {
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  }
}
