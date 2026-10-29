<div align="center">

# Pi Desktop

### 把项目、对话与编程代理，放进同一个桌面窗口。

基于 Pi 的独立 Electron 桌面客户端：打开本地项目，与模型对话，查看文件、运行工具、管理 Git 与终端。<br />
支持工作区信任与会话权限设置，让代理操作的范围清楚可见。

![Desktop](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6366F1?style=flat-square)
![Stack](https://img.shields.io/badge/stack-Electron%20%2B%20React-334155?style=flat-square)
![Node](https://img.shields.io/badge/Node.js-%E2%89%A522.19.0-339933?style=flat-square)
[![License](https://img.shields.io/badge/license-MIT-F59E0B?style=flat-square)](LICENSE)

**[下载安装](https://github.com/Eileenes/pi-desktop/releases)** · **[快速开始](#quick-start)** · **[权限说明](#permissions)** · **[项目网站](https://eileenes.github.io/pi-desktop/)** · **[English](#english)**

</div>

---

## 能做什么

| 项目与工具 | 对话与内容 | 模型与扩展 |
| --- | --- | --- |
| 打开本地项目、浏览和预览文件 | 流式回复、思考过程、会话搜索 | 配置模型供应商、API Key 或支持的 OAuth |
| 查看 Git 变更、切换分支、管理 Worktree | 重命名、删除、分支与 Fork 会话 | 模型发现、过滤与连接测试 |
| 内嵌终端（xterm.js + node-pty） | 图片附件、文件与会话引用 | Skills 搜索、安装、启停与更新 |
| 工作区信任、工具审批与权限切换 | Markdown、代码高亮、KaTeX 与 Mermaid | Plugins 安装、配置、启停与更新 |

桌面界面提供中英文、明暗主题、自定义 CSS、系统托盘与窗口状态恢复。代理运行时使用 npm 发布的 `@earendil-works/pi-coding-agent`，无需克隆或映射本地 Pi 源码。

**应用不附带模型账号或 API 额度。** 可用模型与认证方式取决于所配置的供应商；请求费用按对应服务计费。

<a id="quick-start"></a>

## 快速开始

### 1. 下载对应平台的安装包

前往 [GitHub Releases](https://github.com/Eileenes/pi-desktop/releases)，以该版本实际附件为准：

| 系统 | 包格式 | 选择说明 |
| --- | --- | --- |
| macOS | `.dmg` / `.zip` | 核对附件架构；`arm64` 用于 Apple 芯片 |
| Windows | NSIS `.exe` / `.zip` | 选择安装器或解压版 |
| Linux | `.AppImage` / `.deb` | AppImage 用于应用内自动更新；deb 可重新下载安装 |

应用提供从本仓库 Releases 检查、下载并应用更新的功能。具体安装和更新是否可用，取决于发行包、平台及签名配置；未签名构建可能触发系统提示，请核对来源及发行说明。

### 2. 配置模型并打开项目

1. 在模型设置中添加供应商，通过 API Key 或该供应商支持的登录方式完成认证。
2. 选择模型；需要时使用模型发现与连接测试确认配置。
3. 打开本地项目目录，阅读工作区信任提示后决定是否信任。
4. 发起一个具体任务，查看工具请求并按当前权限模式处理。

```text
先阅读这个项目，说明启动入口和目录结构。

检查当前 Git 变更，指出可能影响现有功能的地方。

帮我修改这个页面；改完后说明变更，并运行项目已有的相关检查。
```

工具能否运行还取决于项目依赖、本机环境和授予的权限。

<a id="permissions"></a>

## 权限与使用条件

| 模式 | 工具调用行为 | 适合场景 |
| --- | --- | --- |
| 逐次询问（`ask`，新会话默认） | 通过审批队列确认工具调用 | 首次打开项目、需要逐项确认操作 |
| 自动编辑（`autoEdit`） | 自动放行 `edit`、`write`、`str_replace`、`apply_patch`；其他工具仍需确认 | 已明确修改范围，希望减少编辑确认 |
| 完全访问（`full`） | 放行工具调用，不再逐次确认 | 已充分了解任务与项目，并接受相应执行权限 |

权限模式按会话设置。切换完全访问时界面会显示风险确认；不要把它理解为只读模式或系统级沙箱。

- **工作区信任**：未信任项目会限制工作区能力，并停止加载该项目的上下文文件、扩展、提示模板、技能和主题。
- **进程边界**：Renderer 启用 Context Isolation 与 Sandbox，关闭 Node Integration；通过受限 Preload 和校验过的 IPC 契约访问主进程能力。
- **凭据与审计**：已存凭据由主进程管理，不返回 Renderer；安全审计记录操作元数据，不记录完整工具输入或凭据。
- **扩展与终端**：项目配置、第三方插件和终端命令可能执行代码，应按实际用途授权。

漏洞报告方式见 [SECURITY.md](SECURITY.md)。其中关于逐次审批的概述应结合上表的当前权限模式理解。

## 本地开发与打包

需要 Node.js **22.19.0 或更高版本**、npm；Git 功能还需要本机安装 Git。

```bash
git clone https://github.com/Eileenes/pi-desktop.git
cd pi-desktop
npm ci
npm run start
```

`npm ci` 按锁文件安装依赖，并执行项目的安装生命周期脚本；`npm run start` 构建后启动 Electron。当前源码版本与依赖版本以 [package.json](package.json) 和锁文件为准，安装包版本以 Releases 为准。

<details>
<summary><b>检查与平台打包命令</b></summary>

```bash
# 格式、生产构建、构建产物和类型检查
npm run check

# 运行现有 Vitest 回归测试
npm test

# 按需要选择目标平台打包
npm run package:mac
npm run package:win
npm run package:linux
```

产物写入 `release/`。跨平台打包受本机工具链限制，仓库的 [打包工作流](.github/workflows/package.yml) 分别在 macOS、Windows 与 Linux runner 上构建；推送 `v*` 标签会触发构建并发布附件。面向用户的签名、公证和发布凭据需单独配置。

这些命令描述仓库已有检查入口，不代表当前环境已完成全部平台测试。贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md)。

</details>

## 文档与维护

| 文档 | 内容 |
| --- | --- |
| [贡献指南](CONTRIBUTING.md) | 开发约定、检查与 Pull Request |
| [安全策略](SECURITY.md) | 安全边界、私下报告方式与适用范围 |
| [开发规则](AGENTS.md) | 运行时依赖、IPC、代码和样式约定 |
| [界面基础组件](src/renderer/ui/README.md) | 可复用组件与设计系统 |
| [优化计划](docs/pi-desktop-optimization-plan.md) | 项目规划；计划项不等于已实现功能 |

<details>
<summary><b>目录结构</b></summary>

```text
pi-desktop/
├── src/
│   ├── main/       # 主进程、Pi 适配、工作区、终端、Git 与权限
│   ├── preload/    # 受限的 Renderer 桥接
│   ├── renderer/   # React 界面与客户端状态
│   └── shared/     # IPC 契约与共享逻辑
├── test/           # 回归测试
├── scripts/        # 产物检查与 node-pty 辅助脚本
├── build/          # 应用图标
├── website/        # 项目网站
└── .github/        # CI、打包、发布与站点工作流
```

</details>

遇到问题可以[提交 Issue](https://github.com/Eileenes/pi-desktop/issues)，注明系统、应用版本、复现步骤与预期行为。不要在公开问题中附上 API Key 或私人项目内容。

<a id="english"></a>

<details>
<summary><b>English overview</b></summary>

Pi Desktop is an independent Electron desktop client for Pi. It combines local projects, streaming conversations, file previews, Git/worktrees, an embedded terminal, model configuration, skills, and plugins.

Get a build from [Releases](https://github.com/Eileenes/pi-desktop/releases), configure a supported model provider, open a project, and review its trust prompt. Model access and usage credits are supplied by the user.

New sessions default to per-tool approval (`ask`). `autoEdit` approves selected editing tools automatically; `full` removes per-call confirmations. These modes do not constitute an operating-system sandbox. See the permission table above and [SECURITY.md](SECURITY.md).

Development requires Node.js 22.19.0 or later. Run `npm ci` and `npm run start`; use `npm run check` for build/type checks and `npm test` for existing regression tests. The runtime uses the published `@earendil-works/pi-coding-agent` package, without a local Pi source checkout.

</details>

## 来源与授权

本项目使用 [MIT 许可证](LICENSE)，保留文件中 **Copyright (c) 2025 Mario Zechner** 的版权声明。包元数据署名为 Earendil Works；Pi 运行时及其他依赖遵循各自许可证。

感谢 [Pi](https://github.com/badlogic/pi-mono) 及其生态贡献者，也感谢 [agegr/pi-web](https://github.com/agegr/pi-web) 提供的图形化交互参考。
