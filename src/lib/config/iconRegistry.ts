import { VENDOR_ICON_DEFINITIONS } from './vendorIconManifest';

export interface IconDefinition {
	key: string;
	label: string;
	path: string;
	source?: 'built-in' | 'homarr-dashboard-icons';
}

const BUILTIN_ICONS: IconDefinition[] = [
	{ key: 'server', label: 'Server', path: '/icons/server.svg', source: 'built-in' },
	{ key: 'router', label: 'Router', path: '/icons/router.svg', source: 'built-in' },
	{ key: 'switch', label: 'Switch', path: '/icons/switch.svg', source: 'built-in' },
	{ key: 'storage', label: 'Storage', path: '/icons/storage.svg', source: 'built-in' },
	{ key: 'desktop', label: 'Desktop', path: '/icons/desktop.svg', source: 'built-in' },
	{ key: 'cloud', label: 'Cloud', path: '/icons/cloud.svg', source: 'built-in' }
];

const ICONS: IconDefinition[] = [...BUILTIN_ICONS, ...VENDOR_ICON_DEFINITIONS];

const ICON_BY_KEY = new Map(ICONS.map((icon) => [icon.key, icon]));

export function listIconDefinitions(): IconDefinition[] {
	return ICONS;
}

export function resolveIconPath(iconKey?: string): string | undefined {
	if (!iconKey) {
		return undefined;
	}
	return ICON_BY_KEY.get(iconKey)?.path;
}
