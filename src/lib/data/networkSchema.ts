import type { Machine, NetworkData, NetworkDevice, Port, VM } from '../types';

export interface ValidationIssue {
	path: string;
	message: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: ValidationIssue[];
	data?: NetworkData;
}

function deepClone<T>(value: T): T {
	if (typeof structuredClone === 'function') {
		return structuredClone(value);
	}
	return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(
	issues: ValidationIssue[],
	path: string,
	value: unknown,
	options?: { allowEmpty?: boolean; optional?: boolean }
): string | undefined {
	if (value === undefined || value === null) {
		if (options?.optional) {
			return undefined;
		}
		issues.push({ path, message: 'is required' });
		return undefined;
	}
	if (typeof value !== 'string') {
		issues.push({ path, message: 'must be a string' });
		return undefined;
	}
	const trimmed = value.trim();
	if (!options?.allowEmpty && trimmed.length === 0) {
		issues.push({ path, message: 'cannot be empty' });
		return undefined;
	}
	return trimmed;
}

function readNumber(
	issues: ValidationIssue[],
	path: string,
	value: unknown,
	options?: { optional?: boolean; min?: number }
): number | undefined {
	if (value === undefined || value === null) {
		if (options?.optional) {
			return undefined;
		}
		issues.push({ path, message: 'is required' });
		return undefined;
	}
	if (typeof value !== 'number' || Number.isNaN(value)) {
		issues.push({ path, message: 'must be a number' });
		return undefined;
	}
	if (typeof options?.min === 'number' && value < options.min) {
		issues.push({ path, message: `must be >= ${options.min}` });
		return undefined;
	}
	return value;
}

function normalizePort(
	issues: ValidationIssue[],
	path: string,
	value: unknown,
	ownerLabel: string
): Port | null {
	if (!isRecord(value)) {
		issues.push({ path, message: `must be an object (${ownerLabel} port)` });
		return null;
	}

	const portName = readString(issues, `${path}.portName`, value.portName);
	const speedGbps = readNumber(issues, `${path}.speedGbps`, value.speedGbps, {
		optional: true,
		min: 0
	});

	let connectedTo: Port['connectedTo'];
	if (value.connectedTo !== undefined) {
		if (!isRecord(value.connectedTo)) {
			issues.push({ path: `${path}.connectedTo`, message: 'must be an object' });
		} else {
			const device = readString(issues, `${path}.connectedTo.device`, value.connectedTo.device);
			const port = readString(issues, `${path}.connectedTo.port`, value.connectedTo.port);
			if (device && port) {
				connectedTo = { device, port };
			}
		}
	}

	if (!portName) {
		return null;
	}

	return {
		portName,
		...(typeof speedGbps === 'number' ? { speedGbps } : {}),
		...(connectedTo ? { connectedTo } : {})
	};
}

function validatePortUniqueness(
	issues: ValidationIssue[],
	ports: Port[],
	path: string,
	ownerName: string
) {
	const seen = new Set<string>();
	for (let index = 0; index < ports.length; index += 1) {
		const key = ports[index].portName.toLowerCase();
		if (seen.has(key)) {
			issues.push({
				path: `${path}[${index}].portName`,
				message: `duplicate port name "${ports[index].portName}" for ${ownerName}`
			});
		}
		seen.add(key);
	}
}

function normalizeVm(issues: ValidationIssue[], path: string, value: unknown): VM | null {
	if (!isRecord(value)) {
		issues.push({ path, message: 'must be an object (vm)' });
		return null;
	}
	const name = readString(issues, `${path}.name`, value.name);
	const role = readString(issues, `${path}.role`, value.role);
	const ipAddress = readString(issues, `${path}.ipAddress`, value.ipAddress);
	const iconKey = readString(issues, `${path}.iconKey`, value.iconKey, { optional: true });

	if (!name || !role || !ipAddress) {
		return null;
	}

	return {
		name,
		role,
		ipAddress,
		...(iconKey ? { iconKey } : {})
	};
}

function normalizeMachine(issues: ValidationIssue[], path: string, value: unknown): Machine | null {
	if (!isRecord(value)) {
		issues.push({ path, message: 'must be an object (machine)' });
		return null;
	}

	const machineName = readString(issues, `${path}.machineName`, value.machineName);
	const ipAddress = readString(issues, `${path}.ipAddress`, value.ipAddress);
	const role = readString(issues, `${path}.role`, value.role);
	const operatingSystem = readString(issues, `${path}.operatingSystem`, value.operatingSystem);
	const iconKey = readString(issues, `${path}.iconKey`, value.iconKey, { optional: true });

	const softwareRaw = value.software;
	if (!isRecord(softwareRaw)) {
		issues.push({ path: `${path}.software`, message: 'must be an object' });
	}
	const vmRaw = isRecord(softwareRaw) ? softwareRaw.vms : undefined;
	if (!Array.isArray(vmRaw)) {
		issues.push({ path: `${path}.software.vms`, message: 'must be an array' });
	}
	const vms: VM[] = [];
	for (const [vmIndex, vmValue] of (Array.isArray(vmRaw) ? vmRaw : []).entries()) {
		const vm = normalizeVm(issues, `${path}.software.vms[${vmIndex}]`, vmValue);
		if (vm) {
			vms.push(vm);
		}
	}

	const vmSeen = new Set<string>();
	for (const [vmIndex, vm] of vms.entries()) {
		const vmKey = vm.name.toLowerCase();
		if (vmSeen.has(vmKey)) {
			issues.push({
				path: `${path}.software.vms[${vmIndex}].name`,
				message: `duplicate VM name "${vm.name}" for machine "${machineName ?? 'unknown'}"`
			});
		}
		vmSeen.add(vmKey);
	}

	const hardwareRaw = value.hardware;
	if (!isRecord(hardwareRaw)) {
		issues.push({ path: `${path}.hardware`, message: 'must be an object' });
	}
	const hardware = {
		cpu: readString(issues, `${path}.hardware.cpu`, isRecord(hardwareRaw) ? hardwareRaw.cpu : undefined),
		ram: readString(issues, `${path}.hardware.ram`, isRecord(hardwareRaw) ? hardwareRaw.ram : undefined),
		networkPorts: readNumber(
			issues,
			`${path}.hardware.networkPorts`,
			isRecord(hardwareRaw) ? hardwareRaw.networkPorts : undefined,
			{ min: 0 }
		),
		networkPortSpeedGbps: readNumber(
			issues,
			`${path}.hardware.networkPortSpeedGbps`,
			isRecord(hardwareRaw) ? hardwareRaw.networkPortSpeedGbps : undefined,
			{ optional: true, min: 0 }
		),
		gpu: readString(issues, `${path}.hardware.gpu`, isRecord(hardwareRaw) ? hardwareRaw.gpu : undefined, {
			optional: true,
			allowEmpty: true
		})
	};

	const portsRaw = value.ports;
	if (portsRaw !== undefined && !Array.isArray(portsRaw)) {
		issues.push({ path: `${path}.ports`, message: 'must be an array when provided' });
	}
	const ports: Port[] = [];
	for (const [portIndex, portValue] of (Array.isArray(portsRaw) ? portsRaw : []).entries()) {
		const port = normalizePort(issues, `${path}.ports[${portIndex}]`, portValue, 'machine');
		if (port) {
			ports.push(port);
		}
	}
	validatePortUniqueness(issues, ports, `${path}.ports`, machineName ?? 'machine');

	if (
		!machineName ||
		!ipAddress ||
		!role ||
		!operatingSystem ||
		!hardware.cpu ||
		!hardware.ram ||
		typeof hardware.networkPorts !== 'number'
	) {
		return null;
	}

	return {
		machineName,
		ipAddress,
		role,
		operatingSystem,
		...(iconKey ? { iconKey } : {}),
		software: { vms },
		hardware: {
			cpu: hardware.cpu,
			ram: hardware.ram,
			networkPorts: hardware.networkPorts,
			...(typeof hardware.networkPortSpeedGbps === 'number'
				? { networkPortSpeedGbps: hardware.networkPortSpeedGbps }
				: {}),
			...(hardware.gpu ? { gpu: hardware.gpu } : {})
		},
		ports
	};
}

function normalizeDevice(
	issues: ValidationIssue[],
	path: string,
	value: unknown
): NetworkDevice | null {
	if (!isRecord(value)) {
		issues.push({ path, message: 'must be an object (device)' });
		return null;
	}

	const name = readString(issues, `${path}.name`, value.name);
	const ipAddress = readString(issues, `${path}.ipAddress`, value.ipAddress);
	const type = readString(issues, `${path}.type`, value.type);
	const notes = readString(issues, `${path}.notes`, value.notes, { optional: true, allowEmpty: true });
	const iconKey = readString(issues, `${path}.iconKey`, value.iconKey, { optional: true });

	const portsRaw = value.ports;
	if (portsRaw !== undefined && !Array.isArray(portsRaw)) {
		issues.push({ path: `${path}.ports`, message: 'must be an array when provided' });
	}
	const ports: Port[] = [];
	for (const [portIndex, portValue] of (Array.isArray(portsRaw) ? portsRaw : []).entries()) {
		const port = normalizePort(issues, `${path}.ports[${portIndex}]`, portValue, 'device');
		if (port) {
			ports.push(port);
		}
	}
	validatePortUniqueness(issues, ports, `${path}.ports`, name ?? 'device');

	if (!name || !ipAddress || !type) {
		return null;
	}

	return {
		name,
		ipAddress,
		type,
		...(iconKey ? { iconKey } : {}),
		...(notes !== undefined ? { notes } : {}),
		ports
	};
}

export function validateNetworkData(value: unknown): ValidationResult {
	const issues: ValidationIssue[] = [];
	if (!isRecord(value)) {
		return {
			valid: false,
			errors: [{ path: '$', message: 'must be an object with machines/devices arrays' }]
		};
	}

	const machinesRaw = value.machines;
	if (!Array.isArray(machinesRaw)) {
		issues.push({ path: '$.machines', message: 'must be an array' });
	}

	const devicesRaw = value.devices;
	if (!Array.isArray(devicesRaw)) {
		issues.push({ path: '$.devices', message: 'must be an array' });
	}

	const machines: Machine[] = [];
	for (const [machineIndex, machineValue] of (Array.isArray(machinesRaw) ? machinesRaw : []).entries()) {
		const machine = normalizeMachine(issues, `$.machines[${machineIndex}]`, machineValue);
		if (machine) {
			machines.push(machine);
		}
	}

	const devices: NetworkDevice[] = [];
	for (const [deviceIndex, deviceValue] of (Array.isArray(devicesRaw) ? devicesRaw : []).entries()) {
		const device = normalizeDevice(issues, `$.devices[${deviceIndex}]`, deviceValue);
		if (device) {
			devices.push(device);
		}
	}

	const seenMachineNames = new Set<string>();
	for (const [index, machine] of machines.entries()) {
		const key = machine.machineName.toLowerCase();
		if (seenMachineNames.has(key)) {
			issues.push({
				path: `$.machines[${index}].machineName`,
				message: `duplicate machine name "${machine.machineName}"`
			});
		}
		seenMachineNames.add(key);
	}

	const seenDeviceNames = new Set<string>();
	for (const [index, device] of devices.entries()) {
		const key = device.name.toLowerCase();
		if (seenDeviceNames.has(key)) {
			issues.push({
				path: `$.devices[${index}].name`,
				message: `duplicate device name "${device.name}"`
			});
		}
		seenDeviceNames.add(key);
	}

	for (const [index, machine] of machines.entries()) {
		if (seenDeviceNames.has(machine.machineName.toLowerCase())) {
			issues.push({
				path: `$.machines[${index}].machineName`,
				message: `name "${machine.machineName}" collides with a device name`
			});
		}
	}

	const data: NetworkData = {
		machines,
		devices
	};

	return {
		valid: issues.length === 0,
		errors: issues,
		...(issues.length === 0 ? { data } : {})
	};
}

export function normalizeNetworkData(data: NetworkData): NetworkData {
	const cloned = deepClone(data);
	const validated = validateNetworkData(cloned);
	if (!validated.valid || !validated.data) {
		return {
			machines: [],
			devices: []
		};
	}
	return validated.data;
}
