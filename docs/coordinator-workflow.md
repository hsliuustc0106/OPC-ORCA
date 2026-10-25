# Coordinator workflow

The dig loop is a state machine in `packages/coordinator`. This page is the order of steps. Normal tasks call `packages/orca-adapter` in **dry-run** for `run-create`, `task-create`, `worker-start`, and `check`, and store that plan as intents. While `waiting`, they may also record `status`, `task-list`, `worker-show`, `reply`, `gate-create`, and `gate-resolve`. Those plans do not converge. `reply` is a worker-side answer and is not the human PR yes. `gate-create` and `gate-resolve` are Orca backend gates for a worker or task decision. They are not the human PR yes and do not move `awaiting_human_pr`. After `converging`, the Orca worker path may record `worker-release`. Dry-run does not spawn and does not need the `orca` binary. A live adapter call throws `not-configured` or `not-implemented`; the loop does not invent a run id, a worker id, a message id, a gate id, a status payload, or treat the throw as converged. Live spawn stays on `WIRE_ADAPTER_TODO`.

```
intake
  → triage
      → done                         (not agent-ready; no PR ask)
      → plan
          → converging               (easy: coordinator-direct)
          → run_bound                (normal: run-create + task-create)
              → dispatched           (worker-start)
                  → waiting          (check not converged; may record status, task-list, worker-show, reply, gate-create, gate-resolve)
                  → converging       (check converged; may record worker-release)
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

- **Easy → coordinator-direct.** The coordinator does the work in the current checkout. No `run-create`, no `task-create`, no `worker-start`, no `check`, no observation, no `reply`, no `gate-create`, no `gate-resolve`, and no `worker-release`. Next state: `converging`.
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

While the state is `waiting`, the coordinator may call `status`, `task-list`, and `worker-show` in dry-run. Each recorded plan is the command only: no run id, task id, worker id, or status payload. The state stays `waiting`. These calls are not convergence and are not a substitute for `check`. A throw leaves the state on `waiting` and does not store that call’s intent. Calling them before `waiting`, or after `check` has entered `converging`, is an illegal transition.

While the state is `waiting`, the coordinator may also call `reply` in dry-run to answer a worker ask. The plan records the answer text and no run id, message id, or exit code. The state stays `waiting`. Reply does not enter `converging` and does not enter `awaiting_human_pr`. It is not the human PR yes and it is not a substitute for `check`. A throw (`not-configured` or `not-implemented`) leaves the state on `waiting` and stores no reply intent. Calling reply before `waiting`, or after the state has left `waiting`, is an illegal transition.

While the state is `waiting`, the coordinator may call `gate-create` and `gate-resolve` in dry-run. These are Orca backend gates for a worker or task decision. `gate-create` records the reason and no run id or gate id. `gate-resolve` records the resolution and no gate id or exit code. The state stays `waiting`. Neither call enters `converging` or `awaiting_human_pr`. Neither call is the human PR yes, and neither opens, updates, or merges a pull request. A throw (`not-configured` or `not-implemented`) leaves the state on `waiting` and stores no intent for that call. Calling either command before `waiting`, or after the state has left `waiting`, is an illegal transition. The coordinator-direct path never reaches `waiting`, so it does not record these gates.

### 7. Converge (`converging`)

Both paths meet here. The loop is not done. It still needs one verdict and a human.

On the Orca worker path the coordinator may call `worker-release` in dry-run once the state is `converging` (the worker is done with its tip). The plan is the command only: no worker id. The state stays `converging`. Release does not ask the human and does not open, update, or merge a pull request. A throw leaves the state on `converging` and stores no worker-release intent. The coordinator-direct path has no worker, so `worker-release` there is an illegal transition. Calling it before `converging`, or after the state has left `converging`, is an illegal transition.

### 8. PR ask (`awaiting_human_pr`)

`askHumanPr` requires a tip SHA and one verdict:

```
Verdict: PASS at <sha>
Written-by: Reviewer
```

`FAIL` and `INC` are valid outcomes. They still stop. They do not open a pull request and they do not start another worker.

A second verdict for the same SHA throws. A later SHA, recorded with `noteVerdict` while still in `awaiting_human_pr`, replaces the previous verdict (the new commit voided it). The state stays `awaiting_human_pr`.

The ask is one of: **open** a draft, **update** the pull request, or **merge** it. The machine waits. A `reply` recorded while `waiting` is not this ask and is not a yes for open, update, or merge. A `gate-create` or `gate-resolve` recorded while `waiting` is not this ask either. Resolving a backend gate does not enter `awaiting_human_pr`.

### 9. Human answer (`done`)

`humanPrDecision` records `yes` plus the action, or `no`. Then `done`.

The snapshot’s `githubWritePerformed` stays `false`. A yes is not `gh pr create`, not `git push`, and not a merge. Performing that write is a later component, and only after this decision exists for the matching tip.

## Easy tasks

Easy means the coordinator can hold the whole change: no Orca run, no dispatched worker. The direct path is `plan` → `converging` → `awaiting_human_pr` → `done`. It still proves the diff, still takes one verdict, and still waits for the human. Calling `bindRun` on an easy task is an illegal transition.

## Normal tasks

Normal means Orca owns execution. The path is `plan` → `run_bound` → `dispatched` → `waiting` → `converging` → `awaiting_human_pr` → `done`. Calling the direct path on a normal task is an illegal transition.

## Backend gates are not the human PR yes

`gate-create` and `gate-resolve` run while `waiting`. They record an Orca decision for the worker or task. `gate-resolve` must not be used as a stand-in for the human PR yes, and neither call moves `awaiting_human_pr`. `reply` must not either: it answers a worker while `waiting` and does not move `awaiting_human_pr`. `status`, `task-list`, and `worker-show` are observation while `waiting`. They do not stand in for `check`. Live spawn of `orca` stays unwired.
