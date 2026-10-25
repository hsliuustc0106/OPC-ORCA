# Architecture

OPC-ORCA is a desktop-first dig loop. DeepSeek Harness is where a person talks. Orca is where a run, a task, and a worker live. The coordinator is the state machine between them. v0 ships the boundaries and the stubs, not a live backend.

```
┌──────────────────────────────────────────────┐
│ DeepSeek Harness                             │
│   desktop (entrance) or web                  │
│   Plugins → opc-orca                         │
└────────────────────┬─────────────────────────┘
                     │ DSH plugin API
┌────────────────────▼─────────────────────────┐
│ plugins/opc-orca          @opc-orca/plugin   │
│   v0: load, log, register nothing            │
└────────────────────┬─────────────────────────┘
                     │ later: start a dig
┌────────────────────▼─────────────────────────┐
│ packages/coordinator                         │
│   intake → … → awaiting_human_pr → done      │
│   easy task: coordinator-direct              │
│   other task: ask the adapter to dispatch    │
└────────────────────┬─────────────────────────┘
                     │ TODO(wire-adapter)
┌────────────────────▼─────────────────────────┐
│ packages/orca-adapter                        │
│   spawn `orca` (Linux fallback: `orca-ide`)  │
│   v0: throw, never fake a success            │
└────────────────────┬─────────────────────────┘
                     │ Run / Task / Dispatch
┌────────────────────▼─────────────────────────┐
│ Orca                                         │
│   workers, default dsh + new-child worktree  │
└──────────────────────────────────────────────┘
```

## Harness UI

Harness desktop is the entrance. The person states a goal there. Harness web is the same plugin, installed with `dsh plugin add` ([plugin README](../plugins/opc-orca/README.md)). The plugin does not get its own window in v0, and it does not ship a client bundle.

The UI is not a second orchestrator. It does not merge pull requests and it does not talk to the Orca CLI itself.

## opc-orca plugin

`plugins/opc-orca` is a DSH plugin stub. `apply` returns a disposer and registers no tools, routes, or send middleware. A later version will call the coordinator. It still will not open, update, or merge a pull request; that yes stays with the human ([autonomous development](autonomous-dev.md)).

## orca-adapter

`packages/orca-adapter` and `packages/coordinator` are TypeScript, imported with `.ts` extensions. v0 does not emit JavaScript. Node 22 runs them with type stripping, and type stripping does not rewrite those specifiers, so the extensions stay `.ts`.

`packages/orca-adapter` is the only place that is allowed to spawn Orca. The intended binary is `orca`. On Linux, if `orca` is not on `PATH`, the resolver falls back to `orca-ide`. Wrappers exist for:

`status`, `run-create`, `task-create`, `task-list`, `worker-start`, `worker-show`, `worker-release`, `check`, `reply`, `gate-create`, `gate-resolve`.

Each wrapper checks its arguments, then refuses:

- no executable → error code `not-configured`
- executable present → error code `not-implemented`, with the argv a later change will spawn

Neither path returns a run id. The package does not import `child_process` in v0, so a stub cannot succeed by accident. Orca’s own `gate-create` / `gate-resolve` are backend gates. They are not the GitHub human PR gate and v0 does not call them.

## Coordinator

`packages/coordinator` owns the dig-loop states. It records the Orca commands it *would* send and does not import the adapter yet. The export `WIRE_ADAPTER_TODO` is the wiring point: `run_bound`, `dispatched`, and the check loop should call the adapter, and the easy-task path should keep skipping worker dispatch.

States: `intake`, `triage`, `plan`, `run_bound`, `dispatched`, `waiting`, `converging`, `awaiting_human_pr`, `done`.

`done` means this cycle’s ask was answered or triage stopped the work. It does not mean a pull request was opened or merged. `githubWritePerformed` on the snapshot is fixed `false`.

## Workers

A normal task becomes an Orca run, then a task, then a worker. The only worker v0 names is **dsh**, in a **new-child** worktree (a fresh child worktree off the fetched base, not a reuse of the coordinator’s checkout). The adapter rejects any other worker or worktree value so a stub cannot pretend a second runtime exists.

An **easy** task never reaches that path. The coordinator does the work in its own checkout (`coordinator-direct`) and still stops at `awaiting_human_pr`.

## What is intentionally absent

- A live spawn of `orca` / `orca-ide`
- Pull-request create, edit, push, or merge
- Merge queue, auto-merge, and `merge_group` workflows
- FlyBot tree, social, or timeline plugins
- Risk tiers that block a pull request (the JSON under `.github/agent/` is a Phase 0 placeholder)
