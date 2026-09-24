# Contributing to Pi Desktop

## Development

Install dependencies without lifecycle scripts, then run the checks and tests:

```sh
npm install --ignore-scripts
npm run prepare   # installs the pre-commit hook (husky)
npm run check
npm test
```

The pre-commit hook runs `npm run check`, so a commit that fails the build or
type checks is refused. Skip it with `git commit --no-verify` only when you
know why it fails.

The project uses Electron, Vite, React, and the published
`@earendil-works/pi-coding-agent` package. Do not add imports or TypeScript
paths to a local Pi source checkout.

## Code quality

- Keep Electron main-process capabilities behind validated IPC contracts.
- Preserve context isolation, preload restrictions, workspace trust checks, and
  per-tool approval.
- Do not log credentials or tool inputs.
- Pin direct npm dependencies to exact versions.
- Use erasable TypeScript syntax and avoid `any` unless required by an external
  API boundary.
- Run `npm run check` after code changes and the relevant tests after test
  changes.

## Pull requests

Keep changes focused and explain security or permission-boundary changes in the
PR description. Do not commit generated `dist/` or `node_modules/` contents.

## Security reports

Do not open public issues for security-sensitive reports. Follow
[SECURITY.md](SECURITY.md) for private reporting instructions.
