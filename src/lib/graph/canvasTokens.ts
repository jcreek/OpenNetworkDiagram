// Reads the graph-facing design tokens off the document root so the
// Cytoscape stylesheet (canvas-drawn edges) always matches the CSS theme.
// The --graph-* custom properties are plain hex on purpose: Cytoscape's
// colour parser doesn't understand oklch() or var().
export interface CanvasTokens {
	bgCanvas: string;
	edge: string;
	border: string;
	chipBg: string;
	chipText: string;
	accent: string;
}

const fallbacks: CanvasTokens = {
	bgCanvas: '#eef0f3',
	edge: '#8b94a3',
	border: '#dce0e6',
	chipBg: '#ffffff',
	chipText: '#3a4250',
	accent: '#3565c4'
};

export function readCanvasTokens(): CanvasTokens {
	if (typeof document === 'undefined') {
		return fallbacks;
	}
	const styles = getComputedStyle(document.documentElement);
	const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
	return {
		bgCanvas: read('--bg-canvas', fallbacks.bgCanvas),
		edge: read('--graph-edge', fallbacks.edge),
		border: read('--border', fallbacks.border),
		chipBg: read('--graph-edge-chip-bg', fallbacks.chipBg),
		chipText: read('--graph-edge-chip-text', fallbacks.chipText),
		accent: read('--accent', fallbacks.accent)
	};
}
