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
│   other task: dry-run plan via the adapter   │
└────────────────────┬─────────────────────────┘
                     │ dry-run plan, live throws
┌────────────────────▼─────────────────────────┐
│ packages/orca-adapter                        │
│   spawn `orca` (Linux fallback: `orca-ide`)  │
│   dry-run records a plan; live calls throw   │
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

Each live wrapper checks its arguments, then refuses:

- no executable → error code `not-configured`
- executable present → error code `not-implemented`, with the argv a later change will spawn

`dryRun: true` is the exception for `run-create`, `task-create`, `worker-start`, `check`, `status`, `task-list`, `worker-show`, `worker-release`, and `reply`. Those calls record a plan and do not need the binary. The plan has no run id, task id, worker id, message id, or exit code. `check` records the caller’s converged flag. `status`, `task-list`, `worker-show`, and `worker-release` record the command only: no id and no status payload. `reply` records the answer text only. Every other command still refuses, including when dry-run is on (`gate-create`, `gate-resolve`). The package does not import `child_process` in v0, so a stub cannot succeed by accident. Orca’s own `gate-create` / `gate-resolve` are backend gates. They are not the GitHub human PR gate and v0 does not call them. `reply` is not that gate either.

## Coordinator

`packages/coordinator` owns the dig-loop states. Normal tasks call the adapter in dry-run and record that plan (`run-create`, `task-create`, `worker-start` for **dsh** in a **new-child** worktree, then `check` on the waiting loop). While `waiting`, the loop may also record `status`, `task-list`, `worker-show`, and `reply`. Observation and reply do not converge and are not a substitute for `check`. Reply does not move `awaiting_human_pr`. After `converging`, the Orca worker path may record `worker-release`. They do not spawn. `WIRE_ADAPTER_TODO` is what is still unwired (gates, live spawn): a thrown adapter error is failure, not a converged tip, not a successful observation, not a worker answer, and not a released worker. The easy-task path skips worker dispatch.

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
