# Pi Desktop

[中文](#中文) · [English](#english)

Pi Desktop 是一个面向 [Pi](https://github.com/badlogic/pi-mono) 的独立 Electron 桌面客户端，为本地代码工作区提供完整的图形化 AI 编程体验。

Pi Desktop is an independent Electron desktop client for [Pi](https://github.com/badlogic/pi-mono), providing a complete graphical AI coding experience for local workspaces.

---

## 中文

### 项目简介

Pi Desktop 将 Pi 编程代理带到桌面环境中。你可以打开本地项目，与模型进行多轮对话，查看和管理会话，让代理读取项目文件、执行工具，并在清晰的授权边界内完成开发任务。

本项目直接使用 npm 上发布的 `@earendil-works/pi-coding-agent`，不依赖仓库内的 Pi 源码或本地路径映射。桌面应用基于 Electron、React、Vite 和 TypeScript 构建，目前主要发布 macOS 与 Windows 安装包。

### 主要功能

- 本地工作区选择、历史记录与持久化项目状态
- 工作区信任确认，未信任项目不会获得完整文件和执行能力
- 多轮会话、历史搜索、重命名、删除、分支、Fork 与统计
- 流式模型响应、思考过程、Markdown、代码高亮、KaTeX 与 Mermaid 渲染
- 图片附件、文件引用和会话引用
- 模型供应商、API Key 与 OAuth 配置
- 模型发现、模型范围过滤和连接测试
- 每次工具调用的独立审批与认证提示队列
- 文件浏览、文件预览、Git 变更和 Worktree 管理
- Skills 搜索、安装、启用、禁用与更新
- Plugins 安装、配置、启用、禁用与更新
- 中英文界面、明暗主题和自定义 CSS
- 系统托盘与窗口状态恢复
- 基于 GitHub Releases 的应用更新检查与 OTA 更新

### 安全设计

Pi Desktop 将高权限能力保留在 Electron 主进程中：

- Renderer 启用 Context Isolation 和 Sandbox
- Preload 只暴露受限、明确的能力接口
- IPC 输入通过共享契约进行校验
- 文件访问和工具执行受工作区信任状态约束
- 工具调用需要逐次审批
- 凭据、认证提示和退出登录操作由主进程处理
- 安全审计只记录必要元数据，不记录凭据和完整工具输入
- 更新源固定为本项目的 GitHub Releases

请只信任来源可靠的项目目录。项目中的说明、配置和扩展可能影响代理行为或触发工具执行。

### 下载与安装

请前往 [GitHub Releases](https://github.com/Eileenes/pi-desktop/releases) 下载最新版本。

- macOS：下载 `.dmg` 文件完成首次安装
- Windows：下载 NSIS `.exe` 安装程序

应用安装后会检查 GitHub Releases 中的新版本。更新下载完成后，可以重启应用完成安装。

> 当前未签名的测试构建可能触发 macOS Gatekeeper 或 Windows SmartScreen 提示。面向公开用户发布时，建议使用对应平台的代码签名和公证服务。

### 本地开发

环境要求：

- Node.js 22.19.0 或更高版本
- npm

安装依赖：

```sh
npm install
```

构建并启动桌面应用：

```sh
npm run start
```

运行项目检查：

```sh
npm run check
```

运行测试：

```sh
npm test
```

### 打包

```sh
npm run package:mac
npm run package:win
```

安装包会输出到 `release/`。GitHub Actions 会在推送 `v*` 标签时分别构建 macOS 和 Windows 版本，并将产物发布到 GitHub Releases。

### 项目结构

```text
src/
├── main/       Electron 主进程、Pi Runtime 适配与高权限能力
├── preload/    受限的 Renderer 能力桥接
├── renderer/   React 界面与客户端状态
└── shared/     主进程与 Renderer 共用的 IPC 契约

test/           回归测试
scripts/        构建产物校验脚本
build/          应用图标等打包资源
```

### 致谢

特别感谢 [agegr/pi-web](https://github.com/agegr/pi-web) 项目。它为 Pi 的图形化交互和 Web 界面实践提供了宝贵的参考与启发。

同时感谢 Pi 及其生态中的所有贡献者。

---

## English

### About

Pi Desktop brings the Pi coding agent into a native desktop environment. It lets you open a local project, hold multi-turn conversations with AI models, manage sessions, inspect workspace files, and authorize agent tools through explicit security boundaries.

The application consumes the published `@earendil-works/pi-coding-agent` package from npm. It does not depend on a local Pi source checkout or local path mappings. Pi Desktop is built with Electron, React, Vite, and TypeScript, with macOS and Windows as the primary release platforms.

### Features

- Local workspace selection, history, and persisted project state
- Workspace trust confirmation before granting file and execution capabilities
- Multi-turn sessions with search, rename, delete, branching, forking, and statistics
- Streaming model responses, reasoning display, Markdown, syntax highlighting, KaTeX, and Mermaid
- Image attachments, file references, and session references
- Model provider, API key, and OAuth configuration
- Model discovery, model scope filtering, and connection tests
- Per-invocation tool approval and queued authentication prompts
- File browsing, file preview, Git changes, and Worktree management
- Skill discovery, installation, enable/disable controls, and updates
- Plugin installation, configuration, enable/disable controls, and updates
- Chinese and English interfaces, light/dark themes, and custom CSS
- System tray support and window state restoration
- Update checks and OTA updates through GitHub Releases

### Security model

High-privilege capabilities remain in the Electron main process:

- Context isolation and sandboxing are enabled for the renderer
- The preload layer exposes a narrow, explicit capability bridge
- IPC input is validated against shared contracts
- File access and tool execution are gated by workspace trust
- Tool invocations require individual approval
- Credentials, authentication prompts, and logout operations stay in the main process
- Security auditing records necessary metadata only, excluding credentials and full tool inputs
- The update source is fixed to this project's GitHub Releases

Only trust project directories from sources you recognize. Project instructions, configuration, and extensions may affect agent behavior or invoke tools.

### Download and installation

Download the latest release from [GitHub Releases](https://github.com/Eileenes/pi-desktop/releases).

- macOS: use the `.dmg` installer
- Windows: use the NSIS `.exe` installer

After installation, the app checks GitHub Releases for newer versions. Once an update has downloaded, restart the application to complete installation.

> Unsigned test builds may trigger macOS Gatekeeper or Windows SmartScreen warnings. Production releases should use platform-appropriate code signing and notarization.

### Development

Requirements:

- Node.js 22.19.0 or later
- npm

Install dependencies:

```sh
npm install
```

Build and start the desktop application:

```sh
npm run start
```

Run validation:

```sh
npm run check
```

Run tests:

```sh
npm test
```

### Packaging

```sh
npm run package:mac
npm run package:win
```

Installers are written to `release/`. When a `v*` tag is pushed, GitHub Actions builds the macOS and Windows packages and publishes the artifacts to GitHub Releases.

### Project structure

```text
src/
├── main/       Electron main process, Pi runtime adapter, and privileged capabilities
├── preload/    Restricted renderer capability bridge
├── renderer/   React UI and client-side state
└── shared/     Validated IPC contracts shared across processes

test/           Regression tests
scripts/        Build artifact validation
build/          Packaging assets such as the application icon
```

### Acknowledgements

Special thanks to [agegr/pi-web](https://github.com/agegr/pi-web). Its work on graphical and web-based interaction for Pi provided valuable reference and inspiration for this desktop client.

Thanks as well to Pi and everyone contributing to its ecosystem.

## License

See [LICENSE](LICENSE).
