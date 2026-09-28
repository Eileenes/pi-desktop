/** Separate Pi's input acceptance from the lifetime of the agent run. */
export function startPromptSubmission(run: (accepted: (success: boolean) => void) => Promise<void>): {
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
			run((success) => {
				// Pi reports false just before throwing the original preflight error.
				if (success) resolveAccepted();
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
