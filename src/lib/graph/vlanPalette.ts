import type { Subnet } from '$lib/types';

// Categorical VLAN palette from the UX review: equal lightness/chroma
// (oklch 0.55/0.13 light, 0.68/0.13 dark), hue varies, so no VLAN shouts
// louder than another. The actual oklch values live in app.css as
// --vlan-0..--vlan-5 (light + dark variants); consumers are all HTML/CSS,
// so we hand out var() references and let the theme resolve them.
export const VLAN_PALETTE_SIZE = 6;

export function vlanPaletteColor(index: number): string {
	const slot = ((Math.trunc(index) % VLAN_PALETTE_SIZE) + VLAN_PALETTE_SIZE) % VLAN_PALETTE_SIZE;
	return `var(--vlan-${slot})`;
}

// VLANs are assigned palette slots in declaration order (first appearance in
// data.subnets), not by vlanId, so the first VLAN a user declares always gets
// the first hue.
export function buildVlanIndexMap(subnets: Subnet[] | undefined): Map<number, number> {
	const map = new Map<number, number>();
	for (const subnet of subnets ?? []) {
		const { vlanId } = subnet;
		if (typeof vlanId !== 'number' || !Number.isFinite(vlanId)) {
			continue;
		}
		if (!map.has(vlanId)) {
			map.set(vlanId, map.size);
		}
	}
	return map;
}

// Legacy hex palette, still consumed by the pre-redesign Cytoscape node
// border styling; removed once the HTML card layer takes over VLAN colour.
const legacyPalette = [
	'#e11d48',
	'#7c3aed',
	'#0891b2',
	'#ca8a04',
	'#15803d',
	'#c2410c',
	'#4f46e5',
	'#0d9488',
	'#be185d',
	'#57534e'
];

export function vlanColor(vlanId: number): string {
	return legacyPalette[Math.abs(Math.trunc(vlanId)) % legacyPalette.length];
}
