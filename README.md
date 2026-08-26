# Pi Desktop

An independent Electron desktop client for Pi, built with Vite and React.
The application consumes the published `@earendil-works/pi-coding-agent`
package from npm and does not depend on Pi source packages in this repository.

## Features

- Workspace selection with persisted trust checks.
- Per-invocation tool approval and security audit logging.
- Session browsing, branching, forking, and statistics.
- Provider API-key and OAuth setup through a protected IPC bridge.
- Model discovery and connection tests.
- Workspace files, Git changes, worktrees, skills, plugins, and custom CSS.
- Renderer isolation with context isolation, sandboxing, a narrow preload API,
  and a local-only content security policy.

## Development

```sh
npm install --ignore-scripts
npm run check
npm test
npm run start
```

Build artifacts are written to `dist/main` and `dist/renderer`.

## Project layout

```text
src/
├── main/       Electron main process and Pi runtime adapter
├── preload/    Narrow renderer capability bridge
├── renderer/   React application and UI state
└── shared/     Validated IPC contracts

test/           Main-process and contract regression tests
scripts/        Build artifact validation
```

The project intentionally uses Electron + Vite + React. It does not use Tauri,
Next.js, or a local checkout of the Pi runtime.

## Security boundary

The renderer never receives stored credentials or direct filesystem/process
access. Workspace trust, tool approvals, authentication prompts, and logout
operations stay in the main process. Metadata-only security events are written
to the Electron user-data directory; credentials and tool inputs are not logged.

## License

See [LICENSE](LICENSE).
