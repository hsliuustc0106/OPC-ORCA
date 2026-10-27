# OPC-ORCA

DeepSeek Harness is the entrance. A Harness plugin asks for the work. [Orca](docs/architecture.md) is the orchestration backend (Run, Task, Dispatch). The dig loop may run until a reviewable tip. It then **stops**. A human has to say yes before anyone opens, updates, or merges a pull request.

```
DeepSeek Harness (desktop / web)
        │  plugin
        ▼
plugins/opc-orca          @opc-orca/plugin   (`dig` tool; default dry-run)
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

v0 is this layout. A dry-run records the dispatch plan, the waiting-loop check, observation (`status`, `task-list`, `worker-show`), a waiting-loop `reply`, backend `gate-create` and `gate-resolve` while waiting, and `worker-release` after converging, without the CLI. Observation does not converge. Reply and those backend gates are not the human PR yes. A live spawn of `orca` (Linux: `orca-ide`) runs only when the operator set `OPC_ORCA_LIVE=1` and the plugin config `live` is not false. A dig tool caller passing `live: true` does not grant that spawn. The live path fails closed. A live sender verb needs a coordinator terminal handle (`ORCA_TERMINAL_HANDLE` or config `from`) and does not invent one. Live `worker-start` uses a desktop agent id (`OPC_ORCA_AGENT` or config `agent`), passes a unique `--name` for a new-child worktree, and does not invent either. The dig loop stores a parsed live result and advances on that parse. A throw does not advance. The loop still stops at `awaiting_human_pr`. Nothing here opens a pull request or enables a merge queue.

## Docs

- [Architecture](docs/architecture.md) — Harness UI, plugin, adapter, coordinator, workers
- [Autonomous development](docs/autonomous-dev.md) — auto to a reviewable tip; human for public GitHub writes
- [Coordinator workflow](docs/coordinator-workflow.md) — intake through the PR ask
- [Local test](docs/local-test.md) — macOS dry-run, then an operator-owned live dig
- [AGENTS.md](AGENTS.md) — pipeline for coding agents
- [LESSONS.md](LESSONS.md) — dated lessons (none yet)

## Install the plugin stub later

The plugin is not on npm. After this scaffold is on `main`, add it the same way FlyBot adds a plugin from a GitHub path. Full notes: [plugins/opc-orca/README.md](plugins/opc-orca/README.md).

**DSH Web** (Node.js 22.19+, pnpm):

```sh
npx -y @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add "github:hsliuustc0106/OPC-ORCA#main&path:/plugins/opc-orca"
```

**DSH Desktop:** sidebar **Plugins** → **Add plugin**, paste that `github:` address, then **Install** and **Enable now**.

The plugin registers a `dig` tool. The default is dry-run. A caller `live: true` does not spawn. It does not open a pull request. The operator runbook is [local test](docs/local-test.md).

## Repo checks

Node.js 22.19 or newer:

```sh
npm ci
npm test
```

`npm test` typechecks the TypeScript stubs and runs the node tests. Risk and review workflows are Phase 0 report-only; they do not block and they do not merge.
