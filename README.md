# Pi Desktop

[中文](#中文) · [English](#english) · [Website](https://eileenes.github.io/pi-desktop/)

独立的 [Pi](https://github.com/badlogic/pi-mono) Electron 桌面客户端。打开本地项目，在明确的授权边界里与模型多轮对话，让代理读文件、跑工具、改代码。

An independent Electron desktop client for [Pi](https://github.com/badlogic/pi-mono). Open a local project, talk to a model, and let the agent work inside explicit trust and approval boundaries.

**不是 IDE 插件，也不是另一套 Agent 运行时。** 本应用直接消费 npm 上发布的 `@earendil-works/pi-coding-agent`，不映射本地 Pi 源码。

This app consumes the published `@earendil-works/pi-coding-agent` package. It does not vendor Pi, patch it, or depend on a local source checkout.

[下载](https://github.com/Eileenes/pi-desktop/releases/latest) · [Releases](https://github.com/Eileenes/pi-desktop/releases) · [Security](SECURITY.md)

---

## 中文

### 这是什么

Pi Desktop 把官方 Pi 编程代理接到桌面窗口里。会话、工具、Skills、Plugins 的行为尽量跟 CLI Pi 一致；桌面端负责的是工作区、审批、终端、Git，以及一条收紧的安全边界。

当前版本 **0.1.21**。基于 Electron、React、Vite 和 TypeScript，主要发布 macOS 与 Windows 安装包。

```text
Renderer（沙箱，无 Node）
    │  校验过的 IPC 契约
Main process（特权）
    └── @earendil-works/pi-coding-agent
            工作区信任 · 逐次工具审批 · 凭据不出渲染进程
```

### 能做什么

**工作区**

- 打开本地项目，记住历史与项目状态
- 未信任的目录不会获得完整文件和执行能力
- 文件浏览与预览
- Git 变更、分支切换、Worktree 管理
- 内嵌终端（xterm.js + node-pty）

**会话**

- 多轮对话：搜索、重命名、删除、分支、Fork、统计
- 流式回复、思考过程
- Markdown、代码高亮、KaTeX、Mermaid
- 图片附件、文件引用、会话引用

**模型与扩展**

- 供应商、API Key、OAuth
- 模型发现、范围过滤、连接测试
- Skills 搜索、安装、启用、禁用、更新
- Plugins 安装、配置、启用、禁用、更新

**桌面**

- 中英文界面、明暗主题、自定义 CSS
- 系统托盘与窗口状态恢复
- 从本仓库 GitHub Releases 检查并安装更新

### 安全边界

高权限能力留在 Electron 主进程：

- Renderer 启用 Context Isolation 和 Sandbox
- Preload 只暴露受限、明确的能力接口
- IPC 输入通过共享契约校验
- 文件访问和工具执行受工作区信任约束
- 每次工具调用单独审批
- 凭据、认证提示、退出登录由主进程处理；渲染进程拿不到已存密钥
- 安全审计只记必要元数据，不记凭据和完整工具输入
- 更新源固定为本项目的 GitHub Releases

请只打开来源可靠的项目目录。项目说明、配置和扩展可能改变代理行为或触发工具执行。漏洞请按 [SECURITY.md](SECURITY.md) 私下报告，不要开公开 issue。

### 下载

前往 [GitHub Releases](https://github.com/Eileenes/pi-desktop/releases/latest)。

| 系统 | 安装包 |
| --- | --- |
| macOS | `.dmg` / `.zip` |
| Windows | NSIS `.exe` / `.zip` |

安装后应用会检查 Releases 中的新版本。下载完成后重启即可完成更新。

未签名的测试构建可能触发 Gatekeeper 或 SmartScreen。面向公开用户的发布应使用平台代码签名和公证。

### 本地开发

需要 Node.js **22.19.0** 或更高版本，以及 npm。

```sh
npm install
npm run start      # 构建并启动
npm run check      # 格式、构建、产物与类型检查
npm test
```

不要把本地 Pi 源码路径映射进本仓库。桌面端只使用已发布的 `@earendil-works/pi-coding-agent`。贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

### 打包

```sh
npm run package:mac
npm run package:win
```

产物在 `release/`。推送 `v*` 标签后，GitHub Actions 会分别构建 macOS 与 Windows 包并发布到 Releases。

### 项目结构

```text
src/
├── main/       Electron 主进程、Pi Runtime 适配、高权限能力
├── preload/    受限的 Renderer 能力桥接
├── renderer/   React 界面与客户端状态
└── shared/     主进程与 Renderer 共用的 IPC 契约

test/           回归测试
scripts/        构建产物校验
build/          应用图标
website/        GitHub Pages 站点
```

### 致谢

感谢 [agegr/pi-web](https://github.com/agegr/pi-web) 为 Pi 图形化交互提供的参考。感谢 Pi 及其生态中的贡献者。

---

## English

### What this is

Pi Desktop is a graphical shell for the official Pi coding agent. Sessions, tools, skills, and plugins stay as close to CLI Pi as possible. The desktop layer owns the workspace, approvals, the embedded terminal, Git, and a tight security boundary.

Current release **0.1.21**. Built with Electron, React, Vite, and TypeScript. Primary packages are macOS and Windows.

```text
Renderer (sandboxed, no Node)
    │  validated IPC contracts
Main process (privileged)
    └── @earendil-works/pi-coding-agent
            workspace trust · per-tool approval · credentials stay in main
```

### What you can do

**Workspace**

- Open a local project, with history and persisted project state
- Untrusted directories do not receive full file or execution access
- File browsing and preview
- Git changes, branch switching, and Worktree management
- Embedded terminal (xterm.js + node-pty)

**Sessions**

- Multi-turn chat with search, rename, delete, branching, fork, and statistics
- Streaming replies and reasoning
- Markdown, syntax highlighting, KaTeX, and Mermaid
- Image attachments, file references, and session references

**Models and extensions**

- Providers, API keys, and OAuth
- Model discovery, scope filtering, and connection tests
- Skill search, install, enable, disable, and update
- Plugin install, configuration, enable, disable, and update

**Desktop**

- Chinese and English UI, light and dark themes, custom CSS
- System tray and restored window state
- Update checks and installs from this repository's GitHub Releases

### Security boundary

High-privilege work stays in the Electron main process:

- Context isolation and sandboxing for the renderer
- A narrow, explicit preload bridge
- IPC input validated against shared contracts
- File access and tool execution gated by workspace trust
- Each tool invocation approved individually
- Credentials, authentication prompts, and logout handled in main; stored keys never return to the renderer
- Audit events record metadata only — not credentials or full tool inputs
- The update feed is this project's GitHub Releases

Only open project directories you trust. Project instructions, configuration, and extensions can change agent behavior or invoke tools. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Do not open a public issue.

### Download

Get the latest build from [GitHub Releases](https://github.com/Eileenes/pi-desktop/releases/latest).

| Platform | Package |
| --- | --- |
| macOS | `.dmg` / `.zip` |
| Windows | NSIS `.exe` / `.zip` |

After install, the app checks Releases for newer versions. Restart once a download finishes to apply it.

Unsigned test builds may trigger Gatekeeper or SmartScreen. Production releases should be signed and notarized.

### Development

Requires Node.js **22.19.0** or later, and npm.

```sh
npm install
npm run start      # build and launch
npm run check      # format, build, artifact, and type checks
npm test
```

Do not map a local Pi source tree into this repository. The desktop app uses only the published `@earendil-works/pi-coding-agent` package. See [CONTRIBUTING.md](CONTRIBUTING.md).

### Packaging

```sh
npm run package:mac
npm run package:win
```

Installers land in `release/`. Pushing a `v*` tag builds macOS and Windows packages on GitHub Actions and publishes them to Releases.

### Layout

```text
src/
├── main/       Electron main process, Pi runtime adapter, privileged work
├── preload/    Restricted renderer bridge
├── renderer/   React UI and client state
└── shared/     Validated IPC contracts

test/           Regression tests
scripts/        Build artifact checks
build/          App icons
website/        GitHub Pages site
```

### Acknowledgements

Thanks to [agegr/pi-web](https://github.com/agegr/pi-web) for its work on graphical Pi interaction, and to everyone in the Pi ecosystem.

## License

See [LICENSE](LICENSE).
