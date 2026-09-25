import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/**
 * Width-safe line truncation helper.
 *
 * Guarantees that any line passed to `Component.render(width)`, `setWidget`,
 * or TUI overlays never exceeds terminal width, preventing hard crashes
 * in `pi-tui` rendering engine.
 */
export function fitLineToWidth(line: string, maxWidth: number, ellipsis = "…"): string {
	if (maxWidth <= 0) return "";
	const vWidth = visibleWidth(line);
	if (vWidth <= maxWidth) return line;
	return truncateToWidth(line, maxWidth, ellipsis);
}

/**
 * Format a bordered row with strict visible width padding and clipping.
 */
export function fitBorderedRow(
	content: string,
	innerWidth: number,
	borderLeft: string,
	borderRight: string,
	padding = 1,
): string {
	const padStr = " ".repeat(padding);
	const availableContentWidth = Math.max(0, innerWidth - padding * 2);
	const clipped = fitLineToWidth(content, availableContentWidth, "…");
	const vWidth = visibleWidth(clipped);
	const spaceNeeded = Math.max(0, availableContentWidth - vWidth);
	return `${borderLeft}${padStr}${clipped}${" ".repeat(spaceNeeded)}${padStr}${borderRight}`;
}
