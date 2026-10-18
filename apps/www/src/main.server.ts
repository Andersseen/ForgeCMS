/// <reference types="vite/client" />
import '@angular/platform-server/init';
import { bootstrapApplication, type BootstrapContext } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { AppComponent } from './app/app.component';
import { serverConfig } from './app/app.config.server';

function bootstrap(context: BootstrapContext) {
  return bootstrapApplication(AppComponent, serverConfig, context);
}

/** Public pages are source-controlled and render without a user session or CMS data. */
export default function render(url: string, document: string): Promise<string> {
  return renderApplication(bootstrap, { document, url });
}
