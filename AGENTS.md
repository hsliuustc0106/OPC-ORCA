# AGENTS.md

Instructions for coding agents in this repository. The pipeline is the [FlyBot](https://github.com/ThinkFlowLab/FlyBot) contract adapted for Orca. FlyBot’s tree and Bot Social plugins are not part of this repo; do not copy them. Patterns we keep are named below. Patterns we refuse (live merge queue, auto-merge, a Bot merging its own pull request) are named too.

## Before you code

1. Read [LESSONS.md](LESSONS.md). Open lessons are constraints. The list may be empty.
2. Read [docs/autonomous-dev.md](docs/autonomous-dev.md) and [docs/coordinator-workflow.md](docs/coordinator-workflow.md).
3. Keep the hard rules. Do not invent a successful Orca call. Do not open, update, or merge a pull request unless a human has said yes for that action.

## Pipeline contract

One goal or one issue → one branch from the fetched `origin/main` → prove the diff → verify → dig automatically to a reviewable tip → **stop**. A human says yes before a draft is opened, before that pull request is updated, and before it is merged.

Default worker, once Orca dispatch is real: **dsh** in a **new-child worktree**. Easy tasks skip that dispatch and stay on the coordinator-direct path ([coordinator workflow](docs/coordinator-workflow.md)).

1. **One goal.** One issue or one stated goal per session and per git worktree.
2. **Branch from the live base, and prove it.** `git fetch origin && git switch -c <branch> origin/main`. Never branch from a local `main` you did not just fetch. Before you treat the branch as yours, run:

   ```sh
   git diff origin/main...HEAD --stat
   ```

   The stat must list only files this goal changed. Any other file means the branch sits on an older `main`: delete the branch and start again from the fetched tip. Do not hand-fix the extra files. This is the FlyBot stale-base rule, kept because a green pull request page does not show a silent revert of `main`.
3. **Verify** what this repo actually has. Today that is `npm test` (Node.js 22.19+). Do not claim a check you did not run.
4. **Dig to a tip.** The coordinator may keep working the branch until the tip is reviewable: the diff proves the base, verify has been run, and the tip carries one verdict (below). That automatic stretch is local. It does not push, open, edit, or merge a pull request.
5. **Stop at the human PR gate.** State `awaiting_human_pr`. Ask before any of these public GitHub writes:
   - **open** — create the pull request, including a draft
   - **update** — push new commits onto that pull request, or edit its title or body
   - **merge** — merge it, by any method
6. **Draft, then still ask.** After a human allows **open**, the pull request is a draft. Further commits toward the tip still need a human **update** before they are pushed. **Merge** is a separate yes. Nothing in this repo enables a merge queue or auto-merge. Do not add those workflows.
7. **Hand off** when the goal is unclear, the change touches secrets or permissions, or you cannot get a green tip.

## Written-by, and one Verdict per tip

Every state-changing note about a tip (the ask to a human, a review comment once comments exist) names the writer. The verdict block is the exception to “first line is Written-by”, same shape as FlyBot, so a later parser can find it:

```
Verdict: PASS at <sha>
Written-by: Reviewer
```

`PASS`, `FAIL`, and `INC` are the only outcomes. Rules:

- One `Verdict:` per tip SHA. A second verdict on the same SHA is an incident, not a better answer.
- A new commit is a new tip. It voids the previous verdict. The replacement is the single verdict for the new SHA.
- A correction that does not judge the tip says `Correction from <name>:` and carries no `Verdict:` line.
- The implementer does not write the verdict for their own tip. `Written-by` is required. A missing name is not a verdict.
- A verdict is evidence for the human. It is not permission to open, update, or merge.

The coordinator stub enforces one verdict per SHA and a non-empty `Written-by`. It does not post either line to GitHub.

## Hard rules

1. **Harness is the entrance.** Product code talks to DeepSeek Harness through the plugin API. Do not patch a Harness install.
2. **Orca is the backend.** Run, Task, and Dispatch go through `packages/orca-adapter`. The adapter spawns `orca` when a later change wires it (on Linux the binary may be `orca-ide`). A dry-run records the planned `run-create`, `task-create`, `worker-start`, `check`, `status`, `task-list`, `worker-show`, `reply`, `worker-release`, `gate-create`, and `gate-resolve` and does not need the binary. Observation plans are not convergence. `reply` is a worker-side answer and is not the human PR yes. `gate-create` and `gate-resolve` are Orca backend gates for a worker or task decision. They are not the human PR yes and do not move `awaiting_human_pr`. A live call throws `not-configured` or `not-implemented`. Wrappers never return a made-up run id, task id, worker id, message id, gate id, status payload, or exit 0.
3. **No public GitHub write without a human yes** for that action (open, update, or merge). A chat message, a green check, or a `Verdict: PASS` is not that yes.
4. **No merge queue and no auto-merge.** Do not add `merge_group` triggers, required merge checks, or `gh pr merge`.
5. **No secrets** in the repo, the logs, or the prompt. Do not print tokens.
6. **Do not copy** FlyBot `plugins/tree`, `plugins/social`, or Bot Social. Refer to those designs in docs only.
7. **Phase 0 risk and review files are report-only.** `.github/agent/risk-rules.json` and `review-policy.json` do not block, label, or merge. Do not treat an empty reviewer list as an allow.

## Commands

```sh
npm ci
npm test
```

`npm test` runs `tsc --noEmit` and the node tests. There is no separate linter in v0.

## Layout

- `plugins/opc-orca/` — DSH plugin stub (`@opc-orca/plugin`). No tools.
- `packages/coordinator/` — dig-loop state machine. Normal tasks drive the adapter in dry-run. Stops in `awaiting_human_pr`.
- `packages/orca-adapter/` — typed Orca CLI surface. Dry-run records a plan. Otherwise throws `not-configured` or refuses to spawn.
- `docs/` — architecture, the human gate, the coordinator steps.
- `.github/workflows/test.yml` — the check that should stay green.
- `.github/workflows/risk-tier.yml`, `review-gate.yml` — Phase 0 echoes. `continue-on-error`. Not required.
- `.github/agent/` — placeholder tier and review policy. Not enforced.
- `changelog.d/` — fragment convention. No release automation.

## Style

Match the file you are editing. Keep stubs small. Comment a constraint the code cannot say by itself (no fake Orca success, the human gate, the adapter TODO). Commit messages: imperative English, reason in the body.
