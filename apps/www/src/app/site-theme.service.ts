import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';
import { applyVoltTheme } from '@voltui/components';

type SiteTheme = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'forgecms-theme';

@Injectable({ providedIn: 'root' })
export class SiteThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly view = this.document.defaultView;
  private readonly media = this.view?.matchMedia('(prefers-color-scheme: dark)');
  private mode: SiteTheme = 'system';
  readonly isDark = signal(false);

  constructor() {
    this.restore();
    const onMediaChange = (): void => {
      if (this.mode === 'system') this.apply();
    };
    const onStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY || event.key === null) this.restore();
    };
    this.media?.addEventListener('change', onMediaChange);
    this.view?.addEventListener('storage', onStorage);
    inject(DestroyRef).onDestroy(() => {
      this.media?.removeEventListener('change', onMediaChange);
      this.view?.removeEventListener('storage', onStorage);
    });
  }

  toggle(): void {
    this.mode = this.isDark() ? 'light' : 'dark';
    try {
      this.view?.localStorage.setItem(STORAGE_KEY, this.mode);
    } catch {
      /* Theme still works without storage. */
    }
    this.apply();
  }

  restore(): void {
    try {
      const stored = this.view?.localStorage.getItem(STORAGE_KEY);
      this.mode = stored === 'light' || stored === 'dark' ? stored : 'system';
    } catch {
      /* Keep an in-memory choice if storage is unavailable. */
    }
    this.apply();
  }

  private apply(): void {
    const dark = this.mode === 'dark' || (this.mode === 'system' && (this.media?.matches ?? false));
    this.isDark.set(dark);
    applyVoltTheme({ dark }, this.document);
    this.document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#0A0F1A' : '#F7F9FC');
  }
}
