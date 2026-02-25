import { constants } from 'node:fs';
import {
	access,
	copyFile,
	mkdir,
	open,
	readFile,
	readdir,
	rename,
	stat,
	unlink
} from 'node:fs/promises';
import path from 'node:path';

import type { NetworkData } from '../types';

export interface NetworkFileMetadata {
	source: string;
	updatedAt: string;
}

const NETWORK_READ_ONLY = process.env.NETWORK_READ_ONLY === 'true';
const DATA_FILE_DEFAULT = path.resolve(process.cwd(), 'data/network.json');
const BACKUP_DIR_DEFAULT = path.resolve(process.cwd(), 'data/.backups');

function resolveDataFilePath(): string {
	return path.resolve(process.env.NETWORK_DATA_FILE ?? DATA_FILE_DEFAULT);
}

function resolveBackupDirectory(): string {
	return path.resolve(process.env.NETWORK_BACKUP_DIR ?? BACKUP_DIR_DEFAULT);
}

export function isWriteEnabled(): boolean {
	return !NETWORK_READ_ONLY;
}

async function readUpdatedAt(dataFilePath: string): Promise<string> {
	const dataFileStats = await stat(dataFilePath);
	return dataFileStats.mtime.toISOString();
}

export async function readNetworkFile(): Promise<{ data: NetworkData } & NetworkFileMetadata> {
	const source = resolveDataFilePath();
	const raw = await readFile(source, 'utf8');
	const parsed = JSON.parse(raw) as NetworkData;
	const updatedAt = await readUpdatedAt(source);
	return {
		data: parsed,
		source,
		updatedAt
	};
}

async function createBackupIfPresent(dataFilePath: string, backupDirectory: string) {
	try {
		await access(dataFilePath, constants.F_OK);
	} catch {
		return;
	}

	await mkdir(backupDirectory, { recursive: true });
	const base = path.basename(dataFilePath);
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const backupFilePath = path.join(backupDirectory, `${base}.${timestamp}.bak`);
	await copyFile(dataFilePath, backupFilePath);
}

async function trimBackups(backupDirectory: string, baseName: string, keep = 5) {
	let entries: Array<{ name: string; time: number }> = [];
	try {
		const files = await readdir(backupDirectory);
		entries = await Promise.all(
			files
				.filter((file) => file.startsWith(`${baseName}.`) && file.endsWith('.bak'))
				.map(async (file) => {
					const filePath = path.join(backupDirectory, file);
					const info = await stat(filePath);
					return { name: filePath, time: info.mtimeMs };
				})
		);
	} catch {
		return;
	}

	entries.sort((a, b) => b.time - a.time);
	await Promise.all(entries.slice(keep).map((entry) => unlink(entry.name).catch(() => undefined)));
}

export async function writeNetworkFile(data: NetworkData): Promise<NetworkFileMetadata> {
	const source = resolveDataFilePath();
	const backupDirectory = resolveBackupDirectory();
	const directory = path.dirname(source);
	await mkdir(directory, { recursive: true });
	await createBackupIfPresent(source, backupDirectory);

	const temporaryPath = `${source}.tmp-${Date.now()}-${process.pid}`;
	const jsonPayload = `${JSON.stringify(data, null, '\t')}\n`;
	const fileHandle = await open(temporaryPath, 'w');
	try {
		await fileHandle.writeFile(jsonPayload, 'utf8');
		await fileHandle.sync();
	} finally {
		await fileHandle.close();
	}
	await rename(temporaryPath, source);

	await trimBackups(backupDirectory, path.basename(source), 5);
	const updatedAt = await readUpdatedAt(source);

	return {
		source,
		updatedAt
	};
}

export async function checkWritableState(): Promise<boolean> {
	if (!isWriteEnabled()) {
		return false;
	}

	const source = resolveDataFilePath();
	const directory = path.dirname(source);
	try {
		await mkdir(directory, { recursive: true });
		await access(directory, constants.W_OK);
	} catch {
		return false;
	}
	return true;
}
