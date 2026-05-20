import { Component } from '@angular/core';
import { ArchitectureSectionComponent } from './components/architecture-section.component';
import { HeaderComponent } from './components/header.component';
import { HeroSectionComponent } from './components/hero-section.component';
import { PackagesSectionComponent } from './components/packages-section.component';
import { RoadmapSectionComponent } from './components/roadmap-section.component';

@Component({
  selector: 'forge-cms-root',
  standalone: true,
  imports: [
    HeaderComponent,
    HeroSectionComponent,
    ArchitectureSectionComponent,
    PackagesSectionComponent,
    RoadmapSectionComponent
  ],
  template: `
    <main class="min-h-screen overflow-hidden">
      <forge-cms-header />
      <forge-cms-hero-section />
      <forge-cms-architecture-section />
      <forge-cms-packages-section />
      <forge-cms-roadmap-section />
    </main>
  `
})
export class AppComponent {}
