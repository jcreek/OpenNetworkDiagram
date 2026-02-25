import {
	checkWritableState as checkWritableStateCore,
	isWriteEnabled as isWriteEnabledCore,
	readNetworkFile as readNetworkFileCore,
	writeNetworkFile as writeNetworkFileCore
} from '../shared/networkPersistenceCore.mjs';

import type { NetworkData } from '../types';

export interface NetworkFileMetadata {
	source: string;
	updatedAt: string;
}

export function isWriteEnabled(): boolean {
	return isWriteEnabledCore();
}

export async function readNetworkFile(): Promise<{ data: NetworkData } & NetworkFileMetadata> {
	return (await readNetworkFileCore()) as { data: NetworkData } & NetworkFileMetadata;
}

export async function writeNetworkFile(data: NetworkData): Promise<NetworkFileMetadata> {
	return (await writeNetworkFileCore(data)) as NetworkFileMetadata;
}

export async function checkWritableState(): Promise<boolean> {
	return checkWritableStateCore();
}
