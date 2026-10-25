# OPC-ORCA

DeepSeek Harness is the entrance. A Harness plugin asks for the work. [Orca](docs/architecture.md) is the orchestration backend (Run, Task, Dispatch). The dig loop may run until a reviewable tip. It then **stops**. A human has to say yes before anyone opens, updates, or merges a pull request.

```
DeepSeek Harness (desktop / web)
        │  plugin
        ▼
plugins/opc-orca          @opc-orca/plugin   (stub, registers nothing)
        │
        ▼
packages/coordinator      dig-loop states; stops at the human PR gate
        │
        ▼
packages/orca-adapter     typed wrappers for the `orca` CLI (Linux: `orca-ide`)
        │
        ▼
Orca                      Run / Task / Dispatch
        │
        ▼
worker                    default: dsh + a new-child worktree
```

v0 is this layout and the stubs. A dry-run records the dispatch plan without the CLI. Nothing here calls a live Orca, opens a pull request, or enables a merge queue.

## Docs

- [Architecture](docs/architecture.md) — Harness UI, plugin, adapter, coordinator, workers
- [Autonomous development](docs/autonomous-dev.md) — auto to a reviewable tip; human for public GitHub writes
- [Coordinator workflow](docs/coordinator-workflow.md) — intake through the PR ask
- [AGENTS.md](AGENTS.md) — pipeline for coding agents
- [LESSONS.md](LESSONS.md) — dated lessons (none yet)

## Install the plugin stub later

The plugin is not on npm. After this scaffold is on `main`, add it the same way FlyBot adds a plugin from a GitHub path. Full notes: [plugins/opc-orca/README.md](plugins/opc-orca/README.md).

**DSH Web** (Node.js 22.19+, pnpm):

```sh
npx -y @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add "github:hsliuustc0106/OPC-ORCA#main&path:/plugins/opc-orca"
```

**DSH Desktop:** sidebar **Plugins** → **Add plugin**, paste that `github:` address, then **Install** and **Enable now**.

The stub loads and registers no tools. Do not point it at a real repo and expect a dig loop.

## Repo checks

Node.js 22.19 or newer:

```sh
npm ci
npm test
```

`npm test` typechecks the TypeScript stubs and runs the node tests. Risk and review workflows are Phase 0 report-only; they do not block and they do not merge.
