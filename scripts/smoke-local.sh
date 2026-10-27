#!/bin/sh
# Dry-run dig on this machine, then an optional live dig.
# Live runs only when --live is passed and OPC_ORCA_LIVE=1.
# See docs/local-test.md. This script does not open a pull request.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

live=0
for arg in "$@"; do
  case "$arg" in
    --live) live=1 ;;
    *)
      echo "FAIL: unknown argument: $arg"
      exit 1
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "FAIL: node is not on PATH"
  exit 1
fi

node -e 'const [maj,min]=process.versions.node.split(".").map(Number); if (!(maj>22 || (maj===22 && min>=19))) { console.error("FAIL: Node >=22.19 required, got "+process.version); process.exit(1) } console.log("PASS: node "+process.version)'

have_orca=0
orca_path=""
if command -v orca >/dev/null 2>&1; then
  have_orca=1
  orca_path=$(command -v orca)
elif [ "$(uname -s)" = "Linux" ] && command -v orca-ide >/dev/null 2>&1; then
  have_orca=1
  orca_path=$(command -v orca-ide)
fi

if [ "$have_orca" -eq 0 ]; then
  echo "WARN: orca CLI not on PATH (looked for orca; on Linux also orca-ide). Dry-run does not need it."
else
  echo "NOTE: orca CLI found at $orca_path (dry-run will not spawn it)"
fi

