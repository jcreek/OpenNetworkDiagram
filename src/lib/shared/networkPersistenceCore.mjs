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

/**
 * @typedef {{ machines: unknown[]; devices: unknown[] }} NetworkData
 * @typedef {{ source: string; updatedAt: string }} NetworkFileMetadata
 * @typedef {{ data: NetworkData } & NetworkFileMetadata} NetworkFileReadResult
 * @typedef {{ writable: boolean; reason: string | null }} WritableState
 */

const NETWORK_READ_ONLY = process.env.NETWORK_READ_ONLY === 'true';
const DATA_FILE_DEFAULT = path.resolve(process.cwd(), 'data/network.json');
const BACKUP_DIR_DEFAULT = path.resolve(process.cwd(), 'data/.backups');

/**
 * @returns {string}
 */
function resolveDataFilePath() {
	return path.resolve(process.env.NETWORK_DATA_FILE ?? DATA_FILE_DEFAULT);
}

/**
 * @returns {string}
 */
function resolveBackupDirectory() {
	return path.resolve(process.env.NETWORK_BACKUP_DIR ?? BACKUP_DIR_DEFAULT);
}

/**
 * @returns {boolean}
 */
export function isWriteEnabled() {
	return !NETWORK_READ_ONLY;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function formatFileSystemErrorCode(error) {
	if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
		return error.code;
	}
	return 'UNKNOWN';
}

/**
 * @param {string} directory
 * @param {string} label
 * @returns {Promise<string | null>}
 */
async function assertDirectoryWritable(directory, label) {
	try {
		await mkdir(directory, { recursive: true });
	} catch (error) {
		return `${label} directory "${directory}" could not be created (${formatFileSystemErrorCode(error)}).`;
	}

	try {
		await access(directory, constants.W_OK);
	} catch (error) {
		return `${label} directory "${directory}" is not writable (${formatFileSystemErrorCode(error)}).`;
	}

	return null;
}

/**
 * @param {string} dataFilePath
 * @returns {Promise<string>}
 */
async function readUpdatedAt(dataFilePath) {
	const dataFileStats = await stat(dataFilePath);
	return dataFileStats.mtime.toISOString();
}

/**
 * @returns {Promise<NetworkFileReadResult>}
 */
export async function readNetworkFile() {
	const source = resolveDataFilePath();
	const raw = await readFile(source, 'utf8');
	const parsed = JSON.parse(raw);
	const updatedAt = await readUpdatedAt(source);
	return {
		data: parsed,
		source,
		updatedAt
	};
}

/**
 * @param {string} dataFilePath
 * @param {string} backupDirectory
 * @returns {Promise<void>}
 */
export async function createBackupIfPresent(dataFilePath, backupDirectory) {
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

/**
 * @param {string} backupDirectory
 * @param {string} baseName
 * @param {number} [keep]
 * @returns {Promise<void>}
 */
export async function trimBackups(backupDirectory, baseName, keep = 5) {
	/** @type {Array<{ name: string; time: number }>} */
	let entries = [];
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

/**
 * @param {NetworkData} data
 * @returns {Promise<NetworkFileMetadata>}
 */
export async function writeNetworkFile(data) {
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
	try {
		await rename(temporaryPath, source);
	} catch (renameError) {
		await unlink(temporaryPath).catch(() => undefined);
		throw renameError;
	}

	await trimBackups(backupDirectory, path.basename(source), 5);
	const updatedAt = await readUpdatedAt(source);

	return {
		source,
		updatedAt
	};
}

/**
 * @returns {Promise<WritableState>}
 */
export async function getWritableState() {
	if (!isWriteEnabled()) {
		return {
			writable: false,
			reason: 'Writes disabled by NETWORK_READ_ONLY=true.'
		};
	}

	const source = resolveDataFilePath();
	const directory = path.dirname(source);
	const dataDirectoryError = await assertDirectoryWritable(directory, 'Data');
	if (dataDirectoryError) {
		return {
			writable: false,
			reason: dataDirectoryError
		};
	}

	const backupDirectory = resolveBackupDirectory();
	const backupDirectoryError = await assertDirectoryWritable(backupDirectory, 'Backup');
	if (backupDirectoryError) {
		return {
			writable: false,
			reason: backupDirectoryError
		};
	}

	try {
		await access(source, constants.F_OK);
	} catch {
		return {
			writable: true,
			reason: null
		};
	}

	try {
		await access(source, constants.R_OK | constants.W_OK);
	} catch (error) {
		return {
			writable: false,
			reason: `Data file "${source}" exists but is not readable and writable (${formatFileSystemErrorCode(error)}).`
		};
	}

	return {
		writable: true,
		reason: null
	};
}

/**
 * @returns {Promise<boolean>}
 */
export async function checkWritableState() {
	return (await getWritableState()).writable;
}
