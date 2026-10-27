# Coordinator workflow

The dig loop is a state machine in `packages/coordinator`. This page is the order of steps. Normal tasks call `packages/orca-adapter` for `run-create`, `task-create`, `worker-start`, and `check`, and store that result as intents. The default is **dry-run**. While `waiting`, they may also record `status`, `task-list`, `worker-show`, `reply`, `gate-create`, and `gate-resolve`. Those calls do not converge. `reply` is a worker-side answer and is not the human PR yes. `gate-create` and `gate-resolve` are Orca backend gates for a worker or task decision. They are not the human PR yes and do not move `awaiting_human_pr`. After `converging`, the Orca worker path may record `worker-release`. Dry-run does not spawn and does not need the `orca` binary, even when `OPC_ORCA_LIVE=1`. Without that variable (and without the adapter `live` option), a call throws `not-configured` or `not-implemented`. With the flag, the adapter spawns `orca` (Linux: `orca-ide`) and parses stdout. A missing binary, a missing coordinator terminal handle (`no-sender`), a non-zero exit, or unparseable stdout throws. The loop does not invent a run id, a worker id, a message id, a gate id, a status payload, or an exit code, and it does not treat that throw as converged. A parsed live result is stored and advances the same states. The loop still stops at `awaiting_human_pr`.

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

The coordinator calls the adapter. A dry-run plan is:

- `run-create` — goal, repo, base `origin/main`, and no run id. Live argv is `orchestration run-create --objective` plus `--from` when a coordinator terminal handle is set (`from`, otherwise `ORCA_TERMINAL_HANDLE`), then `--json`. `repo` and `base` are the product binding on the plan. Orca 1.4.240 does not accept them as run-create flags, and the adapter does not invent those flags. A live call with no handle throws `no-sender` before spawn and does not invent one. The run id is `result.run.id`. Prose `Run run_… created and bound: …` is unparseable.
- `task-create` — the spec (the goal text) and no task id, worker, or worktree. Live argv is `orchestration task-create --spec` plus `--run` when a run id was parsed. There is no `--task-title`. Worker `dsh` and worktree `new-child` are not task-create flags.

A parsed live result stores the run id from `run-create` (`result.run.id`) and the task id from `task-create` (`result.task.id`). The loop passes that run id into `task-create` as `--run`. It does not invent one. Every live spawn passes `--json`.

`run_bound` means an Orca run is the parent of the task. On a dry-run plan there is still no run id. If either call throws, the state stays `plan` and neither intent is stored.

### 5. Worker-start (`dispatched`)

The coordinator calls the adapter's `worker-start` with agent `dsh` and worktree `new-child`. In-repo docs name that agent `dsh`; the live flag is `--agent`, not `--worker`. A dry-run plan invents no task id and records `worker` `dsh` and `worktree` `new-child`. A parsed live result is called with the task id from `task-create` (`--task`), the run id from `run-create` (`--run`), and stores the worker id from `result.dispatchId` when `result.state` is `ready`. A throw leaves the state at `run_bound`. Optional desktop flags `--repo` and `--base-branch` are not passed. Live argv also passes `--from` with the coordinator handle. Desktop `--terminal` on this verb is a worker target and is not passed. The repo and `origin/main` binding stays on the run-create plan.

The child worktree is new for this task. It is not the coordinator’s checkout and not a worktree left over from another run.

### 6. Check loop (`waiting`)

The coordinator calls the adapter’s `check` and stores that result as the `check` intent. A dry-run plan is the caller’s `converged` flag and has no run id. A parsed live result is a mailbox read (`result.messages` and `result.count`) and records `converged` as `false`. It is called with the run id from `run-create` and the coordinator handle as `--terminal` (not `--from`), plus `--json`. The caller flag is not copied onto a live result. A throw leaves the state where it was (`dispatched` or `waiting`) and stores no check intent.

- Not converged: stay in `waiting`. The first successful check may enter `waiting` from `dispatched`.
- Converged: go to `converging`.

Convergence here means the worker’s branch is a reviewable tip (diff proves `origin/main`, verify ran). The coordinator does not judge that by itself. In dry-run the caller passes `converged: true` or `false`, and the plan must record that flag. A live check does not invent that tip: a parsed mailbox stays `waiting`. A thrown adapter error (`not-configured`, `not-implemented`, `no-sender`, `spawn-failed`, or `unparseable`) is failure, not converged.

