import type { PromptOptions } from "@earendil-works/pi-coding-agent";

type PromptPreflight = NonNullable<PromptOptions["preflightResult"]>;

/** Separate Pi's input acceptance from the lifetime of the agent run. */
export function startPromptSubmission(run: (accepted: PromptPreflight) => Promise<void>): {
	accepted: Promise<void>;
	completed: Promise<void>;
} {
	let resolveAccepted!: () => void;
	let rejectAccepted!: (error: unknown) => void;
	const accepted = new Promise<void>((resolve, reject) => {
		resolveAccepted = resolve;
		rejectAccepted = reject;
	});
	const completed = Promise.resolve()
		.then(() =>
			run(() => {
				// Pi only reports a disposition after the prompt is accepted
				// ("started" | "queued" | "handled"). Rejections throw without this callback.
				resolveAccepted();
			}),
		)
		.then(
			() => resolveAccepted(),
			(error: unknown) => {
				rejectAccepted(error);
				throw error;
			},
		);
	return { accepted, completed };
}
