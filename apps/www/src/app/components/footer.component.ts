import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DemoDialogService } from './demo-dialog.service';

@Component({
  selector: 'forge-cms-footer',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="border-t border-border bg-background px-6 py-10 md:px-8">
      <div
        class="mx-auto flex w-full max-w-7xl flex-col gap-8 md:flex-row md:items-center md:justify-between"
      >
        <div>
          <a class="inline-flex items-center gap-3 font-semibold text-foreground" routerLink="/">
            <img
              class="size-8 rounded-md"
              src="/logo.svg"
              alt="ForgeCMS logo"
              width="32"
              height="32"
            />
            <span>ForgeCMS</span>
          </a>
          <p class="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            A small, typed CMS foundation for Angular applications, built as focused packages.
          </p>
        </div>

        <nav class="flex flex-wrap items-center gap-3 text-sm font-medium text-muted-foreground">
          <a class="transition hover:text-foreground" routerLink="/docs">Docs</a>
          <button type="button" class="transition hover:text-foreground" (click)="demo.open()">
            Demo
          </button>
          <a
            class="transition hover:text-foreground"
            href="https://github.com/Andersseen/ForgeCMS"
            rel="noreferrer"
            target="_blank"
            >GitHub</a
          >
        </nav>
      </div>
    </footer>
  `
})
export class FooterComponent {
  protected readonly demo = inject(DemoDialogService);
}
