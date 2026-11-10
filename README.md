# Itinerary API

A store of versioned travel itineraries, reached through a hand-built HTTP API on
Cloudflare Workers and D1. Access is by bearer keys: holding a key is the permission.

| Read this                                    | For                                             |
| -------------------------------------------- | ----------------------------------------------- |
| [docs/api-guide.md](docs/api-guide.md)       | Building a client: workflows, errors, rules     |
| [openapi.yaml](openapi.yaml)                 | The HTTP contract                               |
| [docs/design.md](docs/design.md)             | What the API does and why                       |
| [docs/implementation.md](docs/implementation.md) | How the backend is built                    |
| [docs/decisions.md](docs/decisions.md)       | Decisions and their reasons                     |
| [CLAUDE.md](CLAUDE.md)                       | Working on this project: commands, rules, plan  |

```bash
npm install
npm run check    # type-check, lint, format check and tests
npm run dev      # local Worker with a local D1
```
