# docs/ — Project documentation for humans and AI agents

| File                               | What it answers                                                                                                                   | Update cadence             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| [CONTEXT.md](CONTEXT.md)           | Why does this project exist? What is it trying to become?                                                                         | Rarely (vision changes)    |
| [STATE.md](STATE.md)               | What is implemented _right now_? What's broken/missing? What's next?                                                              | **Every work session**     |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How do the packages fit together? What are the stable contracts?                                                                  | When structure changes     |
| [CONVENTIONS.md](CONVENTIONS.md)   | How must code be written here?                                                                                                    | When rules change          |
| [SDD.md](SDD.md)                   | How do we go from idea → spec → code?                                                                                             | Rarely                     |
| [specs/](specs/)                   | Feature specs (`NNN-slug.md`, from [specs/TEMPLATE.md](specs/TEMPLATE.md)) — also the historical record of what was built and why | Per feature                |
| [QUICKSTART.md](QUICKSTART.md)     | How do I try this in 10 minutes?                                                                                                  | When the demo flow changes |

Entry point for agents: [/CLAUDE.md](../CLAUDE.md) (also referenced by [/AGENTS.md](../AGENTS.md)).

The active delivery plan is [ROADMAP.md](ROADMAP.md): bounded minors from the `0.4.0` baseline to
1.0, with a [repository assessment](roadmap/v1/AUDIT.md), [execution handbook](roadmap/v1/EXECUTION.md),
[quality contract](roadmap/v1/QUALITY.md) and individual release briefs. The previous roadmap is
[archived](ROADMAP-LEGACY.md); historical specs remain the record of earlier implementation decisions.
