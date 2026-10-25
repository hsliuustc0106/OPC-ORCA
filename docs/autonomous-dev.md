# Autonomous development

The dig loop is automatic up to a **reviewable tip**. Public GitHub writes are not. v0 does not enable a merge queue, auto-merge, or a Bot that merges its own pull request.

Phase 0 of the GitHub side is report-only: [risk-tier.yml](../.github/workflows/risk-tier.yml) and [review-gate.yml](../.github/workflows/review-gate.yml) echo `Phase0` and set `continue-on-error`. They are not required checks. They do not label, comment, or merge. [risk-rules.json](../.github/agent/risk-rules.json) and [review-policy.json](../.github/agent/review-policy.json) are placeholders so a later phase has a file to fill. Nothing reads them to allow a merge.

## Auto to a tip

Given one goal, an agent (later, the coordinator) may:

1. Fetch `origin` and branch from `origin/main`.
2. Prove `git diff origin/main...HEAD --stat` lists only this goal’s files.
3. Change code, run `npm test`, and repeat.
4. Record one `Verdict:` for that tip SHA, with `Written-by:` on the next line ([AGENTS.md](../AGENTS.md)).

That stretch is the automatic dig. It stays on the local branch. Pushing the branch, opening a draft, editing the pull request, and merging are outside it.

A reviewable tip means all of:

- the diff stat proves the base
- verify (`npm test` today) was run at that SHA
- exactly one verdict names that SHA
- the writer is named

A `PASS` does not open a pull request. A green `Test` check does not either.

## Human gate: open, update, merge

The coordinator state `awaiting_human_pr` is the stop. The loop asks the human which action they allow. Each action is its own yes:

| Action | What the human is allowing | What v0 does with a yes |
| --- | --- | --- |
| `open` | Create the pull request, draft included | Records the decision. Does not call GitHub. |
| `update` | Push new commits, or change the title or body | Records the decision. Does not push. |
| `merge` | Merge the pull request | Records the decision. Does not merge. |

A no ends the cycle the same way: the decision is stored, `state` becomes `done`, and no GitHub write runs. `done` is not “merged”.

There is no standing approval that skips this gate. There is no path where the worker that wrote the tip also merges it.

## How this differs from FlyBot

[FlyBot](https://github.com/ThinkFlowLab/FlyBot) is the pattern for the pipeline shape: one issue, one branch from fetched `origin/main`, prove the diff stat, one verdict per tip, `Written-by` on state-changing notes, and a DSH plugin installed with `dsh plugin add github:…#ref&path:…`. OPC-ORCA does not vendor FlyBot’s tree or social plugins.

FlyBot’s later stages are deliberately not copied:

| FlyBot | OPC-ORCA |
| --- | --- |
| Chief takes the request | Coordinator `intake` |
| Triage marks `agent-ready` | Coordinator `triage` (`agentReady` or stop) |
| Dev, in the bot tree | Orca worker. Default **dsh** + **new-child** worktree. Easy tasks never dispatch: coordinator-direct. |
| Reviewer writes one `Verdict` at the tip | Same rule, stored by the coordinator in v0. Not posted to GitHub yet. |
| T0–T3 risk gate, then merge queue, and the gating Bot may auto-merge | Not enabled. Tiers are an unused placeholder. The human PR gate replaces enqueue and merge. |
| `merge_group` re-tests the merge tree | No `merge_group` trigger. Do not add one until a human turns a queue on. |

FlyBot roles collapse onto two processes here: the **coordinator** (intake, triage, plan, the easy path, the stop) and **Orca** (run, task, dispatch, check). A separate reviewer name still has to appear on `Written-by` when a verdict is recorded. The coordinator-direct path does not get to verdict its own tip; the verdict type requires a writer, and the agent rules forbid the implementer from being that writer.

## Phase 0 workflows

`Test` ([test.yml](../.github/workflows/test.yml)) checks out the repo, checks Node.js ≥ 22.19, and runs `npm test` when a test script exists. That is the only check this scaffold expects to go green.

`Risk tier` and `Review gate` print `Phase0` and succeed even if a later step is red (`continue-on-error`). They must stay out of branch protection. They use the default token only if a future edit adds a checkout; the stub jobs do not check out the pull request and do not run its code.

## Not in this phase

- Spawn of `orca` / `orca-ide` that creates a run
- `gh pr create`, `gh pr edit`, `git push`, `gh pr merge`
- Auto-merge, merge queue, required `merge-gate`
- A reviewer login list that grants merge rights (the policy file is empty on purpose)
