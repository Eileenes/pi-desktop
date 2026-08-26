# Pi Desktop

`apps/desktop` is the Electron desktop client for Pi. It embeds the existing
Coding Agent SDK; it does not start a shell process or duplicate agent logic.

## Current scope

- Choose a local workspace and keep its session history under Electron user data.
- Keep a workspace untrusted by default. Trust is persisted as a SHA-256 hash of
  the resolved workspace path, never the raw path.
- Allow the built-in read, search, shell, and file-edit tools only after trust.
  Each individual tool invocation needs a separate desktop approval.
- Configure API-key providers through a one-prompt-at-a-time bridge for secret,
  text, selection, and manual-code fields. Credentials use the Coding Agent
  runtime's private `auth.json` store; the renderer never receives stored keys.
- Isolate the renderer with `contextIsolation`, sandboxing, a narrow preload API,
  and a local-only content security policy.

The model configuration UI supports API-key and OAuth authentication, provider
logout, custom providers, model discovery, and live model connection tests. OAuth
credentials remain in the runtime's private `auth.json` store.

The settings UI checks the official GitHub release, opens a user-data
`custom.css` file, controls window-close and notification behavior, and shows the
installed version. Signed in-app installation is intentionally deferred until a
desktop packaging and signing pipeline exists.

## Develop

From the repository root:

```sh
npm install
npm run build
npm run start --workspace=@earendil-works/pi-desktop
```

The root build compiles the Coding Agent SDK before the Electron main process.
The desktop process then loads `apps/desktop/dist/main` and the Vite renderer
from `apps/desktop/dist/renderer`.

Run the desktop checks without invoking the full monorepo suite:

```sh
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run \
  test/contracts.test.ts test/authentication-prompt-queue.test.ts \
  test/tool-approval-queue.test.ts test/workspace-trust-store.test.ts
npm run check --workspace=@earendil-works/pi-desktop
```

Run the tests from `apps/desktop`; run the check from the repository root.

## Implementation map

| Area | Files | Responsibility |
| --- | --- | --- |
| Main process | `src/main/desktop-agent-host.ts` | SDK session lifecycle, workspace trust, model runtime, and approval hook |
| Main process | `src/main/workspace-trust-store.ts` | Hashed trust persistence with restrictive file permissions |
| Main process | `src/main/tool-approval-queue.ts` | One-time, expiring decisions for tool calls |
| Boundary | `src/shared/contracts.ts`, `src/preload/index.cts` | Validated IPC contracts and the only renderer capability surface |
| Renderer | `src/renderer/` | Workspace, authentication, approval, transcript, and prompt interface |

## Remaining release work

Select an installer pipeline (Electron Forge or electron-builder), configure
signing/notarization, then produce macOS, Windows, and Linux release artifacts in
CI. This is also required before enabling signed download/install/restart updates.

Security-relevant trust, tool approval, denial, authentication, and logout events
are recorded as metadata-only JSON lines in `security-audit.jsonl` under the
Electron user-data agent directory. Credentials and tool inputs are never logged.
