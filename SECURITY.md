# Security Policy

Pi Desktop is a local Electron application. Its security boundary is built
around a restricted renderer and a privileged main process.

The renderer has no direct filesystem, process, or network capability. It
communicates through a narrow preload API. Workspace access requires explicit
trust, and each built-in tool invocation requires a separate approval. The
renderer may submit a new credential entered by the user, but stored credentials
are never returned to it. Credentials remain in main-process-owned storage.
Security audit events contain metadata only; credentials and tool inputs are not
logged.

## Reporting a vulnerability

Do not open a public issue for a security-sensitive report. Report privately by
emailing `security@earendil.com` or through GitHub Security Advisories. Include:

- A description and impact
- Reproduction steps or proof of concept
- Affected version or commit
- Known mitigations

## Scope

In scope are vulnerabilities that cross the Electron renderer/main-process
boundary, bypass workspace trust or tool approval, expose credentials, or
permit unintended filesystem, process, or network access through the desktop
application.

Out of scope are user-approved actions, malicious content in a workspace that
cannot cross the documented trust boundary, untrusted third-party plugins the
user explicitly installs, and vulnerabilities requiring prior control of the
user's machine or credentials.
