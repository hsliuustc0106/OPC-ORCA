# Architecture

OPC-ORCA is a desktop-first dig loop. DeepSeek Harness is where a person talks. Orca is where a run, a task, and a worker live. The coordinator is the state machine between them. Dry-run is the default. Live spawn is opt-in and fail-closed. The loop stops at the human PR gate.

```
┌──────────────────────────────────────────────┐
│ DeepSeek Harness                             │
│   desktop (entrance) or web                  │
│   Plugins → opc-orca                         │
└────────────────────┬─────────────────────────┘
                     │ DSH plugin API
┌────────────────────▼─────────────────────────┐
│ plugins/opc-orca          @opc-orca/plugin   │
│   dig tool: goal in, status summary out      │
└────────────────────┬─────────────────────────┘
                     │ start a dig
┌────────────────────▼─────────────────────────┐
│ packages/coordinator                         │
│   intake → … → awaiting_human_pr → done      │
│   easy task: coordinator-direct              │
│   other task: dry-run plan, or a parsed live │
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

`plugins/opc-orca` is the DSH plugin. `apply` injects the `tools` service and registers one tool, `dig`. A goal goes in. The coordinator runs. A status summary comes out. Live spawn is operator-owned. It runs only when `OPC_ORCA_LIVE` is exactly `1` and the plugin config `live` is not `false`. A tool caller passing `live: true` does not grant spawn. `config.live: true` does not replace the env var. `live: false` from the caller or from config forces dry-run, including when the env var is `1`. The default is dry-run. The tool stops before `askHumanPr`, so it does not enter `awaiting_human_pr` and it does not open, update, or merge a pull request. That yes stays with the human ([autonomous development](autonomous-dev.md)). The operator run is [local test](local-test.md). It registers no routes and no send middleware.

## orca-adapter

`packages/orca-adapter` and `packages/coordinator` are TypeScript, imported with `.ts` extensions. v0 does not emit JavaScript. Node 22 runs them with type stripping, and type stripping does not rewrite those specifiers, so the extensions stay `.ts`.

`packages/orca-adapter` is the only place that is allowed to spawn Orca, and the only place that may import `node:child_process`. That import is `src/spawn.ts`. Live spawn calls it with `shell: false`, so flag values are arguments, not a shell command. Dry-run does not call it.

The binary is `orca` on `PATH`. On Linux, if `orca` is not on `PATH`, the resolver falls back to `orca-ide`. Other platforms do not look for `orca-ide`. Wrappers exist for:

`status`, `run-create`, `task-create`, `task-list`, `worker-start`, `worker-show`, `worker-release`, `check`, `reply`, `gate-create`, `gate-resolve`.

`dryRun: true` records a plan for every named command and does not need the binary. Dry-run wins over the live flag, so `OPC_ORCA_LIVE=1` does not make a dry-run adapter spawn. Setting `dryRun` and `live: true` together throws. The plan has no run id, task id, worker id, message id, gate id, or exit code. `check` records the caller’s converged flag. `status`, `task-list`, `worker-show`, and `worker-release` record the command only: no id and no status payload. `reply` records the answer text only. `gate-create` records the reason only. `gate-resolve` records the resolution only.

Live spawn runs only when `dryRun` is not set and either `createOrcaAdapter({ live: true })` or `OPC_ORCA_LIVE` is exactly `1`. `true`, `yes`, and an empty value do not enable it. `live: false` forces the flag off even if the variable is `1`. When `env` is passed to the adapter, `OPC_ORCA_LIVE` is read from that object and not from `process.env`. The dig tool does not set `live: true` on this adapter unless the operator switch allows it (`OPC_ORCA_LIVE` exactly `1`, and plugin config `live` is not `false`).

With the flag off, each wrapper checks its arguments, then refuses without spawning:

- no executable → error code `not-configured`
- executable present → error code `not-implemented`, with argv `[binary, subcommand]`

With the flag on, the wrapper spawns `[binary, subcommand, --flag, value, …]`. Subcommand names and flag spellings live in [`packages/orca-adapter/src/cli.ts`](../packages/orca-adapter/src/cli.ts). `orcaCliConfirmTodo()` is the checklist to confirm against the desktop CLI during the [local test](local-test.md). An unchecked line is not a contract. `check` does not pass the caller’s converged flag. Exit code 0 is returned only when the process exited 0. Ids are copied only from stdout lines. Stderr is not parsed and is not copied into the error.

The stdout line protocol is one `key: value` per line. Blank lines are ignored. Values are tokens (`[A-Za-z0-9][A-Za-z0-9._:-]*`), except `converged`, which must be `true` or `false`. Known keys are `run-id`, `task-id`, `worker-id`, `message-id`, `gate-id`, `status`, `tasks`, and `converged`. Each command requires its own field: `run-create` requires `run-id`, `task-create` requires `task-id`, `worker-start`, `worker-show`, and `worker-release` require `worker-id`, `reply` requires `message-id`, `gate-create` and `gate-resolve` require `gate-id`, `status` requires `status`, `task-list` requires `tasks`, and `check` requires `converged`. An unknown line, a duplicate field, or a missing required field is unparseable. The adapter does not fill the gap from the caller’s arguments.

Fail-closed, in order:

- missing binary, or `ENOENT` / `EACCES` from spawn → `not-configured`
- non-zero exit or a signal → `spawn-failed` (stdout is not turned into a success)
- unparseable stdout → `unparseable` (no partial id is returned)

The coordinator stores a dry-run plan as recorded. It stores a live result only after a successful parse, and that parse is what advances state: run id, task id, and worker id are copied from stdout and passed into the next call. `status` stores the parsed status token. `check` stores stdout `converged` and does not copy the caller flag. A throw (`not-configured`, `not-implemented`, `spawn-failed`, `unparseable`, or a live object that is not a parsed success) leaves the state where it was and stores no intent for that call. `bindRun` stores neither intent if the second call throws. A parsed live result does not move `awaiting_human_pr` by itself. CI does not run the real Orca desktop. The operator confirms CLI flag names from the checklist in `cli.ts` during the local run. Orca `gate-create` and `gate-resolve` are backend gates for a worker or task decision. They are separate from the GitHub human PR gate. `reply` is separate from that gate too.

## Coordinator

`packages/coordinator` owns the dig-loop states. Normal tasks call the adapter and record the result (`run-create`, `task-create`, `worker-start` for **dsh** in a **new-child** worktree, then `check` on the waiting loop). The default adapter is dry-run and does not spawn, even when `OPC_ORCA_LIVE=1`. `runDig` builds a live adapter only when `OPC_ORCA_LIVE` is exactly `1` and neither the dig request nor the plugin config set `live` to false. A dig request `live: true` does not build that adapter by itself. A caller of `createDigLoop` can still pass an adapter it built; that is not the dig tool. While `waiting`, the loop may also record `status`, `task-list`, `worker-show`, `reply`, `gate-create`, and `gate-resolve`. Observation, reply, and backend gates do not converge and are not a substitute for `check`. Reply and the backend gates do not move `awaiting_human_pr`. After `converging`, the Orca worker path may record `worker-release`. `WIRE_ADAPTER_TODO` records the boundary that remains: a thrown adapter error, including a live spawn that fails closed (`not-configured`, `spawn-failed`, `unparseable`), is failure, not a converged tip, not a successful observation, not a worker answer, not a released worker, and not a resolved backend gate. A parsed live result is stored and advances the same states. The loop still stops at `awaiting_human_pr`. The easy-task path skips worker dispatch.

States: `intake`, `triage`, `plan`, `run_bound`, `dispatched`, `waiting`, `converging`, `awaiting_human_pr`, `done`.

`done` means this cycle’s ask was answered or triage stopped the work. It does not mean a pull request was opened or merged. `githubWritePerformed` on the snapshot is fixed `false`.

## Workers

A normal task becomes an Orca run, then a task, then a worker. The only worker v0 names is **dsh**, in a **new-child** worktree (a fresh child worktree off the fetched base, not a reuse of the coordinator’s checkout). The adapter rejects any other worker or worktree value so a stub cannot pretend a second runtime exists.

An **easy** task never reaches that path. The coordinator does the work in its own checkout (`coordinator-direct`) and still stops at `awaiting_human_pr`.

## What is intentionally absent

- A real `orca` binary in CI (the local runbook is [local test](local-test.md); dry-run smoke does not need the binary)
- Pull-request create, edit, push, or merge
- Merge queue, auto-merge, and `merge_group` workflows
- FlyBot tree, social, or timeline plugins
- Risk tiers that block a pull request (the JSON under `.github/agent/` is a Phase 0 placeholder)
