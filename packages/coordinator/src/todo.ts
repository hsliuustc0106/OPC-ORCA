/**
 * What is still unwired after dry-run dispatch, the waiting-loop check,
 * observation, reply, worker-release, backend gates, and consumption of a
 * parsed live result. Normal tasks call the adapter for run-create,
 * task-create, worker-start, and check when `dryRun` is set. While waiting
 * they may also call status, task-list, worker-show, reply, gate-create,
 * and gate-resolve in dryRun. After converging, the Orca worker path may
 * call worker-release in dryRun. A thrown adapter error is failure, not a
 * converged tip, not a successful observation, not a worker answer, not a
 * released worker, and not a created or resolved backend gate. Do not treat
 * a stub throw as success. Observation is not a substitute for check. Reply
 * is not the human PR yes and does not move awaiting_human_pr. gate-create
 * and gate-resolve are Orca backend gates for a worker or task decision.
 * They stay on waiting and do not move awaiting_human_pr. Live spawn is
 * wired behind the operator switch and fails closed. A dig caller `live:
 * true` does not grant it: `config.live` false, or `OPC_ORCA_LIVE` unset,
 * keeps that dig on dry-run. The adapter `live` option is the mechanism
 * `runDig` sets only after that check. The loop stores a parsed live result
 * and advances on that parse. A throw does not advance state. CLI
 * subcommands and flag names are listed in `packages/orca-adapter/src/cli.ts`
 * for the local run to confirm. The loop still stops at awaiting_human_pr.
 */
export const WIRE_ADAPTER_TODO =
  'TODO(wire-adapter): normal-task run-create, task-create, and worker-start ' +
  'call @opc-orca/orca-adapter in dryRun and record the plan (dsh, new-child). ' +
  'The waiting loop calls check in dryRun and records that plan (the caller ' +
  'converged flag, no run id). ' +
  'While waiting, status, task-list, and worker-show may be called in dryRun ' +
  'and record that plan (no run id, task id, worker id, or status payload). ' +
  'Those observation plans do not converge and are not a substitute for check. ' +
  'While waiting, reply may be called in dryRun and records the answer text ' +
  '(no run id, message id, or exit code). Reply stays on waiting. It is a ' +
  'worker-side answer and is not the human PR yes, and it does not move ' +
  'awaiting_human_pr. ' +
  'While waiting, gate-create and gate-resolve may be called in dryRun. ' +
  'gate-create records the reason and no run id or gate id. gate-resolve ' +
  'records the resolution and no gate id or exit code. They are Orca backend ' +
  'gates for a worker or task decision. They stay on waiting. They are not ' +
  'the human PR yes, and they do not move awaiting_human_pr. ' +
  'After converging, worker-release may be called in dryRun and records that ' +
  'plan (no worker id). It does not open, update, or merge a pull request. ' +
  'They do not spawn, and they do not invent a run id, a gate id, or an exit code. ' +
  'Without dryRun and without OPC_ORCA_LIVE=1 (or the live option), the adapter throws not-configured until `orca` (Linux: `orca-ide`) ' +
  'is on PATH, or not-implemented when the binary is present and nothing is spawned. That throw is failure, ' +
  'not a converged tip, not a successful reply or release, and not a resolved gate. ' +
  'With the live flag, the adapter spawns the binary and parses stdout for ids. ' +
  'A missing binary, a non-zero exit, and unparseable stdout throw and are failure, ' +
  'and that throw does not advance the coordinator. ' +
  'A parsed live result (run id, task id, worker id, status, converged) is stored and advances state. ' +
  'Dry-run plans stay free of those ids. ' +
  'A dig tool caller live: true does not grant spawn. config.live false, or OPC_ORCA_LIVE unset, keeps that dig on dry-run. ' +
  'CLI subcommands and flag names are listed in packages/orca-adapter/src/cli.ts for the local run to confirm. ' +
  'The loop still stops at awaiting_human_pr: do not open, update, or merge a pull request here. ' +
  'Easy tasks stay on the coordinator-direct path and skip worker dispatch. ' +
  'Orca gate-resolve is not a substitute for the human PR yes.'
