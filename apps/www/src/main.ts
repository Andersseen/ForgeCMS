import './styles.css';

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// JIT is only used by Analog's development renderer. Production templates are AOT compiled.
if (import.meta.env.DEV) {
  await import('@angular/compiler');
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__ng_compiler_loaded__ = true;
}

bootstrapApplication(AppComponent, appConfig).catch((error: unknown) => {
  console.error(error);
});
