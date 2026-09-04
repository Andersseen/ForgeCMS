import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ArchitectureSectionComponent } from '../components/architecture-section.component';
import { DemoDialogComponent } from '../components/demo-dialog.component';
import { FooterComponent } from '../components/footer.component';
import { HeaderComponent } from '../components/header.component';
import { HeroSectionComponent } from '../components/hero-section.component';
import { PackagesSectionComponent } from '../components/packages-section.component';
import { RoadmapSectionComponent } from '../components/roadmap-section.component';

@Component({
  selector: 'forge-cms-landing',
  standalone: true,
  imports: [
    HeaderComponent,
    HeroSectionComponent,
    DemoDialogComponent,
    ArchitectureSectionComponent,
    PackagesSectionComponent,
    RoadmapSectionComponent,
    FooterComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="min-h-screen overflow-hidden landing-bg">
      <forge-cms-header />
      <forge-cms-hero-section />
      <forge-cms-architecture-section />
      <forge-cms-packages-section />
      <forge-cms-roadmap-section />
      <forge-cms-footer />
      <forge-cms-demo-dialog />
    </main>
  `
})
export class LandingPage {}
