# LESSONS.md

Dated lessons from real OPC-ORCA work. Read the open list before coding. Do not paste another project’s incident log into this file. [FlyBot](https://github.com/ThinkFlowLab/FlyBot) lessons are theirs; if the same class of mistake happens here, write an OPC-ORCA lesson in your own words.

## How to write

1. Skim every open lesson before a change. Treat them as constraints until they are retired.
2. When something bites, add or bump a lesson the same day. Date it `YYYY-MM-DD`.
3. Keep the body short: **Seen**, **Trigger**, **Wrong**, **Right**.
4. The first write-up is `Seen 1×`. Increment `Seen` when it happens again.
5. Retire a lesson by deleting it once the durable rule lives in [AGENTS.md](AGENTS.md) or a doc and the code matches. Leave a one-line “Retired → …” stub only if a reader would otherwise repeat the mistake.

## Open lessons

### 2026-10-25 — A colon in a plain `run:` step fails the workflow with 0 jobs

Seen 1×

**Seen:** `risk-tier.yml` and `review-gate.yml` failed on push before any job started. The annotation was an invalid workflow file at the `echo` line.

**Trigger:** `run: echo "Phase0 report-only: ..."` The value is a plain scalar, so the quotes do not protect the colon-space.

**Wrong:** Reading that as a failed step, or quoting only the message.

**Right:** Put the script under `run: |`. Trigger these Phase 0 workflows on push and pull request so a valid file is a no-op success. Keep them report-only: `continue-on-error`, no `merge_group`, not a required check.
