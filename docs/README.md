# docs/ — Project documentation for humans and AI agents

## Using ForgeCMS

| File                                                                                        | What it answers                                                                                                               |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [QUICKSTART.md](QUICKSTART.md)                                                              | Which of the two canonical quickstarts do I follow?                                                                           |
| [REFERENCE.md](REFERENCE.md)                                                                | What does each package export, with which options, defaults, errors and stability?                                            |
| [MATRICES.md](MATRICES.md)                                                                  | Which field kinds, capabilities and deployment profiles exist, and how well proven?                                           |
| [SUPPORT.md](SUPPORT.md)                                                                    | Which versions are supported and tested? What are the semver and deprecation rules?                                           |
| [LIMITATIONS.md](LIMITATIONS.md)                                                            | What is deliberately out of scope for 1.0?                                                                                    |
| [MIGRATING-TO-1.0.md](MIGRATING-TO-1.0.md)                                                  | What must an existing 0.x application review before adopting 1.0?                                                             |
| [1.0-PUBLIC-SURFACE.md](1.0-PUBLIC-SURFACE.md)                                              | What is the stable 1.0 contract (routes, defaults, admin config, peers)?                                                      |
| [SCHEMA-UPGRADES.md](SCHEMA-UPGRADES.md)                                                    | What happens when I change a collection that already has data?                                                                |
| [BACKUP-RESTORE.md](BACKUP-RESTORE.md)                                                      | How do I back up, restore and recover an installation (libSQL, D1, R2, S3)?                                                   |
| [DEPLOYMENT-HEALTH.md](DEPLOYMENT-HEALTH.md) · [STAGING-REHEARSAL.md](STAGING-REHEARSAL.md) | How do I check a deployment, and how was the real Cloudflare staging rehearsed?                                               |
| Website docs ([`apps/www/src/content/docs`](../apps/www/src/content/docs))                  | The guides: concepts, fields, hooks, Local API, REST, auth, access, uploads, Angular, admin, SSR, deployment, troubleshooting |

## Working on ForgeCMS

| File                                             | What it answers                                                                                                                   | Update cadence             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| [CONTEXT.md](CONTEXT.md)                         | Why does this project exist? What is its intent?                                                                                  | Rarely (vision changes)    |
| [STATE.md](STATE.md)                             | What is implemented _right now_? What's broken/missing? What's next?                                                              | **Every work session**     |
| [ARCHITECTURE.md](ARCHITECTURE.md)               | How do the packages fit together? What are the stable contracts?                                                                  | When structure changes     |
| [CONVENTIONS.md](CONVENTIONS.md)                 | How must code be written here?                                                                                                    | When rules change          |
| [SDD.md](SDD.md)                                 | How do we go from idea → spec → code?                                                                                             | Rarely                     |
| [specs/](specs/)                                 | Feature specs (`NNN-slug.md`, from [specs/TEMPLATE.md](specs/TEMPLATE.md)) — also the historical record of what was built and why | Per feature                |
| [1.0-RELEASE-DOSSIER.md](1.0-RELEASE-DOSSIER.md) | The 1.0 release evidence, gates, support matrix, issue classification, and publication closeout                                   | At each release gate       |
| [roadmap/v2/](roadmap/v2/README.md)              | The current ForgeCMS 2.0 vision, product contract, milestone evidence, and cross-cutting quality bar                              | At each roadmap change     |
| [DEMO-FINDINGS.md](DEMO-FINDINGS.md)             | What building a real site on ForgeCMS cost, and what is still open                                                                | After each demo re-dogfood |

Entry point for agents: [/CLAUDE.md](../CLAUDE.md) (also referenced by [/AGENTS.md](../AGENTS.md)).

## Versions versus roadmap checkpoints

ForgeCMS **1.0.0 is published**. The current product direction is the [ForgeCMS 2.0 roadmap](roadmap/v2/README.md), with its [product contract](roadmap/v2/CONTRACT.md), [milestones](roadmap/v2/MILESTONES.md), and [quality requirements](roadmap/v2/QUALITY.md). Product checkpoints are not npm versions or delivery dates. The earlier [V1 roadmap](ROADMAP.md) and [legacy roadmap](ROADMAP-LEGACY.md) are retained as history; historical specs remain the record of earlier decisions and are not rewritten to sound current.
