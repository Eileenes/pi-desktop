declare module "@earendil-works/pi-coding-agent" {
	export interface AgentSession {
		readonly isStreaming: boolean;
		readonly messages: unknown[];
		readonly model:
			| {
					provider: string;
					id: string;
			  }
			| undefined;
		readonly sessionId: string;
		readonly sessionName: string | undefined;
		readonly thinkingLevel: string;
		readonly sessionManager: SessionManager;
		dispose(): void;
		readonly resourceLoader: {
			getExtensions(): {
				extensions: Array<{ hidden?: boolean; path: string; commands: Map<string, unknown> }>;
			};
			getSkills(): { skills: Array<{ name: string; description: string }> };
		};
		prompt(
			text: string,
			options: { images?: Array<{ type: "image"; data: string; mimeType: string }>; source: "interactive" },
		): Promise<void>;
		setModel(model: Model, options?: { persist?: boolean }): Promise<void>;
		subscribe(listener: () => void): () => void;
		navigateTree(
			targetId: string,
			options?: { summarize?: boolean; label?: string },
		): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean }>;
		getUserMessagesForForking(): Array<{ entryId: string; text: string }>;
		getSessionStats(): {
			sessionId: string;
			userMessages: number;
			assistantMessages: number;
			toolCalls: number;
			toolResults: number;
			totalMessages: number;
			tokens: {
				input: number;
				output: number;
				cacheRead: number;
				cacheWrite: number;
				total: number;
			};
			cost: number;
			contextUsage?: {
				tokens: number | null;
				contextWindow: number;
				percent: number | null;
			};
		};
	}

	export interface Model {
		provider: string;
		id: string;
		name: string;
		input: readonly ("image" | "text")[];
	}

	export interface Provider {
		id: string;
		name: string;
		auth: { apiKey?: { login?: unknown } };
	}

	export type AuthPrompt =
		| { type: "secret"; message: string; placeholder?: string; signal?: AbortSignal }
		| { type: "text"; message: string; placeholder?: string; signal?: AbortSignal }
		| {
				type: "select";
				message: string;
				options: readonly { id: string; label: string; description?: string }[];
				signal?: AbortSignal;
		  }
		| { type: "manual_code"; message: string; placeholder?: string; signal?: AbortSignal };

	export interface ModelRuntime {
		getAvailableSnapshot(): readonly Model[];
		getProviders(): readonly Provider[];
		getProviderAuthStatus(providerId: string): { configured: boolean };
		login(
			providerId: string,
			type: "api_key",
			interaction: {
				signal?: AbortSignal;
				prompt(prompt: AuthPrompt): Promise<string>;
				notify(
					event:
						| { type: "auth_url"; instructions?: string }
						| { type: "device_code"; userCode: string; verificationUri: string }
						| { type: "info" | "progress"; message: string },
				): void;
			},
		): Promise<unknown>;
	}

	export const ModelRuntime: {
		create(options: {
			authPath: string;
			modelsPath: string;
			allowModelNetwork?: boolean;
			refreshOnCreate?: boolean;
		}): Promise<ModelRuntime>;
	};

	export interface SessionTreeNode {
		entry: {
			id: string;
			type: string;
			parentId?: string | null;
		};
		children: SessionTreeNode[];
		label?: string;
	}

	export interface SessionManager {
		getSessionId(): string;
		getSessionName(): string | undefined;
		getLeafId(): string | null;
		getSessionFile(): string | undefined;
		getTree(): SessionTreeNode[];
		appendSessionInfo(name: string): string;
	}

	export interface SessionInfo {
		path: string;
		id: string;
		name?: string;
		cwd: string;
		created: Date;
		modified: Date;
		messageCount: number;
		firstMessage: string;
	}

	export const SessionManager: {
		create(cwd: string, sessionDir: string): SessionManager;
		open(path: string, sessionDir?: string, cwdOverride?: string): SessionManager;
		continueRecent(cwd: string, sessionDir?: string): SessionManager;
		list(cwd: string, sessionDir?: string): Promise<SessionInfo[]>;
		forkFrom(sourcePath: string, targetCwd: string, sessionDir?: string): SessionManager;
	};

	export interface SettingsManager {}

	export const SettingsManager: {
		create(cwd: string, agentDir: string, options: { projectTrusted: boolean }): SettingsManager;
	};

	export interface ToolCallEvent {
		toolCallId: string;
		toolName: string;
		input: Record<string, unknown>;
	}

	export interface ToolCallEventResult {
		block?: boolean;
		reason?: string;
		terminate?: boolean;
	}

	export interface ExtensionAPI {
		on(event: "tool_call", handler: (event: ToolCallEvent) => Promise<ToolCallEventResult | undefined>): void;
	}

	export type InlineExtension = {
		name: string;
		hidden?: boolean;
		factory: (pi: ExtensionAPI) => void;
	};

	export interface DefaultResourceLoader {
		reload(): Promise<void>;
	}

	export const DefaultResourceLoader: {
		new (options: {
			cwd: string;
			agentDir: string;
			settingsManager: SettingsManager;
			noContextFiles?: boolean;
			noExtensions?: boolean;
			noPromptTemplates?: boolean;
			noSkills?: boolean;
			noThemes?: boolean;
			extensionFactories?: InlineExtension[];
		}): DefaultResourceLoader;
	};

	export function createAgentSession(options: {
		cwd: string;
		agentDir: string;
		modelRuntime: ModelRuntime;
		noTools?: "all" | "builtin";
		resourceLoader: DefaultResourceLoader;
		settingsManager: SettingsManager;
		sessionManager: SessionManager;
		tools?: string[];
	}): Promise<{ session: AgentSession; modelFallbackMessage: string | undefined }>;
}
