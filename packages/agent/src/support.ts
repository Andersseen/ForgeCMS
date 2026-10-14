/**
 * The one definition of "what is supported", served by `forge_support` and `forge://support`. Values mirror
 * `docs/SUPPORT.md` / `docs/MATRICES.md` of the SAME release; `pnpm docs:verify` fails if they drift.
 */
export interface SupportFacts {
  forgeVersion: string;
  note: string;
  node: { supported: string; tested: string };
  angularClient: { supported: string; tested: string };
  angularAdmin: { supported: string; tested: string };
  vite: { supported: string; tested: string };
  analog: { tested: string; note: string };
  profiles: {
    cloudflare: { database: string; files: string; certified: boolean };
    portable: { database: string; files: string; certified: boolean };
  };
  s3Providers: { garage: string; others: string };
  analytics: { status: 'experimental'; note: string };
  agentKit: { status: 'experimental'; note: string };
}

export function supportFacts(forgeVersion: string): SupportFacts {
  return {
    forgeVersion,
    note: 'Version-matched to the installed @forge-cms/agent; see the support doc for the full table.',
    node: { supported: '>= 22', tested: '22 (CI image)' },
    angularClient: {
      supported: '@angular/core and @angular/router ^21.0.0 || ^22.0.0',
      tested: '21.0.0 minimum, 21.2.x current, newest 22.x'
    },
    angularAdmin: {
      supported: '^21.2.0 (all @angular/* peers); Angular 22 admin is not supported yet',
      tested: '21.2.0 minimum, 21.2.x current'
    },
    vite: {
      supported: '^7.0.0 || ^8.0.0 (optional peer for the linker)',
      tested: '7.0.0, 7.1.4, newest 8.x'
    },
    analog: {
      tested: '@analogjs/platform 2.5.2 with @analogjs/vite-plugin-angular 2.4.8',
      note: 'Analog is not a Forge peer dependency.'
    },
    profiles: {
      cloudflare: { database: 'D1 (binding DB)', files: 'R2 (binding BUCKET)', certified: true },
      portable: {
        database: 'on-disk libSQL',
        files: 'S3-compatible via @forge-cms/s3',
        certified: true
      }
    },
    s3Providers: {
      garage: 'Garage v2.4.1 is the only certified S3 service',
      others: 'AWS S3, Backblaze B2, Wasabi and others are configurable but not certified'
    },
    analytics: {
      status: 'experimental',
      note: 'Cloudflare Analytics Engine pageviews; public but outside the stable 1.x compatibility promise.'
    },
    agentKit: {
      status: 'experimental',
      note: '@forge-cms/agent is development tooling, read-only, and outside the stable 1.x compatibility promise.'
    }
  };
}
