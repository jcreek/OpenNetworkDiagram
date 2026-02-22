import type { NetworkData } from '../types';

function isNetworkData(value: unknown): value is NetworkData {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<NetworkData>;
	return Array.isArray(candidate.machines) && Array.isArray(candidate.devices);
}

export default async function loadNetworkData(jsonPath: string): Promise<NetworkData> {
	const response = await fetch(jsonPath, {
		headers: {
			Accept: 'application/json'
		}
	});

	if (!response.ok) {
		throw new Error(`Failed to load ${jsonPath} (${response.status} ${response.statusText})`);
	}

	let rawData: unknown;
	try {
		rawData = await response.json();
	} catch (error) {
		throw new Error(`Failed to parse JSON at ${jsonPath}`, {
			cause: error
		});
	}

	if (!isNetworkData(rawData)) {
		throw new Error(`JSON at ${jsonPath} is not valid network data`);
	}

	return rawData;
}
