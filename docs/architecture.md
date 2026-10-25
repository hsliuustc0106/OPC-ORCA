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
                     │ dry-run plan, or a flagged live spawn
┌────────────────────▼─────────────────────────┐
│ packages/orca-adapter                        │
│   spawn `orca` (Linux fallback: `orca-ide`)  │
│   dry-run records a plan; live is opt-in     │
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

`packages/orca-adapter` is the only place that is allowed to spawn Orca, and the only place that may import `node:child_process`. That import is `src/spawn.ts`. Live spawn calls it with `shell: false`, so flag values are arguments, not a shell command. Dry-run does not call it.

The binary is `orca` on `PATH`. On Linux, if `orca` is not on `PATH`, the resolver falls back to `orca-ide`. Other platforms do not look for `orca-ide`. Wrappers exist for:

`status`, `run-create`, `task-create`, `task-list`, `worker-start`, `worker-show`, `worker-release`, `check`, `reply`, `gate-create`, `gate-resolve`.

`dryRun: true` records a plan for every named command and does not need the binary. Dry-run wins over the live flag, so `OPC_ORCA_LIVE=1` does not make a dry-run adapter spawn. Setting `dryRun` and `live: true` together throws. The plan has no run id, task id, worker id, message id, gate id, or exit code. `check` records the caller’s converged flag. `status`, `task-list`, `worker-show`, and `worker-release` record the command only: no id and no status payload. `reply` records the answer text only. `gate-create` records the reason only. `gate-resolve` records the resolution only.

Live spawn runs only when `dryRun` is not set and either `createOrcaAdapter({ live: true })` or `OPC_ORCA_LIVE` is exactly `1`. `true`, `yes`, and an empty value do not enable it. `live: false` forces the flag off even if the variable is `1`. When `env` is passed to the adapter, `OPC_ORCA_LIVE` is read from that object and not from `process.env`.

With the flag off, each wrapper checks its arguments, then refuses without spawning:

- no executable → error code `not-configured`
- executable present → error code `not-implemented`, with argv `[binary, subcommand]`

With the flag on, the wrapper spawns `[binary, subcommand, --flag, value, …]`. Flag spellings (`--goal`, `--repo`, `--base`, `--run-id`, `--title`, `--worker`, `--worktree`, `--task-id`, `--worker-id`, `--text`, `--reason`, `--gate-id`, `--resolution`) are the adapter’s until a later phase checks them against the desktop CLI. `check` does not pass the caller’s converged flag. Exit code 0 is returned only when the process exited 0. Ids are copied only from stdout lines. Stderr is not parsed and is not copied into the error.

The stdout line protocol is one `key: value` per line. Blank lines are ignored. Values are tokens (`[A-Za-z0-9][A-Za-z0-9._:-]*`), except `converged`, which must be `true` or `false`. Known keys are `run-id`, `task-id`, `worker-id`, `message-id`, `gate-id`, `status`, `tasks`, and `converged`. Each command requires its own field: `run-create` requires `run-id`, `task-create` requires `task-id`, `worker-start`, `worker-show`, and `worker-release` require `worker-id`, `reply` requires `message-id`, `gate-create` and `gate-resolve` require `gate-id`, `status` requires `status`, `task-list` requires `tasks`, and `check` requires `converged`. An unknown line, a duplicate field, or a missing required field is unparseable. The adapter does not fill the gap from the caller’s arguments.

Fail-closed, in order:

- missing binary, or `ENOENT` / `EACCES` from spawn → `not-configured`
- non-zero exit or a signal → `spawn-failed` (stdout is not turned into a success)
- unparseable stdout → `unparseable` (no partial id is returned)

The coordinator stores only dry-run plans. A throw, and a live result that is not a dry-run plan, leave the dig state where it was. A live spawn does not move `awaiting_human_pr`. This phase does not run the real Orca desktop. Orca `gate-create` and `gate-resolve` are backend gates for a worker or task decision. They are separate from the GitHub human PR gate. `reply` is separate from that gate too.

## Coordinator

`packages/coordinator` owns the dig-loop states. Normal tasks call the adapter in dry-run and record that plan (`run-create`, `task-create`, `worker-start` for **dsh** in a **new-child** worktree, then `check` on the waiting loop). While `waiting`, the loop may also record `status`, `task-list`, `worker-show`, `reply`, `gate-create`, and `gate-resolve`. Observation, reply, and backend gates do not converge and are not a substitute for `check`. Reply and the backend gates do not move `awaiting_human_pr`. After `converging`, the Orca worker path may record `worker-release`. The default adapter is dry-run and does not spawn. `WIRE_ADAPTER_TODO` records the boundary that remains: a thrown adapter error, including a live spawn that fails closed (`not-configured`, `spawn-failed`, `unparseable`), is failure, not a converged tip, not a successful observation, not a worker answer, not a released worker, and not a resolved backend gate. A parsed live result is not a dry-run plan, so the loop does not store it and does not advance. The easy-task path skips worker dispatch.

States: `intake`, `triage`, `plan`, `run_bound`, `dispatched`, `waiting`, `converging`, `awaiting_human_pr`, `done`.

`done` means this cycle’s ask was answered or triage stopped the work. It does not mean a pull request was opened or merged. `githubWritePerformed` on the snapshot is fixed `false`.

## Workers

A normal task becomes an Orca run, then a task, then a worker. The only worker v0 names is **dsh**, in a **new-child** worktree (a fresh child worktree off the fetched base, not a reuse of the coordinator’s checkout). The adapter rejects any other worker or worktree value so a stub cannot pretend a second runtime exists.

An **easy** task never reaches that path. The coordinator does the work in its own checkout (`coordinator-direct`) and still stops at `awaiting_human_pr`.

## What is intentionally absent

- Treating a live `orca` / `orca-ide` id as dig-loop success (spawn is flag-gated in the adapter; the loop still stores only dry-run plans)
- A smoke run against the real Orca desktop (a later phase)
- Pull-request create, edit, push, or merge
- Merge queue, auto-merge, and `merge_group` workflows
- FlyBot tree, social, or timeline plugins
- Risk tiers that block a pull request (the JSON under `.github/agent/` is a Phase 0 placeholder)
