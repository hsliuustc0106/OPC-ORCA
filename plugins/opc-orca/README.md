# @opc-orca/plugin

DSH plugin stub for OPC-ORCA. DeepSeek Harness is the entrance; this plugin is the piece Harness loads. v0 registers no tools. It does not start Orca and it does not open pull requests.

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

`apply` logs `opc-orca: stub loaded; no tools registered` and returns a no-op disposer. It does not read `~/.dsh`, spawn `orca`, or talk to GitHub.

Design: [architecture](../../docs/architecture.md), [coordinator workflow](../../docs/coordinator-workflow.md).
