/**
 * What is still unwired after dry-run dispatch, the waiting-loop check,
 * observation, reply, and worker-release. Normal tasks call the adapter for
 * run-create, task-create, worker-start, and check when `dryRun` is set.
 * While waiting they may also call status, task-list, worker-show, and reply
 * in dryRun. After converging, the Orca worker path may call worker-release
 * in dryRun. A thrown adapter error is failure, not a converged tip, not a
 * successful observation, not a worker answer, and not a released worker.
 * Do not treat a stub throw as success. Observation is not a substitute for
 * check. Reply is not the human PR yes and does not move awaiting_human_pr.
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
  'After converging, worker-release may be called in dryRun and records that ' +
  'plan (no worker id). It does not open, update, or merge a pull request. ' +
  'They do not spawn, and they do not invent a run id. ' +
  'Without dryRun the adapter throws not-configured until `orca` (Linux: `orca-ide`) ' +
  'is on PATH, or not-implemented when the binary is present, and that throw is failure, ' +
  'not a converged tip and not a successful reply or release. ' +
  'Still unwired: gate-create, gate-resolve. ' +
  'Easy tasks stay on the coordinator-direct path and skip worker dispatch. ' +
  'awaiting_human_pr stops the loop: do not open, update, or merge a pull request here. ' +
  'Orca gate-resolve is not a substitute for the human PR yes.'