While the state is `waiting`, the coordinator may call `status`, `task-list`, and `worker-show`. A dry-run plan is the command only: no run id, task id, worker id, or status payload. A parsed live `status` stores the status token. A parsed live `task-list` stores the tasks token and is called with the run id. A parsed live `worker-show` stores the worker id and is called with the worker id from `worker-start`. The state stays `waiting`. These calls are not convergence and are not a substitute for `check`. A throw leaves the state on `waiting` and does not store that call’s intent. Calling them before `waiting`, or after `check` has entered `converging`, is an illegal transition.

While the state is `waiting`, the coordinator may also call `reply` to answer a worker ask. A dry-run plan records the answer text and no run id, message id, or exit code. A parsed live result records the message id from stdout. Live argv is `orchestration reply --id` (the message being answered), `--body` (the answer text), and `--run` when a run id was parsed. The loop passes that message id only when the caller supplies one. It does not invent one. A live reply without that id throws before spawn and stores no reply intent. The state stays `waiting`. Reply does not enter `converging` and does not enter `awaiting_human_pr`. It is not the human PR yes and it is not a substitute for `check`. A throw (`not-configured`, `not-implemented`, `no-sender`, `spawn-failed`, or `unparseable`) leaves the state on `waiting` and stores no reply intent. Live reply also passes `--from`. Calling reply before `waiting`, or after the state has left `waiting`, is an illegal transition.

While the state is `waiting`, the coordinator may call `gate-create` and `gate-resolve`. These are Orca backend gates for a worker or task decision. A dry-run `gate-create` records the reason and no run id or gate id. A dry-run `gate-resolve` records the resolution and no gate id or exit code. A parsed live result records the gate id from stdout. `gate-create` is called with the task id from `task-create` (`--task`) and the reason as `--question`. Desktop `gate-create` has no `--run`. `gate-resolve` is called with the gate id from `gate-create` as `--id` and the resolution as `--resolution`, not with an id the loop invented. The state stays `waiting`. Neither call enters `converging` or `awaiting_human_pr`. Neither call is the human PR yes, and neither opens, updates, or merges a pull request. A throw (`not-configured`, `not-implemented`, `no-sender`, `spawn-failed`, or `unparseable`) leaves the state on `waiting` and stores no intent for that call. Live gate verbs also pass `--from`. Calling either command before `waiting`, or after the state has left `waiting`, is an illegal transition. The coordinator-direct path never reaches `waiting`, so it does not record these gates.

### 7. Converge (`converging`)

Both paths meet here. The loop is not done. It still needs one verdict and a human.

On the Orca worker path the coordinator may call `worker-release` once the state is `converging` (the worker is done with its tip). A dry-run plan is the command only: no worker id. A parsed live result stores the worker id from stdout and is called with the worker id from `worker-start`. The state stays `converging`. Release does not ask the human and does not open, update, or merge a pull request. A throw leaves the state on `converging` and stores no worker-release intent. The coordinator-direct path has no worker, so `worker-release` there is an illegal transition. Calling it before `converging`, or after the state has left `converging`, is an illegal transition.

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

`gate-create` and `gate-resolve` run while `waiting`. They record an Orca decision for the worker or task. `gate-resolve` must not be used as a stand-in for the human PR yes, and neither call moves `awaiting_human_pr`. `reply` must not either: it answers a worker while `waiting` and does not move `awaiting_human_pr`. `status`, `task-list`, and `worker-show` are observation while `waiting`. They do not stand in for `check`. A flagged live spawn that throws does not move this loop. A parsed live result advances the same states and still does not move `awaiting_human_pr` by itself. The coordinator’s default adapter stays on dry-run. The Harness `dig` tool stays on dry-run unless the operator set `OPC_ORCA_LIVE=1` and plugin config `live` is not false. A tool caller `live: true` does not turn live on. `config.live: false` forces dry-run even when the env var is `1`. The local procedure is [local test](local-test.md): dry-run first (`npm run smoke:local`), then live only with `OPC_ORCA_LIVE=1` and `--live`. Both the easy goal and the normal goal stop at `awaiting_human_pr` once a verdict is recorded. The dig tool itself returns before that ask. Nothing in the smoke opens a pull request.
