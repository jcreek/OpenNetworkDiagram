import {
	checkWritableState as checkWritableStateCore,
	getWritableState as getWritableStateCore,
	isWriteEnabled as isWriteEnabledCore,
	readOrInitializeNetworkFile as readOrInitializeNetworkFileCore,
	readNetworkFile as readNetworkFileCore,
	writeNetworkFile as writeNetworkFileCore
} from '../shared/networkPersistenceCore.mjs';

import type { NetworkData } from '../types';

export interface NetworkFileMetadata {
	source: string;
	updatedAt: string;
}

export interface WritableState {
	writable: boolean;
	reason: string | null;
}

export interface NetworkFileBootstrapResult extends NetworkFileMetadata {
	data: NetworkData;
	initialized: boolean;
}

export function isWriteEnabled(): boolean {
	return isWriteEnabledCore();
}

export async function readNetworkFile(): Promise<{ data: NetworkData } & NetworkFileMetadata> {
	return (await readNetworkFileCore()) as { data: NetworkData } & NetworkFileMetadata;
}

export async function readOrInitializeNetworkFile(): Promise<NetworkFileBootstrapResult> {
	return (await readOrInitializeNetworkFileCore()) as NetworkFileBootstrapResult;
}

export async function writeNetworkFile(data: NetworkData): Promise<NetworkFileMetadata> {
	return (await writeNetworkFileCore(data)) as NetworkFileMetadata;
}

export async function getWritableState(): Promise<WritableState> {
	return (await getWritableStateCore()) as WritableState;
}

export async function checkWritableState(): Promise<boolean> {
	return checkWritableStateCore();
}
