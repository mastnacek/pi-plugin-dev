/**
 * Subagent Recursion Guard.
 *
 * Prevents child/delegated subagents from attaching duplicate HUDs,
 * editor widgets, prompt guideline injections, and audit hooks.
 */

export function isDelegatedSession(): boolean {
	return process.env.PI_SUBAGENT === "true" || Boolean(process.env.PI_CHILD_SESSION);
}
