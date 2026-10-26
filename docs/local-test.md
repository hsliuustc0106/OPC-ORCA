# Local test

You run this on your Mac. Dry-run first. Live spawn waits for your operator switch. The coordinator stops at `awaiting_human_pr`. This run does not open, update, or merge a pull request.

## Prerequisites

1. **Node.js 22.19 or newer.** Check with `node -v`. The smoke script exits nonzero when the version is older.
2. **This repo**, with dependencies installed:

   ```sh
   npm ci
   ```

3. **Orca desktop**, running, with both of these on:
   - **Settings → Experimental orchestration**
   - **Settings → General → Orca CLI**

   Then `orca` must be on your `PATH` (`command -v orca` prints a path). The Linux name `orca-ide` is this repo's fallback when `orca` is missing on Linux. Your Mac uses `orca`.

4. **DeepSeek Harness** desktop, with one model already set up. Install the plugin from this repo (the same `dsh plugin add` form as the [plugin README](../plugins/opc-orca/README.md)):

   1. Sidebar **Plugins** → **Add plugin**.
   2. In **Package name or address**, paste:

      ```
      github:hsliuustc0106/OPC-ORCA#main&path:/plugins/opc-orca
      ```

      Until this branch is on `main`, point the ref at your branch instead of `main`.
   3. **Install**, then **Enable now**. If Harness says the change applies at the next start, quit it and open it again.

   The plugin registers one tool, `dig`. It does not open a pull request.

## Operator switch

Live spawn is yours, not the tool caller's.

- Set `OPC_ORCA_LIVE=1` in the environment when you want a live dig.
- Plugin config `live: false` forces dry-run, including when that variable is `1` and the tool call passes `live: true`.
- Plugin config `live: true` does not replace the env var. With `OPC_ORCA_LIVE` unset, the dig stays on dry-run.
- A `dig` call with `live: true` and no operator env stays on dry-run. Caller `live: false` forces dry-run even when the env var is `1`.

`true`, `yes`, and an empty value do not count as `OPC_ORCA_LIVE=1`.

## Dry-run first

From the repo root:

```sh
npm run smoke:local
```

You do not need `orca` on `PATH` for this. If the binary is missing, the script prints a `WARN` and continues. If it is present, the dry-run still does not spawn it.

The script runs two goals:

| Goal | Difficulty | What dry-run does |
| --- | --- | --- |
| Fix a typo in the readme | easy | Coordinator-direct. No Orca run. Summary state `converging`. |
| Record the local smoke | normal | Planned `run-create` (goal, repo, base `origin/main`), `task-create` (spec, no worker), `worker-start` (agent `dsh`, worktree `new-child`), and `check`. Summary state `waiting`. No run id. |

It then records a fixture verdict (`Written-by: Smoke`, tip `smoke-local`) on each path. That fixture is local only. It is not a review of a real tip and it is not posted. Both paths stop at `awaiting_human_pr`. `githubWritePerformed` stays false. The script does not call the human yes for open, update, or merge.

A passing dry-run prints `PASS:` lines and ends with `PASS: smoke-local dry-run`. Exit code 0. Any failure prints `FAIL:` and exits nonzero.

The script also calls the normal dig with caller `live: true` and an empty `PATH`, and requires that call to stay on dry-run. That is the operator-switch check.

## Coordinator terminal handle

Orca desktop 1.4.240 will not accept a live sender verb from outside an Orca pane unless you name the coordinator terminal. The verbs that require it are `run-create`, `task-create`, `worker-start`, `reply`, `gate-create`, and `gate-resolve` (`--from`), and `check` (`--terminal` for that same handle, not `--from`). `worker-start --terminal` is a worker target. This adapter does not pass it. `status`, `task-list`, `worker-show`, and `worker-release` do not take a sender on this adapter.

The handle is `ORCA_TERMINAL_HANDLE`, or adapter / plugin config `from` when that string is non-blank (`from` wins). A blank value is absent. Nothing in this repo invents a `term_…` handle.

Obtain one in either of these ways:

1. Run the smoke from an Orca terminal. That pane sets `ORCA_TERMINAL_HANDLE`.
2. After this repo’s worktree is registered in Orca, from that worktree:

   ```sh
   orca terminal create
   ```

   The prose line is `Created terminal term_…`. Export that handle:

   ```sh
   export ORCA_TERMINAL_HANDLE=term_…
   ```

   Registering the worktree is an operator step. This repo does not do it.

