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
| [1.0-PUBLIC-SURFACE.md](1.0-PUBLIC-SURFACE.md)                                              | What is the frozen 1.0 candidate contract (routes, defaults, admin config, peers)?                                            |
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
| [1.0-RELEASE-DOSSIER.md](1.0-RELEASE-DOSSIER.md) | The evidence handoff to the 1.0 release candidate: commitments, gates, support matrix, issue classification, owner                | At each release gate       |
| [DEMO-FINDINGS.md](DEMO-FINDINGS.md)             | What building a real site on ForgeCMS cost, and what is still open                                                                | After each demo re-dogfood |

Entry point for agents: [/CLAUDE.md](../CLAUDE.md) (also referenced by [/AGENTS.md](../AGENTS.md)).

## Versions versus roadmap checkpoints

The active delivery plan is [ROADMAP.md](ROADMAP.md): bounded product checkpoints **0.5 → 0.12** to 1.0, with a
[repository assessment](roadmap/v1/AUDIT.md), [execution handbook](roadmap/v1/EXECUTION.md), [quality contract](roadmap/v1/QUALITY.md) and individual release briefs.
They are **planning checkpoints, not npm versions**: the eleven public packages share one version (currently **`0.13.3`**), which runs ahead of the checkpoint
numbers. Roadmaps 0.5–0.12 are complete; the next bounded responsibility is [L01 — the 1.0 release candidate](roadmap/v1/1.0-release.md). The previous roadmap is
[archived](ROADMAP-LEGACY.md); historical specs remain the record of earlier decisions and are not updated to sound current.