run_smoke() {
  SMOKE_MODE=$1 node --experimental-strip-types --input-type=module <<'EOF'
import { createOrcaAdapter, ORCA_DESKTOP_AGENTS, ORCA_WORKER_SETUPS } from '@opc-orca/orca-adapter'
import { createDigLoop, runDig } from '@opc-orca/coordinator'

const repo = 'hsliuustc0106/OPC-ORCA'
const mode = process.env.SMOKE_MODE === 'live' ? 'live' : 'dry'

function pass(message) {
  console.log(`PASS: ${message}`)
}

function assertOk(condition, message) {
  if (!condition) throw new Error(message)
}

async function stopAtHuman(difficulty) {
  const adapter = createOrcaAdapter({ dryRun: true, env: { PATH: '' }, platform: process.platform })
  const loop = createDigLoop({
    adapter,
    repo: difficulty === 'normal' ? repo : undefined,
  })
  const goal = difficulty === 'easy' ? 'Fix a typo in the readme' : 'Record the local smoke'
  loop.acceptGoal(goal)
  loop.triage({ agentReady: true, difficulty })
  if (difficulty === 'easy') {
    loop.runDirect()
  } else {
    await loop.bindRun()
    await loop.startWorker()
    await loop.check({ converged: true })
  }
  const sha = 'smoke-local'
  loop.askHumanPr({
    sha,
    verdict: { outcome: 'PASS', sha, writtenBy: 'Smoke' },
  })
  const snap = loop.snapshot()
  assertOk(snap.state === 'awaiting_human_pr', `${difficulty} stopped at ${snap.state}`)
  assertOk(snap.githubWritePerformed === false, `${difficulty} wrote to GitHub`)
  assertOk(snap.humanDecision === null, `${difficulty} recorded a human decision`)
  assertOk(snap.verdict?.writtenBy === 'Smoke', `${difficulty} verdict writer`)
  if (difficulty === 'normal') {
    assertOk(snap.path === 'orca-worker', 'normal stop path')
    assertOk(snap.intents[0]?.args.runId === undefined, 'dry-run stop invented a run id')
  } else {
    assertOk(snap.path === 'coordinator-direct', 'easy stop path')
  }
  pass(`${difficulty} stop awaiting_human_pr`)
}

async function dry() {
  const dryEnv = { PATH: '' }
  const easy = await runDig({
    goal: 'Fix a typo in the readme',
    env: dryEnv,
    platform: process.platform,
  })
  assertOk(easy.live === false, 'easy dry-run reported live')
  assertOk(easy.state === 'converging', `easy state ${easy.state}`)
  assertOk(easy.path === 'coordinator-direct', `easy path ${easy.path}`)
  assertOk(easy.githubWritePerformed === false, 'easy wrote to GitHub')
  assertOk(easy.humanDecision === null, 'easy recorded a human decision')
  pass('dry-run easy converging githubWritePerformed=false')

  const normal = await runDig({
    goal: 'Record the local smoke',
    repo,
    env: dryEnv,
    platform: process.platform,
  })
  assertOk(normal.live === false, 'normal dry-run reported live')
  assertOk(normal.state === 'waiting', `normal state ${normal.state}`)
  assertOk(normal.path === 'orca-worker', `normal path ${normal.path}`)
  assertOk(normal.githubWritePerformed === false, 'normal wrote to GitHub')
  assertOk(normal.intents[0]?.args.runId === undefined, 'dry-run invented a run id')
  assertOk(
    normal.intents.map((intent) => intent.command).join(',') === 'run-create,task-create,worker-start,check',
    'normal dry-run intents',
  )
  pass('dry-run normal waiting githubWritePerformed=false')

  const caller = await runDig({
    goal: 'Caller live must stay dry',
    repo,
    live: true,
    env: dryEnv,
    platform: process.platform,
  })
  assertOk(caller.live === false, 'caller live:true enabled live')
  assertOk(caller.state === 'waiting', `caller-live state ${caller.state}`)
  assertOk(caller.githubWritePerformed === false, 'caller live wrote to GitHub')
  pass('caller live:true stayed dry-run')

  await stopAtHuman('easy')
  await stopAtHuman('normal')
  pass('smoke-local dry-run')
}

function operatorValue(name) {
  const raw = process.env[name]
  if (typeof raw !== 'string') return ''
  return raw.trim()
}

async function live() {
  if (process.env.OPC_ORCA_LIVE !== '1') {
    throw new Error('live mode requires OPC_ORCA_LIVE=1')
  }
  const handle = operatorValue('ORCA_TERMINAL_HANDLE')
  const agent = operatorValue('OPC_ORCA_AGENT')
  const setup = operatorValue('OPC_ORCA_SETUP')
  const liveEnv = { PATH: process.env.PATH ?? '', OPC_ORCA_LIVE: '1' }
  if (handle) liveEnv.ORCA_TERMINAL_HANDLE = handle
  if (agent) liveEnv.OPC_ORCA_AGENT = agent
  if (setup) liveEnv.OPC_ORCA_SETUP = setup
  const easy = await runDig({
    goal: 'Fix a typo in the readme',
    live: true,
    env: liveEnv,
    platform: process.platform,
  })
  assertOk(easy.live === true, 'easy live stayed dry')
  assertOk(easy.state === 'converging', `easy live state ${easy.state}`)
  assertOk(easy.path === 'coordinator-direct', 'easy live path')
  assertOk(easy.githubWritePerformed === false, 'easy live wrote to GitHub')
  pass('live easy converging githubWritePerformed=false')

  if (!handle) {
    console.log(
      'SKIP: live normal dig needs a coordinator terminal handle. ' +
        'Export ORCA_TERMINAL_HANDLE (orca terminal create in a registered worktree prints ' +
        '"Created terminal term_…"), or run this smoke from an Orca terminal where that variable is already set. ' +
        'Refusing to invent a handle. Live normal was not spawned.',
    )
    return
  }

  if (!agent) {
    console.log(
      'SKIP: live normal dig needs a desktop agent id. ' +
        `Export OPC_ORCA_AGENT to one of ${ORCA_DESKTOP_AGENTS.join(', ')}. ` +
        'Refusing to pass dsh or invent one. Live normal was not spawned.',
    )
    return
  }
  if (!ORCA_DESKTOP_AGENTS.includes(agent)) {
    throw new Error('OPC_ORCA_AGENT is not an Orca desktop agent id. Refusing to spawn.')
  }
  if (setup && !ORCA_WORKER_SETUPS.includes(setup)) {
    throw new Error('OPC_ORCA_SETUP must be run, skip, or inherit. Refusing to spawn.')
  }

  const normal = await runDig({
    goal: 'Record the local smoke',
    repo,
    live: true,
    env: liveEnv,
    platform: process.platform,
  })
  assertOk(normal.live === true, 'normal live stayed dry')
  assertOk(normal.path === 'orca-worker', 'normal live path')
  assertOk(normal.githubWritePerformed === false, 'normal live wrote to GitHub')
  assertOk(normal.state === 'waiting' || normal.state === 'converging', `normal live state ${normal.state}`)
  assertOk(normal.state !== 'awaiting_human_pr', 'live dig entered the human gate by itself')
  pass(`live normal ${normal.state} githubWritePerformed=false`)
  pass('smoke-local live')
}

try {
  if (mode === 'live') await live()
  else await dry()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`FAIL: ${message}`)
  process.exit(1)
}
EOF
}

run_smoke dry

if [ "$live" -eq 0 ]; then
  echo "NOTE: live dig skipped (pass --live with OPC_ORCA_LIVE=1 to run it)"
  exit 0
fi

if [ "${OPC_ORCA_LIVE:-}" != "1" ]; then
  echo "FAIL: --live requires OPC_ORCA_LIVE=1. Refusing to spawn."
  exit 1
fi

if [ "$have_orca" -eq 0 ]; then
  echo "FAIL: --live requires orca on PATH (on Linux, orca-ide is accepted)."
  exit 1
fi

echo "NOTE: starting live dig"
run_smoke live
