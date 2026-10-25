# Coordinator workflow

The dig loop is a state machine in `packages/coordinator`. This page is the order of steps. Normal tasks call `packages/orca-adapter` in **dry-run** for `run-create`, `task-create`, `worker-start`, and `check`, and store that plan as intents. Dry-run does not spawn and does not need the `orca` binary. A live adapter call throws `not-configured` or `not-implemented`; the loop does not invent a run id or treat the throw as converged. Commands that are still only named, not called, stay on `WIRE_ADAPTER_TODO`.

```
intake
  → triage
      → done                         (not agent-ready; no PR ask)
      → plan
          → converging               (easy: coordinator-direct)
          → run_bound                (normal: run-create + task-create)
              → dispatched           (worker-start)
                  → waiting          (check loop, not converged)
                  → converging       (check converged)
          → awaiting_human_pr        (PR ask — stop)
              → done                 (human yes or no; still no GitHub write)
```

## Steps

### 1. Intake

A goal arrives from the Harness plugin (a person, or one issue). One goal per loop. Empty text is rejected. Next state: `triage`.

### 2. Triage

Decide whether the goal is ready to dig.

- Not ready: go to `done` with a reason (default `needs-human`). Do not ask for a pull request.
- Ready: set difficulty `easy` or `normal`. Next state: `plan`.

### 3. Plan

`plan` is where the path splits.

- **Easy → coordinator-direct.** The coordinator does the work in the current checkout. No `run-create`, no `task-create`, no `worker-start`, no `check`. Next state: `converging`.
- **Normal → Orca.** Next step is run-create. The coordinator will not take the direct path for a normal task.

### 4. Run-create and task-create (`run_bound`)

The coordinator calls the adapter with `dryRun`. The recorded plan is:

- `run-create` — goal, repo, base `origin/main`
- `task-create` — worker `dsh`, worktree `new-child`

`run_bound` means an Orca run is the *intended* parent of the task. There is still no run id. Dry-run must not invent one. If the adapter throws, the state stays `plan` and no intent is stored.

### 5. Worker-start (`dispatched`)

The coordinator calls the adapter's `worker-start` in dry-run with worker `dsh` and worktree `new-child`. No task id is invented. A throw leaves the state at `run_bound`.

The child worktree is new for this task. It is not the coordinator’s checkout and not a worktree left over from another run.

### 6. Check loop (`waiting`)

The coordinator calls the adapter’s `check` in dry-run and stores that plan as the `check` intent. The plan is the caller’s `converged` flag. It has no run id. A throw leaves the state where it was (`dispatched` or `waiting`) and stores no check intent.

- Not converged: stay in `waiting`. The first successful check may enter `waiting` from `dispatched`.
- Converged: go to `converging`.

Convergence here means the worker’s branch is a reviewable tip (diff proves `origin/main`, verify ran). The coordinator does not judge that by itself in v0; the caller passes `converged: true` or `false`, and dry-run records that flag. A thrown stub (`not-configured` or `not-implemented`) is failure, not converged.

### 7. Converge (`converging`)

Both paths meet here. The loop is not done. It still needs one verdict and a human.

### 8. PR ask (`awaiting_human_pr`)

`askHumanPr` requires a tip SHA and one verdict:

```
Verdict: PASS at <sha>
Written-by: Reviewer
```

`FAIL` and `INC` are valid outcomes. They still stop. They do not open a pull request and they do not start another worker.

A second verdict for the same SHA throws. A later SHA, recorded with `noteVerdict` while still in `awaiting_human_pr`, replaces the previous verdict (the new commit voided it). The state stays `awaiting_human_pr`.

The ask is one of: **open** a draft, **update** the pull request, or **merge** it. The machine waits.

### 9. Human answer (`done`)

`humanPrDecision` records `yes` plus the action, or `no`. Then `done`.

The snapshot’s `githubWritePerformed` stays `false`. A yes is not `gh pr create`, not `git push`, and not a merge. Performing that write is a later component, and only after this decision exists for the matching tip.

## Easy tasks

Easy means the coordinator can hold the whole change: no Orca run, no dispatched worker. The direct path is `plan` → `converging` → `awaiting_human_pr` → `done`. It still proves the diff, still takes one verdict, and still waits for the human. Calling `bindRun` on an easy task is an illegal transition.

## Normal tasks

Normal means Orca owns execution. The path is `plan` → `run_bound` → `dispatched` → `waiting` → `converging` → `awaiting_human_pr` → `done`. Calling the direct path on a normal task is an illegal transition.

## Adapter commands not used by this loop yet

`status`, `task-list`, `worker-show`, `worker-release`, `reply`, `gate-create`, and `gate-resolve` are on the adapter so the CLI surface is complete. The dig loop does not call them. `gate-resolve` must not be used as a stand-in for the human PR yes.
