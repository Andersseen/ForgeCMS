import 'zone.js';
import '@angular/compiler';
import './styles.css';

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// Ensure compiler is loaded before bootstrap (AnalogJS dev mode)
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__ng_compiler_loaded__ = true;
}

bootstrapApplication(AppComponent, appConfig).catch((error: unknown) => {
  console.error(error);
});
