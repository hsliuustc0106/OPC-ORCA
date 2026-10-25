# Coordinator workflow

The dig loop is a state machine in `packages/coordinator`. This page is the order of steps. The package records **intents** (the Orca command it would send). It does not send them. Wiring those intents to `packages/orca-adapter` is `WIRE_ADAPTER_TODO` on the coordinator package.

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

- **Easy → coordinator-direct.** The coordinator does the work in the current checkout. No `run-create`, no `task-create`, no `worker-start`. Next state: `converging`.
- **Normal → Orca.** Next step is run-create. The coordinator will not take the direct path for a normal task.

### 4. Run-create and task-create (`run_bound`)

Intents recorded, not executed:

- `run-create` — goal, base `origin/main`
- `task-create` — worker `dsh`, worktree `new-child`

`run_bound` means an Orca run is the *intended* parent of the task. v0 has no run id because the adapter was not called. Do not invent one.

### 5. Worker-start (`dispatched`)

Intent: `worker-start` with worker `dsh` and worktree `new-child`.

The child worktree is new for this task. It is not the coordinator’s checkout and not a worktree left over from another run.

### 6. Check loop (`waiting`)

Each check records a `check` intent.

- Not converged: stay in `waiting`. The first check may enter `waiting` from `dispatched`.
- Converged: go to `converging`.

Convergence here means the worker’s branch is a reviewable tip (diff proves `origin/main`, verify ran). The coordinator does not judge that by itself in v0; the caller passes `converged: true` or `false`. A later wire-up should use the adapter’s `check` and refuse to treat a thrown stub as converged.

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

`status`, `task-list`, `worker-show`, `worker-release`, `reply`, `gate-create`, and `gate-resolve` are on the adapter so the CLI surface is complete. The dig loop does not record them. `gate-resolve` must not be used as a stand-in for the human PR yes.
