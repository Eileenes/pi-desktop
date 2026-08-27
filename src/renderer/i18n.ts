export type AppLanguage = "en" | "zh-CN";

const dictionaries = {
	"zh-CN": {
		newChat: "新建会话",
		chats: "会话",
		files: "文件",
		searchSessions: "搜索会话...",
		chooseFolder: "选择文件夹…",
		projects: "项目",
		sessions: "会话",
		models: "模型",
		skills: "技能",
		plugins: "插件",
		sourceControl: "源代码管理",
		settings: "设置",
		recentProjects: "最近项目",
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
	},
	en: {
		newChat: "New",
		chats: "Chats",
		files: "Files",
		searchSessions: "Search sessions...",
		chooseFolder: "Choose folder…",
		projects: "Projects",
		sessions: "Sessions",
		models: "Models",
		skills: "Skills",
		plugins: "Plugins",
		sourceControl: "Source control",
		settings: "Settings",
		recentProjects: "Recent projects",
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
	},
} as const;

export type TranslationKey = keyof (typeof dictionaries)["zh-CN"];

export function translate(language: AppLanguage, key: TranslationKey): string {
	return dictionaries[language][key];
}