## Live, after dry-run passes

Turn on the Orca desktop settings above, confirm `command -v orca`, set the handle, then:

```sh
OPC_ORCA_LIVE=1 npm run smoke:local -- --live
```

Both flags are required. `--live` alone exits nonzero and does not spawn. `OPC_ORCA_LIVE=1` alone, without `--live`, runs the dry-run section only.

If `--live` is set and `OPC_ORCA_LIVE=1` but no handle is set, the script still runs the easy live dig (coordinator-direct, no spawn), prints `SKIP:` for the normal live dig, and exits 0. It does not spawn `run-create`.

The live section runs the same two goals:

- **Easy** stays coordinator-direct. State `converging`. No worker is started. `githubWritePerformed` stays false.
- **Normal** spawns `orca orchestration run-create`, `task-create`, `worker-start`, and `check` (see the checklist). The dig tool returns before the human ask (`waiting` or `converging`). It does not enter `awaiting_human_pr` by itself and it does not open a pull request. A green unit test is not this live spawn. Re-running it stays with the operator.

The dry-run half already proved the stop at `awaiting_human_pr`. A live parse advances the same states and still stops there once a verdict is recorded. The live half does not record that verdict and does not answer open, update, or merge.

A missing binary, a non-zero exit, or unparseable stdout is `FAIL`. A live sender verb with no handle is `no-sender` before spawn when the script does not skip it. The adapter does not invent a run id or a terminal handle. Compare the desktop CLI with the checklist below before changing a spelling. Desktop success text such as `Run run_… created and bound: …` is still outside the line protocol in `parse.ts`, so a live `run-create` that gets past the sender check can still fail closed as unparseable. This tip does not fill an id from that prose.

## Confirm the CLI spellings

Subcommands and flag names are only in [`packages/orca-adapter/src/cli.ts`](../packages/orca-adapter/src/cli.ts). `orcaCliConfirmTodo()` prints the checklist. The lines below were confirmed against Orca desktop **1.4.240** (`/Applications/Orca.app/Contents/Resources/bin/orca`, Mac local E2E). Top-level `orca run-create` is an unknown command. `status` stays top-level. Every other verb is `orca orchestration <verb>`.

```
[x] status
[x] orchestration run-create --objective --from
[x] orchestration task-create --spec --run --from
[x] orchestration task-list --run
[x] orchestration worker-start --task --agent --worktree --run --from
[x] orchestration worker-show --dispatch
[x] orchestration worker-release --dispatch
[x] orchestration check --run --terminal
[x] orchestration reply --id --body --run --from
[x] orchestration gate-create --task --question --from
[x] orchestration gate-resolve --id --resolution --from
```

Bindings the adapter passes: goal text is `--objective`; the task spec is `--spec` (not `--task-title`); a parsed run id is `--run`; a parsed task id is `--task`; worker `dsh` is `--agent` (in-repo docs name that agent `dsh`); worktree `new-child` is `--worktree`; the worker id from stdout is `--dispatch`; reply text is `--body` and the message being answered is `--id`; a gate reason is `--question`; a gate id is `gate-resolve --id`; the coordinator terminal handle is `--from` on those sender verbs and `--terminal` on `check`.

Not passed, and not invented: `run-create` has no `--repo` or `--base` (those stay on the dry-run plan as the product binding, base `origin/main`). `task-create` has no `--worker` or `--worktree`. `worker-start` does not pass `--repo`, `--base-branch`, or `--terminal`. `task-list` does not pass `--from`. `check` does not pass `--from`. `--json` is not passed. Live `reply` refuses when the caller did not supply a message id. A live sender verb refuses when no handle was supplied.

The stdout line protocol (`run-id:`, `task-id:`, `worker-id:`, and the other keys in `parse.ts`) was not part of that help confirm. Output that is not that protocol is unparseable. Do not paper over a failed parse by filling in an id.

A checked box is the 1.4.240 help confirm. It is not a green live spawn. After this change is merged, re-run `OPC_ORCA_LIVE=1 npm run smoke:local -- --live` on the Mac. That re-run is operator-owned.

## What you should not see

- A pull request opened, updated, or merged from this script or from the `dig` tool.
- A live spawn when `OPC_ORCA_LIVE` is unset, when config `live` is false, or when you did not pass `--live` to the smoke script.
- A successful run id when `orca` is missing or its stdout does not match the parser.
