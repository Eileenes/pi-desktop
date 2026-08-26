export type AppLanguage = "en" | "zh-CN";

const dictionaries = {
	"zh-CN": {
		newChat: "新对话",
		sessions: "会话",
		models: "模型",
		skills: "技能",
		plugins: "插件",
		sourceControl: "源代码管理",
		settings: "设置",
		recentProjects: "最近项目",
		welcomeTitle: "今天想构建什么？",
		welcomeBody: "描述任务、粘贴代码，或用 @ 提及项目文件。Pi 会在当前工作区中完成工作。",
		openFiles: "打开文件浏览",
		openPreview: "打开预览面板",
		selectModel: "选择当前模型",
		addImage: "添加图片",
		languageName: "简体中文",
		fullHistory: "完整历史",
		branches: "分支",
		more: "更多",
		processDetails: "处理详情",
		send: "发送",
		source: "源码",
		preview: "预览",
		diff: "差异",
		hideFileList: "隐藏文件树",
		showFileList: "显示文件树",
	},
	en: {
		newChat: "New chat",
		sessions: "Sessions",
		models: "Models",
		skills: "Skills",
		plugins: "Plugins",
		sourceControl: "Source control",
		settings: "Settings",
		recentProjects: "Recent projects",
		welcomeTitle: "What do you want to build today?",
		welcomeBody:
			"Describe a task, paste code, or mention project files with @. Pi will work in the current workspace.",
		openFiles: "Open file browser",
		openPreview: "Open preview panel",
		selectModel: "Select current model",
		addImage: "Add image",
		languageName: "English",
		fullHistory: "Full history",
		branches: "Branches",
		more: "More",
		processDetails: "Process details",
		send: "Send",
		source: "Source",
		preview: "Preview",
		diff: "Diff",
		hideFileList: "Hide file list",
		showFileList: "Show file list",
	},
} as const;

export type TranslationKey = keyof (typeof dictionaries)["zh-CN"];

export function translate(language: AppLanguage, key: TranslationKey): string {
	return dictionaries[language][key];
}
