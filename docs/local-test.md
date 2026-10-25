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
| Record the local smoke | normal | Planned `run-create`, `task-create` (worker `dsh`, worktree `new-child`), `worker-start`, and `check`. Summary state `waiting`. No run id. |

It then records a fixture verdict (`Written-by: Smoke`, tip `smoke-local`) on each path. That fixture is local only. It is not a review of a real tip and it is not posted. Both paths stop at `awaiting_human_pr`. `githubWritePerformed` stays false. The script does not call the human yes for open, update, or merge.

A passing dry-run prints `PASS:` lines and ends with `PASS: smoke-local dry-run`. Exit code 0. Any failure prints `FAIL:` and exits nonzero.

The script also calls the normal dig with caller `live: true` and an empty `PATH`, and requires that call to stay on dry-run. That is the operator-switch check.

## Live, after dry-run passes

Turn on the Orca desktop settings above, confirm `command -v orca`, then:

```sh
OPC_ORCA_LIVE=1 npm run smoke:local -- --live
```

Both flags are required. `--live` alone exits nonzero and does not spawn. `OPC_ORCA_LIVE=1` alone, without `--live`, runs the dry-run section only.

The live section runs the same two goals:

- **Easy** stays coordinator-direct. State `converging`. No worker is started. `githubWritePerformed` stays false.
- **Normal** spawns `orca` for run-create, task-create, worker-start, and check. The dig tool returns before the human ask (`waiting` or `converging`). It does not enter `awaiting_human_pr` by itself and it does not open a pull request.

The dry-run half already proved the stop at `awaiting_human_pr`. A live parse advances the same states and still stops there once a verdict is recorded. The live half does not record that verdict and does not answer open, update, or merge.

A missing binary, a non-zero exit, or unparseable stdout is `FAIL`. The adapter does not invent a run id. Compare the desktop CLI with the checklist below before changing a spelling.

## Confirm the CLI spellings

Subcommands and flag names are only in [`packages/orca-adapter/src/cli.ts`](../packages/orca-adapter/src/cli.ts). `orcaCliConfirmTodo()` prints the checklist (binary `orca`, the Linux fallback `orca-ide`, and one line per subcommand).

While Orca desktop is running, compare each line with the real CLI (`orca` help, then each subcommand). An unchecked line is not a contract. A green dry-run does not check the boxes. If the desktop spelling differs, stop and record the difference. Do not paper over a failed parse by filling in an id.

## What you should not see

- A pull request opened, updated, or merged from this script or from the `dig` tool.
- A live spawn when `OPC_ORCA_LIVE` is unset, when config `live` is false, or when you did not pass `--live` to the smoke script.
- A successful run id when `orca` is missing or its stdout does not match the parser.
