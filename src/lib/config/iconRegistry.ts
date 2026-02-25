export interface IconDefinition {
	key: string;
	label: string;
	path: string;
}

const ICONS: IconDefinition[] = [
	{ key: 'server', label: 'Server', path: '/icons/server.svg' },
	{ key: 'router', label: 'Router', path: '/icons/router.svg' },
	{ key: 'switch', label: 'Switch', path: '/icons/switch.svg' },
	{ key: 'storage', label: 'Storage', path: '/icons/storage.svg' },
	{ key: 'desktop', label: 'Desktop', path: '/icons/desktop.svg' },
	{ key: 'cloud', label: 'Cloud', path: '/icons/cloud.svg' }
];

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
