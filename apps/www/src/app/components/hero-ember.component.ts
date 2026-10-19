import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import type { AfterViewInit, ElementRef, OnDestroy } from '@angular/core';

const GLYPHS = ['{', '}', '<', '>', '/', '*', '+', '0', '1', ':', ';', '=', '[', ']'];

@Component({
  selector: 'forge-cms-hero-ember',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="forge-hero-ember" aria-hidden="true">
      <canvas #emberCanvas class="forge-hero-ember-canvas"></canvas>
    </div>
  `
})
export class HeroEmberComponent implements AfterViewInit, OnDestroy {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('emberCanvas');
  private context: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private motionQuery: MediaQueryList | null = null;
  private frame = 0;
  private lastFrame = 0;
  private visible = false;
  private width = 0;
  private height = 0;

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') return;

    const canvas = this.canvas().nativeElement;
    this.context = canvas.getContext('2d');
    if (!this.context) return;

    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motionQuery.addEventListener('change', this.onMotionChange);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry?.isIntersecting ?? false;
      this.syncAnimation();
    });
    this.intersectionObserver.observe(canvas);
    this.themeObserver = new MutationObserver(() =>
      this.draw(this.motionQuery?.matches ? 2 : performance.now() / 1000)
    );
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.resize();
  }

  ngOnDestroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.motionQuery?.removeEventListener('change', this.onMotionChange);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  private readonly onMotionChange = (): void => this.syncAnimation();
  private readonly onVisibilityChange = (): void => this.syncAnimation();

  private readonly animate = (now: number): void => {
    if (now - this.lastFrame >= 33) {
      this.draw(now / 1000);
      this.lastFrame = now;
    }
    this.frame = requestAnimationFrame(this.animate);
  };

  private syncAnimation(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.motionQuery?.matches) {
      this.draw(2);
    } else if (this.visible && !document.hidden) {
      this.lastFrame = 0;
      this.frame = requestAnimationFrame(this.animate);
    }
  }

  private resize(): void {
    const canvas = this.canvas().nativeElement;
    const rect = canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    if (!this.width || !this.height || !this.context) return;

    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(this.width * scale);
    canvas.height = Math.round(this.height * scale);
    this.context.setTransform(scale, 0, 0, scale, 0, 0);
    this.draw(this.motionQuery?.matches ? 2 : performance.now() / 1000);
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
