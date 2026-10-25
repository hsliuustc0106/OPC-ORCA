/**
 * What is still unwired after dry-run dispatch.
 * Normal tasks already call the adapter for run-create, task-create, and
 * worker-start when `dryRun` is set. A thrown adapter error is failure,
 * not a converged tip. Do not treat a stub throw as success.
 */
export const WIRE_ADAPTER_TODO =
  'TODO(wire-adapter): normal-task run-create, task-create, and worker-start ' +
  'call @opc-orca/orca-adapter in dryRun and record the plan (dsh, new-child). ' +
  'They do not spawn, and they do not invent a run id. ' +
  'Without dryRun the adapter throws not-configured until `orca` (Linux: `orca-ide`) ' +
  'is on PATH, or not-implemented when the binary is present, and that throw is failure, ' +
  'not a converged tip. ' +
  'Still unwired: status, task-list, worker-show, worker-release, check, reply, ' +
  'gate-create, gate-resolve. ' +
  'Easy tasks stay on the coordinator-direct path and skip worker dispatch. ' +
  'awaiting_human_pr stops the loop: do not open, update, or merge a pull request here. ' +
  'Orca gate-resolve is not a substitute for the human PR yes.'
