import AnthropicMono from "@lobehub/icons/es/Anthropic/components/Mono";
import CohereColor from "@lobehub/icons/es/Cohere/components/Color";
import DeepSeekColor from "@lobehub/icons/es/DeepSeek/components/Color";
import GoogleColor from "@lobehub/icons/es/Google/components/Color";
import GrokMono from "@lobehub/icons/es/Grok/components/Mono";
import GroqMono from "@lobehub/icons/es/Groq/components/Mono";
import MinimaxColor from "@lobehub/icons/es/Minimax/components/Color";
import MistralColor from "@lobehub/icons/es/Mistral/components/Color";
import MoonshotMono from "@lobehub/icons/es/Moonshot/components/Mono";
import OpenAIMono from "@lobehub/icons/es/OpenAI/components/Mono";
import OpenRouterMono from "@lobehub/icons/es/OpenRouter/components/Mono";
import PerplexityColor from "@lobehub/icons/es/Perplexity/components/Color";
import QwenColor from "@lobehub/icons/es/Qwen/components/Color";
import TogetherColor from "@lobehub/icons/es/Together/components/Color";
import XAIMono from "@lobehub/icons/es/XAI/components/Mono";
import ZhipuColor from "@lobehub/icons/es/Zhipu/components/Color";
import type { ComponentType, CSSProperties, ReactElement } from "react";

type ProviderIcon = {
	Icon: ComponentType<{ size?: number | string; style?: CSSProperties }>;
	mono: boolean;
};

/** Mono icons inherit currentColor; color icons carry their own brand fills. */
const PROVIDER_ICONS: Record<string, ProviderIcon> = {
	anthropic: { Icon: AnthropicMono, mono: true },
	"openai-codex": { Icon: OpenAIMono, mono: true },
	openai: { Icon: OpenAIMono, mono: true },
	"google-vertex": { Icon: GoogleColor, mono: false },
	google: { Icon: GoogleColor, mono: false },
	deepseek: { Icon: DeepSeekColor, mono: false },
	groq: { Icon: GroqMono, mono: true },
	mistral: { Icon: MistralColor, mono: false },
	moonshotai: { Icon: MoonshotMono, mono: true },
	minimax: { Icon: MinimaxColor, mono: false },
	openrouter: { Icon: OpenRouterMono, mono: true },
	xai: { Icon: XAIMono, mono: true },
	qwen: { Icon: QwenColor, mono: false },
	zhipu: { Icon: ZhipuColor, mono: false },
	cohere: { Icon: CohereColor, mono: false },
	perplexity: { Icon: PerplexityColor, mono: false },
	together: { Icon: TogetherColor, mono: false },
	grok: { Icon: GrokMono, mono: true },
};

export function ProviderIconMark({
	providerId,
	size = 14,
}: {
	providerId: string;
	size?: number;
}): ReactElement | undefined {
	const entry = PROVIDER_ICONS[providerId.toLocaleLowerCase()];
	if (!entry) return undefined;
	return (
		<span className={`models-provider-mark is-svg ${entry.mono ? "is-mono" : "is-color"}`} aria-hidden="true">
			<entry.Icon size={size} />
		</span>
	);
}
