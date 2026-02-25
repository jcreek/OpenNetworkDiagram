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
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const buildDir = path.resolve(currentDirPath, 'build');

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 3000);

const NETWORK_READ_ONLY = process.env.NETWORK_READ_ONLY === 'true';
const NETWORK_DATA_FILE = path.resolve(
	process.env.NETWORK_DATA_FILE ?? path.join(currentDirPath, 'data/network.json')
);
const NETWORK_BACKUP_DIR = path.resolve(
	process.env.NETWORK_BACKUP_DIR ?? path.join(path.dirname(NETWORK_DATA_FILE), '.backups')
);

function isWriteEnabled() {
	return !NETWORK_READ_ONLY;
}

const contentTypeByExtension = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.svg': 'image/svg+xml; charset=utf-8',
	'.ico': 'image/x-icon',
	'.webp': 'image/webp',
	'.txt': 'text/plain; charset=utf-8'
};

function sendJson(response, status, payload) {
	const body = JSON.stringify(payload);
	response.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': Buffer.byteLength(body),
		'Cache-Control': 'no-store'
	});
	response.end(body);
}

function badRequest(response, message, details) {
	sendJson(response, 400, {
		error: message,
		...(details ? { details } : {})
	});
}

function normalizePort(port) {
	if (!port || typeof port !== 'object') {
		return null;
	}
	if (typeof port.portName !== 'string' || port.portName.trim() === '') {
		return null;
	}
	const normalized = {
		portName: port.portName.trim()
	};
	if (typeof port.speedGbps === 'number' && !Number.isNaN(port.speedGbps)) {
		normalized.speedGbps = port.speedGbps;
	}
	if (port.connectedTo && typeof port.connectedTo === 'object') {
		if (
			typeof port.connectedTo.device === 'string' &&
			port.connectedTo.device.trim() !== '' &&
			typeof port.connectedTo.port === 'string' &&
			port.connectedTo.port.trim() !== ''
		) {
			normalized.connectedTo = {
				device: port.connectedTo.device.trim(),
				port: port.connectedTo.port.trim()
			};
		}
	}
	return normalized;
}

function normalizeVm(vm) {
	if (!vm || typeof vm !== 'object') {
		return null;
	}
	if (
		typeof vm.name !== 'string' ||
		vm.name.trim() === '' ||
		typeof vm.role !== 'string' ||
		vm.role.trim() === '' ||
		typeof vm.ipAddress !== 'string' ||
		vm.ipAddress.trim() === ''
	) {
		return null;
	}
	return {
		name: vm.name.trim(),
		role: vm.role.trim(),
		ipAddress: vm.ipAddress.trim(),
		...(typeof vm.iconKey === 'string' && vm.iconKey.trim() ? { iconKey: vm.iconKey.trim() } : {})
	};
}

