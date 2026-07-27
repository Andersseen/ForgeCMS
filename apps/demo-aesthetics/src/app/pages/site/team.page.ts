import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SiteApiService } from '../../services/site-api.service';
import { asyncState } from './async-state';

@Component({
  selector: 'lumea-team-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="lumea-hero border-b border-border/60">
      <div class="mx-auto max-w-6xl px-5 py-16">
        <h1 class="lumea-display text-4xl">The team</h1>
        <p class="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Three specialists, one treatment plan. Every protocol at Lumea is signed off by our
          medical director before it reaches you.
        </p>
      </div>
    </section>

    <section class="mx-auto max-w-6xl px-5 py-16">
      @if (state.loading()) {
        <p class="text-sm text-muted-foreground">Loading…</p>
      } @else if (state.error(); as message) {
        <p class="text-sm text-destructive">{{ message }}</p>
      } @else {
        <div class="grid gap-10 md:grid-cols-3">
          @for (member of state.data() ?? []; track member.id) {
            <article>
              @if (member.photo; as photo) {
                <img
                  [src]="photo.url"
                  [alt]="photo.alt"
                  class="aspect-[3/4] w-full rounded-3xl object-cover"
                />
              }
              <h2 class="lumea-display mt-5 text-xl">{{ member.name }}</h2>
              <p class="text-sm text-muted-foreground">{{ member.jobTitle }}</p>
              <p class="mt-3 text-sm leading-relaxed">{{ member.bio }}</p>

              @if (member.specialties.length > 0) {
                <p class="mt-4 text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  Specialties
                </p>
                <ul class="mt-2 flex flex-wrap gap-2">
                  @for (specialty of member.specialties; track specialty) {
                    <li class="rounded-full bg-muted px-3 py-1 text-xs">{{ specialty }}</li>
                  }
                </ul>
              }

              @if (member.credentials.length > 0) {
                <ul class="mt-4 space-y-1 text-xs text-muted-foreground">
                  @for (credential of member.credentials; track credential.title) {
                    <li>
                      {{ credential.title }}
                      @if (credential.issuer) {
                        · {{ credential.issuer }}
                      }
                      @if (credential.year) {
                        ({{ credential.year }})
                      }
                    </li>
                  }
                </ul>
              }
            </article>
          }
        </div>
      }
    </section>
  `
})
export class TeamPage {
  private readonly api = inject(SiteApiService);
  protected readonly state = asyncState(() => this.api.team());
}
