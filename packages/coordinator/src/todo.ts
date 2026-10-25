/**
 * Wiring point for a later change. The dig loop records intents only.
 * Do not make `createDigLoop` import the adapter until these calls exist
 * and a thrown adapter error is treated as failure, not as a converged tip.
 */
export const WIRE_ADAPTER_TODO =
  'TODO(wire-adapter): DigLoop only records intended Orca commands. ' +
  'Wire run_bound, dispatched, and the check loop to @opc-orca/orca-adapter ' +
  '(status, run-create, task-create, task-list, worker-start, worker-show, ' +
  'worker-release, check, reply, gate-create, gate-resolve). ' +
  'The adapter throws not-configured until `orca` (Linux: `orca-ide`) is on PATH, ' +
  'and it must not report success for a command it did not run. ' +
  'Easy tasks stay on the coordinator-direct path and skip worker dispatch. ' +
  'awaiting_human_pr stops the loop: do not open, update, or merge a pull request here. ' +
  'Orca gate-resolve is not a substitute for the human PR yes.'
