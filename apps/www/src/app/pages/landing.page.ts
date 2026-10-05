import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ArchitectureSectionComponent } from '../components/architecture-section.component';
import { DemoInvitationComponent } from '../components/demo-invitation.component';
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
    ArchitectureSectionComponent,
    DemoInvitationComponent,
    PackagesSectionComponent,
    RoadmapSectionComponent,
    FooterComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="forge-public forge-marketing landing-bg">
      <a class="forge-skip-link" href="#main-content">Skip to content</a>
      <forge-cms-header />
      <main id="main-content" tabindex="-1">
        <forge-cms-hero-section />
        <forge-cms-architecture-section />
        <forge-cms-demo-invitation />
        <forge-cms-packages-section />
        <forge-cms-roadmap-section />
      </main>
      <forge-cms-footer />
    </div>
  `
})
export class LandingPage {}
