import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  VoltBadge,
  VoltCard,
  VoltCardDescription,
  VoltCardHeader,
  VoltCardTitle
} from '@voltui/components';
import { features } from '../landing-data';

@Component({
  selector: 'forge-cms-architecture-section',
  standalone: true,
  imports: [VoltBadge, VoltCard, VoltCardHeader, VoltCardTitle, VoltCardDescription],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="architecture" class="border-y border-border bg-background/70 py-20">
      <div class="mx-auto w-full max-w-7xl px-6 md:px-8">
        <div class="max-w-3xl">
          <volt-badge variant="outline">Architecture</volt-badge>
          <h2 class="mt-5 text-3xl font-semibold md:text-5xl">
            Small contracts before big features.
          </h2>
          <p class="mt-5 text-lg leading-8 text-muted-foreground">
            The first milestone is a stable package boundary: a pure TypeScript core, explicit
            adapter contracts, and a deployable app for showing the idea clearly.
          </p>
        </div>

        <div class="mt-10 grid gap-4 md:grid-cols-3">
          @for (feature of features; track feature.title) {
            <volt-card>
              <volt-card-header>
                <volt-card-title>{{ feature.title }}</volt-card-title>
                <volt-card-description>{{ feature.description }}</volt-card-description>
              </volt-card-header>
            </volt-card>
          }
        </div>
      </div>
    </section>
  `
})
export class ArchitectureSectionComponent {
  protected readonly features = features;
}
