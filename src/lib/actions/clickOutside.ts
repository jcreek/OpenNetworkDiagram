// Svelte action: invoke the callback when a pointer goes down outside the
// node. Listens in the capture phase so clicks swallowed by the Cytoscape
// canvas still dismiss open popovers.
export default function clickOutside(node: HTMLElement, onOutside: () => void) {
	let callback = onOutside;
	const handler = (event: PointerEvent) => {
		if (!node.contains(event.target as Node)) {
			callback();
		}
	};
	document.addEventListener('pointerdown', handler, true);
	return {
		update(next: () => void) {
			callback = next;
		},
		destroy() {
			document.removeEventListener('pointerdown', handler, true);
		}
	};
}
