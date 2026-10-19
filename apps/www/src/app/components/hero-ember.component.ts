import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  NgZone,
  afterNextRender,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core';
import type { ElementRef, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { fromEvent, map, startWith } from 'rxjs';
import { SiteThemeService } from '../site-theme.service';

const GLYPHS = ['{', '}', '<', '>', '/', '*', '+', '0', '1', ':', ';', '=', '[', ']'];
const FRAME_MS = 33;
const STILL_FRAME_TIME = 2;

@Component({
  selector: 'forge-cms-hero-ember',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:visibilitychange)': 'onVisibilityChange()' },
  template: `
    <div class="forge-hero-ember" aria-hidden="true">
      <canvas #emberCanvas class="forge-hero-ember-canvas"></canvas>
    </div>
  `
})
export class HeroEmberComponent {
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly theme = inject(SiteThemeService);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('emberCanvas');

  private readonly ready = signal(false);
  private readonly inView = signal(false);
  private readonly pageHidden = signal(false);
  private readonly reducedMotion = this.matchMedia('(prefers-reduced-motion: reduce)');

  private context: CanvasRenderingContext2D | null = null;
  private width = 0;
  private height = 0;

  constructor() {
    afterNextRender(() => this.init());

    effect((onCleanup) => {
      this.theme.isDark();
      if (!this.ready()) return;
      if (this.reducedMotion()) {
        this.draw(STILL_FRAME_TIME);
        return;
      }
      if (!this.inView() || this.pageHidden()) return;

      // The loop never touches the template, so keep it out of change detection.
      this.zone.runOutsideAngular(() => {
        let frame = 0;
        let last = 0;
        const tick = (now: number): void => {
          if (now - last >= FRAME_MS) {
            this.draw(now / 1000);
            last = now;
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        onCleanup(() => cancelAnimationFrame(frame));
      });
    });
  }

  protected onVisibilityChange(): void {
    this.pageHidden.set(this.document.hidden);
  }

  private matchMedia(query: string): Signal<boolean> {
    const media = this.document.defaultView?.matchMedia(query);
    if (!media) return signal(false).asReadonly();
    return toSignal(
      fromEvent<MediaQueryListEvent>(media, 'change').pipe(
        map((event) => event.matches),
        startWith(media.matches)
      ),
      { requireSync: true }
    );
  }

  private init(): void {
    const canvas = this.canvas().nativeElement;
    const context = canvas.getContext('2d');
    if (!context) return;
    this.context = context;

    const resizeObserver = new ResizeObserver(() => this.resize());
    const intersectionObserver = new IntersectionObserver(([entry]) =>
      this.inView.set(entry?.isIntersecting ?? false)
    );
    this.zone.runOutsideAngular(() => {
      resizeObserver.observe(canvas);
      intersectionObserver.observe(canvas);
    });
    this.destroyRef.onDestroy(() => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
    });
    this.pageHidden.set(this.document.hidden);
    this.ready.set(true);
  }

  private resize(): void {
    const canvas = this.canvas().nativeElement;
    const rect = canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    if (!this.width || !this.height || !this.context) return;

    const scale = Math.min(this.document.defaultView?.devicePixelRatio ?? 1, 1.5);
    canvas.width = Math.round(this.width * scale);
    canvas.height = Math.round(this.height * scale);
    this.context.setTransform(scale, 0, 0, scale, 0, 0);
    this.draw(this.reducedMotion() ? STILL_FRAME_TIME : performance.now() / 1000);
  }

  private draw(time: number): void {
    const context = this.context;
    if (!context || !this.width || !this.height) return;

    const palette = getComputedStyle(this.canvas().nativeElement);
    const primary = palette.getPropertyValue('--primary').trim();
    const cyan = palette.getPropertyValue('--forge-cyan').trim();
    const foreground = palette.getPropertyValue('--foreground').trim();
    const step = this.width < 600 ? 12 : 14;
    const columns = Math.ceil(this.width / step);
    const rows = Math.ceil(this.height / step);

    context.clearRect(0, 0, this.width, this.height);
    context.font = `600 ${step - 2}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    for (let column = 0; column < columns; column++) {
      const x = (column + 0.5) * step;
      const fraction = column / columns;
      const wave = 0.5 + 0.5 * Math.sin(fraction * Math.PI * 9 + time * 0.46);
      const detail = 0.5 + 0.5 * Math.sin(fraction * Math.PI * 23 - time * 0.82);
      const flameHeight = 0.2 + 0.38 * wave ** 2.2 + 0.12 * detail ** 3;

      for (let row = 0; row < rows; row++) {
        const rise = (rows - row - 0.5) / rows;
        const heat = (flameHeight - rise) / flameHeight;
        if (heat <= 0) continue;

        const seed = this.hash(column, row);
        const flicker = 0.5 + 0.5 * Math.sin(time * (3.4 + seed * 2) + seed * 15);
        const density = Math.min(1, heat * 1.35 + 0.1 * flicker);
        if (seed > density) continue;

        const nearBed = rise < 0.075;
        context.fillStyle = nearBed ? foreground : seed > 0.91 ? cyan : primary;
        context.globalAlpha = nearBed
          ? 0.42 + 0.3 * flicker
          : Math.min(0.7, (0.15 + 0.5 * heat) * (0.7 + 0.3 * flicker));
        const glyph = GLYPHS[Math.floor(this.hash(row, column + 19) * GLYPHS.length)] ?? '+';
        context.fillText(glyph, x, (row + 0.5) * step);
      }
    }

    for (let spark = 0; spark < 22; spark++) {
      const seed = this.hash(spark, 83);
      const progress = (seed + time * (0.045 + this.hash(spark, 19) * 0.035)) % 1;
      const x = seed * this.width + Math.sin(time + spark) * 14;
      const y = this.height * (0.85 - progress * 0.78);
      context.globalAlpha = Math.sin(progress * Math.PI) * 0.5;
      context.fillStyle = spark % 5 === 0 ? cyan : primary;
      context.fillText(spark % 3 === 0 ? '+' : '·', x, y);
    }
    context.globalAlpha = 1;
  }

  private hash(a: number, b: number): number {
    const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return value - Math.floor(value);
  }
}
