# Development Rules

- Keep changes focused on the Electron desktop application.
- Preserve context isolation, sandboxing, validated IPC contracts, workspace
  trust checks, per-tool approval, authentication prompt queues, and security
  audit logging.
- The desktop runtime consumes the exact published
  `@earendil-works/pi-coding-agent` version from npm. Do not add local Pi source
  path mappings or workspace dependencies.
- Use erasable TypeScript syntax. Avoid `any` unless required at an external
  boundary.
- Use top-level imports only; do not add dynamic imports for types.
- Pin direct npm dependencies to exact versions.
- After code changes run `npm run check`; after test changes run the relevant
  test file or `npm test`.
- Do not run `npm run build` or `npm test` unless requested; `npm run check`
  includes the production build and type checks.
- Do not commit generated `dist/` or `node_modules/` contents.
- Never commit unless explicitly requested.

## Repository layout

- `src/main`: Electron main process and runtime adapter
- `src/preload`: restricted renderer bridge
- `src/renderer`: React UI
- `src/shared`: IPC contracts
- `test`: regression tests
- `scripts`: build artifact validation
