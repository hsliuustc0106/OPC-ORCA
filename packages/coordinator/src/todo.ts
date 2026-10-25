/**
 * What is still unwired after dry-run dispatch, the waiting-loop check, and
 * observation. Normal tasks call the adapter for run-create, task-create,
 * worker-start, and check when `dryRun` is set. While waiting they may also
 * call status, task-list, and worker-show in dryRun. A thrown adapter error
 * is failure, not a converged tip and not a successful observation. Do not
 * treat a stub throw as success. Observation is not a substitute for check.
 */
export const WIRE_ADAPTER_TODO =
  'TODO(wire-adapter): normal-task run-create, task-create, and worker-start ' +
  'call @opc-orca/orca-adapter in dryRun and record the plan (dsh, new-child). ' +
  'The waiting loop calls check in dryRun and records that plan (the caller ' +
  'converged flag, no run id). ' +
  'While waiting, status, task-list, and worker-show may be called in dryRun ' +
  'and record that plan (no run id, task id, worker id, or status payload). ' +
  'Those observation plans do not converge and are not a substitute for check. ' +
  'They do not spawn, and they do not invent a run id. ' +
  'Without dryRun the adapter throws not-configured until `orca` (Linux: `orca-ide`) ' +
  'is on PATH, or not-implemented when the binary is present, and that throw is failure, ' +
  'not a converged tip. ' +
  'Still unwired: worker-release, reply, gate-create, gate-resolve. ' +
  'Easy tasks stay on the coordinator-direct path and skip worker dispatch. ' +
  'awaiting_human_pr stops the loop: do not open, update, or merge a pull request here. ' +
  'Orca gate-resolve is not a substitute for the human PR yes.'
