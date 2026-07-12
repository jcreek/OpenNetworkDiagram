// Distinct from the kind colours (machine blue, VM green, device amber) so a
// VLAN border reads as VLAN, not as an entity kind. Mid-saturation hues stay
// legible against both the light and dark node fills.
const palette = [
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
	return palette[Math.abs(Math.trunc(vlanId)) % palette.length];
}
