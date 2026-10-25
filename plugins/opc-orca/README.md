# @opc-orca/plugin

DSH plugin for OPC-ORCA. DeepSeek Harness is the entrance; this plugin is the piece Harness loads. It registers one tool, `dig`: a goal goes in, the coordinator runs, and a status summary comes out. The default is dry-run. Live spawn is operator-owned. It runs only when `OPC_ORCA_LIVE=1` and this plugin's config `live` is not `false`. A tool caller passing `live: true` does not grant spawn. `config.live: true` does not replace the env var. `live: false` from the caller or from config forces dry-run. The tool stops before the human PR gate. It does not open, update, or merge a pull request.

The operator procedure on a Mac (Orca desktop, dry-run, then live) is [local test](../../docs/local-test.md). CLI flag names to confirm during that run are in [`packages/orca-adapter/src/cli.ts`](../../packages/orca-adapter/src/cli.ts).

The install line matches the [FlyBot](https://github.com/ThinkFlowLab/FlyBot) `dsh plugin add` form (`github:<owner>/<repo>#<ref>&path:<dir>`). It is a placeholder until the scaffold is on `main`. Installing it before that either fails or loads a repo that has no plugin.

## Install (later, from `main`)

Needs Node.js 22.19+ and pnpm for DSH Web. Install [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) first and set up one model there.

**DSH Web**

```sh
npx -y @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add "github:hsliuustc0106/OPC-ORCA#main&path:/plugins/opc-orca"
npx -y @deepseek-ai/dsh@0.2.0-rc.2 web
```

**DSH Desktop (Windows, macOS)**

1. Sidebar **Plugins** → **Add plugin**.
2. In **Package name or address**, paste:

   ```
   github:hsliuustc0106/OPC-ORCA#main&path:/plugins/opc-orca
   ```

3. **Install**, then **Enable now**. If Harness says the change applies at the next start, quit it and open it again.

There is no client bundle and no `cordis.patch.yml` in v0, so enabling the stub should only load `index.js`.

## What loading does

`apply` registers `dig` on `ctx.tools` and logs `opc-orca: dig tool registered`. The disposer unregisters that tool when the host returns a disposer from `register`. It does not read `~/.dsh` and it does not talk to GitHub. A dry-run call does not spawn `orca`. A call with `live: true` also stays on dry-run when `OPC_ORCA_LIVE` is unset, and when config `live` is `false` even if the env var is `1`. The tool calls `@opc-orca/coordinator` in this repo, so `npm test` loads the workspace. A `dsh plugin add` of this directory alone does not vendor that package; the install check is the local runbook.

Design: [architecture](../../docs/architecture.md), [coordinator workflow](../../docs/coordinator-workflow.md).
