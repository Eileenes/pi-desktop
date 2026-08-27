import { type FSWatcher, watch } from "node:fs";
import { relative } from "node:path";

export interface WorkspaceChangeEvent {
	/** 变更文件的相对路径（POSIX 风格），目录事件以 / 结尾。 */
	path: string;
}

/**
 * 工作区文件监听器：fs.watch 递归监听 + 防抖批量通知。
 * macOS/Windows 使用原生递归监听；不支持的平台上 watcher 创建失败时静默降级。
 */
export class WorkspaceWatcher {
	private watcher: FSWatcher | undefined;
	private pendingPaths = new Set<string>();
	private flushTimer: NodeJS.Timeout | undefined;
	private currentRoot: string | undefined;
	private readonly onChange: (changes: WorkspaceChangeEvent[]) => void;
	private readonly debounceMs: number;

	constructor(onChange: (changes: WorkspaceChangeEvent[]) => void, debounceMs = 300) {
		this.onChange = onChange;
		this.debounceMs = debounceMs;
	}

	start(root: string): void {
		if (this.currentRoot === root) return;
		this.stop();
		this.currentRoot = root;
		try {
			this.watcher = watch(root, { recursive: true }, (_event, filename) => {
				if (!filename) return;
				this.enqueue(filename.replaceAll("\\", "/"));
			});
			this.watcher.on("error", () => this.stop());
		} catch {
			this.watcher = undefined;
		}
	}

	stop(): void {
		this.watcher?.close();
		this.watcher = undefined;
		this.currentRoot = undefined;
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		this.pendingPaths.clear();
	}

	private enqueue(path: string): void {
		this.pendingPaths.add(path);
		if (this.flushTimer) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined;
			const changes = [...this.pendingPaths]
				.sort()
				.slice(0, 100)
				.map((changed) => ({
					path: this.currentRoot ? relative(this.currentRoot, changed).replaceAll("\\", "/") || changed : changed,
				}));
			this.pendingPaths.clear();
			if (changes.length > 0) this.onChange(changes);
		}, this.debounceMs);
	}
}