function validateNetworkData(value) {
	const errors = [];
	if (!value || typeof value !== 'object') {
		return {
			valid: false,
			errors: [{ path: '$', message: 'must be an object with machines and devices arrays' }]
		};
	}
	if (!Array.isArray(value.machines)) {
		errors.push({ path: '$.machines', message: 'must be an array' });
	}
	if (!Array.isArray(value.devices)) {
		errors.push({ path: '$.devices', message: 'must be an array' });
	}

	const machines = [];
	for (const [machineIndex, sourceMachine] of (Array.isArray(value.machines)
		? value.machines
		: []
	).entries()) {
		if (!sourceMachine || typeof sourceMachine !== 'object') {
			errors.push({ path: `$.machines[${machineIndex}]`, message: 'must be an object' });
			continue;
		}

		const requiredMachineFields = ['machineName', 'ipAddress', 'role', 'operatingSystem'];
		let invalidField = false;
		for (const fieldName of requiredMachineFields) {
			if (typeof sourceMachine[fieldName] !== 'string' || sourceMachine[fieldName].trim() === '') {
				errors.push({ path: `$.machines[${machineIndex}].${fieldName}`, message: 'is required' });
				invalidField = true;
			}
		}
		const { hardware } = sourceMachine;
		if (!hardware || typeof hardware !== 'object') {
			errors.push({ path: `$.machines[${machineIndex}].hardware`, message: 'must be an object' });
			invalidField = true;
		}
		const { software } = sourceMachine;
		if (!software || typeof software !== 'object' || !Array.isArray(software.vms)) {
			errors.push({
				path: `$.machines[${machineIndex}].software.vms`,
				message: 'must be an array'
			});
			invalidField = true;
		}
		if (invalidField) {
			continue;
		}

		const vmNames = new Set();
		const vms = [];
		for (const [vmIndex, sourceVm] of software.vms.entries()) {
			const vm = normalizeVm(sourceVm);
			if (!vm) {
				errors.push({
					path: `$.machines[${machineIndex}].software.vms[${vmIndex}]`,
					message: 'invalid vm'
				});
				continue;
			}
			const vmKey = vm.name.toLowerCase();
			if (vmNames.has(vmKey)) {
				errors.push({
					path: `$.machines[${machineIndex}].software.vms[${vmIndex}].name`,
					message: `duplicate vm name "${vm.name}"`
				});
			}
			vmNames.add(vmKey);
			vms.push(vm);
		}

		const ports = [];
		const portNames = new Set();
		for (const [portIndex, sourcePort] of (Array.isArray(sourceMachine.ports)
			? sourceMachine.ports
			: []
		).entries()) {
			const port = normalizePort(sourcePort);
			if (!port) {
				errors.push({
					path: `$.machines[${machineIndex}].ports[${portIndex}]`,
					message: 'invalid port'
				});
				continue;
			}
			const portKey = port.portName.toLowerCase();
			if (portNames.has(portKey)) {
				errors.push({
					path: `$.machines[${machineIndex}].ports[${portIndex}].portName`,
					message: `duplicate port name "${port.portName}"`
				});
			}
			portNames.add(portKey);
			ports.push(port);
		}

		machines.push({
			machineName: sourceMachine.machineName.trim(),
			ipAddress: sourceMachine.ipAddress.trim(),
			role: sourceMachine.role.trim(),
			operatingSystem: sourceMachine.operatingSystem.trim(),
			...(typeof sourceMachine.iconKey === 'string' && sourceMachine.iconKey.trim()
				? { iconKey: sourceMachine.iconKey.trim() }
				: {}),
			software: {
				vms
			},
			hardware: {
				cpu: String(hardware.cpu ?? ''),
				ram: String(hardware.ram ?? ''),
				networkPorts: Number(hardware.networkPorts ?? 0),
				...(typeof hardware.networkPortSpeedGbps === 'number'
					? { networkPortSpeedGbps: hardware.networkPortSpeedGbps }
					: {}),
				...(typeof hardware.gpu === 'string' && hardware.gpu.trim()
					? { gpu: hardware.gpu.trim() }
					: {})
			},
			ports
		});
	}

	const devices = [];
	for (const [deviceIndex, sourceDevice] of (Array.isArray(value.devices)
		? value.devices
		: []
	).entries()) {
		if (!sourceDevice || typeof sourceDevice !== 'object') {
			errors.push({ path: `$.devices[${deviceIndex}]`, message: 'must be an object' });
			continue;
		}
		const requiredDeviceFields = ['name', 'ipAddress', 'type'];
		let invalidField = false;
		for (const fieldName of requiredDeviceFields) {
			if (typeof sourceDevice[fieldName] !== 'string' || sourceDevice[fieldName].trim() === '') {
				errors.push({ path: `$.devices[${deviceIndex}].${fieldName}`, message: 'is required' });
				invalidField = true;
			}
		}
		if (invalidField) {
			continue;
		}

		const ports = [];
		const portNames = new Set();
		for (const [portIndex, sourcePort] of (Array.isArray(sourceDevice.ports)
			? sourceDevice.ports
			: []
		).entries()) {
			const port = normalizePort(sourcePort);
			if (!port) {
				errors.push({
					path: `$.devices[${deviceIndex}].ports[${portIndex}]`,
					message: 'invalid port'
				});
				continue;
			}
			const portKey = port.portName.toLowerCase();
			if (portNames.has(portKey)) {
				errors.push({
					path: `$.devices[${deviceIndex}].ports[${portIndex}].portName`,
					message: `duplicate port name "${port.portName}"`
				});
			}
			portNames.add(portKey);
			ports.push(port);
		}

		devices.push({
			name: sourceDevice.name.trim(),
			ipAddress: sourceDevice.ipAddress.trim(),
			type: sourceDevice.type.trim(),
			...(typeof sourceDevice.iconKey === 'string' && sourceDevice.iconKey.trim()
				? { iconKey: sourceDevice.iconKey.trim() }
				: {}),
			...(typeof sourceDevice.notes === 'string' ? { notes: sourceDevice.notes } : {}),
			ports
		});
	}

	const machineNames = new Set();
	for (const [index, machine] of machines.entries()) {
		const key = machine.machineName.toLowerCase();
		if (machineNames.has(key)) {
			errors.push({
				path: `$.machines[${index}].machineName`,
				message: `duplicate machine name "${machine.machineName}"`
			});
		}
		machineNames.add(key);
	}

	const deviceNames = new Set();
	for (const [index, device] of devices.entries()) {
		const key = device.name.toLowerCase();
		if (deviceNames.has(key)) {
			errors.push({
				path: `$.devices[${index}].name`,
				message: `duplicate device name "${device.name}"`
			});
		}
		deviceNames.add(key);
	}

	for (const [index, machine] of machines.entries()) {
		if (deviceNames.has(machine.machineName.toLowerCase())) {
			errors.push({
				path: `$.machines[${index}].machineName`,
				message: `name "${machine.machineName}" collides with a device name`
			});
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		data: {
			machines,
			devices
		}
	};
}

async function createBackupIfPresent(filePath) {
	try {
		await access(filePath, constants.F_OK);
	} catch {
		return;
	}
	await mkdir(NETWORK_BACKUP_DIR, { recursive: true });
	const baseName = path.basename(filePath);
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const backupPath = path.join(NETWORK_BACKUP_DIR, `${baseName}.${timestamp}.bak`);
	await copyFile(filePath, backupPath);
}

async function trimBackups(filePath, keep = 5) {
	let files = [];
	try {
		files = await readdir(NETWORK_BACKUP_DIR);
	} catch {
		return;
	}
	const baseName = path.basename(filePath);
	const matches = await Promise.all(
		files
			.filter((entry) => entry.startsWith(`${baseName}.`) && entry.endsWith('.bak'))
			.map(async (entry) => {
				const entryPath = path.join(NETWORK_BACKUP_DIR, entry);
				const info = await stat(entryPath);
				return { path: entryPath, mtime: info.mtimeMs };
			})
	);
	matches.sort((a, b) => b.mtime - a.mtime);
	await Promise.all(matches.slice(keep).map((entry) => unlink(entry.path).catch(() => undefined)));
}

async function writeNetworkFile(payload) {
	const directory = path.dirname(NETWORK_DATA_FILE);
	await mkdir(directory, { recursive: true });
	await createBackupIfPresent(NETWORK_DATA_FILE);

	const tempPath = `${NETWORK_DATA_FILE}.tmp-${Date.now()}-${process.pid}`;
	const fileHandle = await open(tempPath, 'w');
	try {
		await fileHandle.writeFile(`${JSON.stringify(payload, null, '\t')}\n`, 'utf8');
		await fileHandle.sync();
	} finally {
		await fileHandle.close();
	}
	await rename(tempPath, NETWORK_DATA_FILE);
	await trimBackups(NETWORK_DATA_FILE, 5);
}

async function readNetworkFile() {
	const raw = await readFile(NETWORK_DATA_FILE, 'utf8');
	const parsed = JSON.parse(raw);
	const fileStats = await stat(NETWORK_DATA_FILE);
	return {
		data: parsed,
		source: NETWORK_DATA_FILE,
		updatedAt: fileStats.mtime.toISOString()
	};
}

async function serveApi(request, response) {
	if (request.method === 'GET') {
		try {
			const payload = await readNetworkFile();
			const validation = validateNetworkData(payload.data);
			if (!validation.valid) {
				sendJson(response, 500, {
					error: 'Stored network data is invalid',
					details: validation.errors
				});
				return;
			}

			let canWrite = false;
			if (isWriteEnabled()) {
				try {
					await mkdir(path.dirname(NETWORK_DATA_FILE), { recursive: true });
					await access(path.dirname(NETWORK_DATA_FILE), constants.W_OK);
					canWrite = true;
				} catch {
					canWrite = false;
				}
			}

			sendJson(response, 200, {
				data: validation.data,
				writable: canWrite,
				source: payload.source,
				updatedAt: payload.updatedAt
			});
		} catch (error) {
			sendJson(response, 500, {
				error: error instanceof Error ? error.message : 'Failed to read network data'
			});
		}
		return;
	}

	if (request.method === 'PUT') {
		if (!isWriteEnabled()) {
			sendJson(response, 403, {
				error: 'Write API disabled. Unset NETWORK_READ_ONLY to enable persistence.'
			});
			return;
		}

		let raw = '';
		for await (const chunk of request) {
			raw += chunk;
		}

		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch {
			badRequest(response, 'Request body must be valid JSON');
			return;
		}

		const validation = validateNetworkData(parsed);
		if (!validation.valid) {
			badRequest(response, 'Network data validation failed', validation.errors);
			return;
		}

		try {
			await writeNetworkFile(validation.data);
			const fileStats = await stat(NETWORK_DATA_FILE);
			sendJson(response, 200, {
				data: validation.data,
				writable: true,
				source: NETWORK_DATA_FILE,
				updatedAt: fileStats.mtime.toISOString()
			});
		} catch (error) {
			sendJson(response, 500, {
				error: error instanceof Error ? error.message : 'Failed to persist network data'
			});
		}
		return;
	}

	sendJson(response, 405, { error: 'Method not allowed' });
}

function safeRelativePath(requestPath) {
	const decoded = decodeURIComponent(requestPath);
	const normalized = path.posix.normalize(decoded);
	if (normalized.startsWith('..')) {
		return null;
	}
	return normalized;
}

async function serveStatic(requestPath, response) {
	const relativePath = safeRelativePath(requestPath);
	if (relativePath === null) {
		response.writeHead(400);
		response.end('Bad request');
		return;
	}

	const requestedFilePath = path.join(
		buildDir,
		relativePath === '/' ? 'index.html' : relativePath.slice(1)
	);

	const sendFile = async (filePath) => {
		const ext = path.extname(filePath).toLowerCase();
		const contentType = contentTypeByExtension[ext] ?? 'application/octet-stream';
		const content = await readFile(filePath);
		response.writeHead(200, {
			'Content-Type': contentType,
			'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable'
		});
		response.end(content);
	};

	try {
		const fileInfo = await stat(requestedFilePath);
		if (fileInfo.isDirectory()) {
			await sendFile(path.join(requestedFilePath, 'index.html'));
			return;
		}
		await sendFile(requestedFilePath);
		return;
	} catch {
		// continue with SPA fallback
	}

	try {
		await sendFile(path.join(buildDir, 'index.html'));
	} catch {
		response.writeHead(404);
		response.end('Not found');
	}
}

const server = createServer(async (request, response) => {
	const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
	if (requestUrl.pathname === '/api/network-data') {
		await serveApi(request, response);
		return;
	}
	await serveStatic(requestUrl.pathname, response);
});

server.listen(PORT, HOST, () => {
	// eslint-disable-next-line no-console
	console.log(`[OpenNetworkDiagram] listening on http://${HOST}:${PORT}`);
});
