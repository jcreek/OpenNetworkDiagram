/**
 * @typedef {{ path: string; message: string }} ValidationIssue
 * @typedef {{ type?: string; color?: string; lengthM?: number }} CableInfo
 * @typedef {{ device: string; port: string; cable?: CableInfo }} ConnectedTo
 * @typedef {{ portName: string; speedGbps?: number; macAddress?: string; connectedTo?: ConnectedTo }} Port
 * @typedef {{ name: string; role: string; ipAddress: string; iconKey?: string; macAddress?: string }} VM
 * @typedef {{ cpu: string; ram: string; networkPorts: number; networkPortSpeedGbps?: number; gpu?: string }} Hardware
 * @typedef {{ machineName: string; ipAddress: string; role: string; operatingSystem: string; iconKey?: string; notes?: string; software: { vms: VM[] }; hardware: Hardware; ports?: Port[] }} Machine
 * @typedef {{ name: string; ipAddress: string; type: string; iconKey?: string; notes?: string; ports?: Port[] }} NetworkDevice
 * @typedef {{ cidr: string; name?: string; vlanId?: number }} Subnet
 * @typedef {{ machines: Machine[]; devices: NetworkDevice[]; subnets?: Subnet[] }} NetworkData
 * @typedef {{ valid: boolean; errors: ValidationIssue[]; data?: NetworkData }} ValidationResult
 * @typedef {{ allowEmpty?: boolean; optional?: boolean }} ReadStringOptions
 * @typedef {{ optional?: boolean; min?: number }} ReadNumberOptions
 * @typedef {{ port: Port; originalIndex: number }} PortEntry
 * @typedef {{ vm: VM; originalIndex: number }} VmEntry
 */

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepClone(value) {
	if (typeof structuredClone === 'function') {
		return structuredClone(value);
	}
	return JSON.parse(JSON.stringify(value));
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {ValidationIssue[]} issues
 * @param {string} path
 * @param {unknown} value
 * @param {ReadStringOptions} [options]
 * @returns {string | undefined}
 */
function readString(issues, path, value, options) {
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

/**
 * @param {ValidationIssue[]} issues
 * @param {string} path
 * @param {unknown} value
 * @param {ReadNumberOptions} [options]
 * @returns {number | undefined}
 */
function readNumber(issues, path, value, options) {
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

/**
 * @param {ValidationIssue[]} issues
 * @param {string} path
 * @param {unknown} value
 * @param {string} ownerLabel
 * @returns {Port | null}
 */
export function normalizePort(issues, path, value, ownerLabel) {
	if (!isRecord(value)) {
		issues.push({ path, message: `must be an object (${ownerLabel} port)` });
		return null;
	}

	const portName = readString(issues, `${path}.portName`, value.portName);
	const speedGbps = readNumber(issues, `${path}.speedGbps`, value.speedGbps, {
		optional: true,
		min: 0
	});
	const macAddress = readString(issues, `${path}.macAddress`, value.macAddress, {
		optional: true,
		allowEmpty: true
	});

	let connectedTo;
	if (value.connectedTo !== undefined) {
		if (!isRecord(value.connectedTo)) {
			issues.push({ path: `${path}.connectedTo`, message: 'must be an object' });
		} else {
			const device = readString(issues, `${path}.connectedTo.device`, value.connectedTo.device);
			const port = readString(issues, `${path}.connectedTo.port`, value.connectedTo.port);
			let cable;
			const cableRaw = value.connectedTo.cable;
			if (cableRaw !== undefined) {
				if (!isRecord(cableRaw)) {
					issues.push({ path: `${path}.connectedTo.cable`, message: 'must be an object' });
				} else {
					const cableType = readString(issues, `${path}.connectedTo.cable.type`, cableRaw.type, {
						optional: true,
						allowEmpty: true
					});
					const cableColor = readString(issues, `${path}.connectedTo.cable.color`, cableRaw.color, {
						optional: true,
						allowEmpty: true
					});
					const lengthM = readNumber(issues, `${path}.connectedTo.cable.lengthM`, cableRaw.lengthM, {
						optional: true,
						min: 0
					});
					const candidate = {
						...(cableType ? { type: cableType } : {}),
						...(cableColor ? { color: cableColor } : {}),
						...(typeof lengthM === 'number' ? { lengthM } : {})
					};
					if (Object.keys(candidate).length > 0) {
						cable = candidate;
					}
				}
			}
			if (device && port) {
				connectedTo = { device, port, ...(cable ? { cable } : {}) };
			}
		}
	}

	if (!portName) {
		return null;
	}

	return {
		portName,
		...(typeof speedGbps === 'number' ? { speedGbps } : {}),
		...(macAddress ? { macAddress } : {}),
		...(connectedTo ? { connectedTo } : {})
	};
}

/**
 * @param {ValidationIssue[]} issues
 * @param {PortEntry[]} portEntries
 * @param {string} path
 * @param {string} ownerName
 * @returns {void}
 */
function validatePortUniqueness(issues, portEntries, path, ownerName) {
	const seen = new Set();
	for (const { port, originalIndex } of portEntries) {
		const key = port.portName.toLowerCase();
		if (seen.has(key)) {
			issues.push({
				path: `${path}[${originalIndex}].portName`,
				message: `duplicate port name "${port.portName}" for ${ownerName}`
			});
		}
		seen.add(key);
	}
}

/**
 * @param {ValidationIssue[]} issues
 * @param {string} path
 * @param {unknown} value
 * @returns {VM | null}
 */
export function normalizeVm(issues, path, value) {
	if (!isRecord(value)) {
		issues.push({ path, message: 'must be an object (vm)' });
		return null;
	}
	const name = readString(issues, `${path}.name`, value.name);
	const role = readString(issues, `${path}.role`, value.role);
	const ipAddress = readString(issues, `${path}.ipAddress`, value.ipAddress);
	const iconKey = readString(issues, `${path}.iconKey`, value.iconKey, { optional: true });
	const macAddress = readString(issues, `${path}.macAddress`, value.macAddress, {
		optional: true,
		allowEmpty: true
	});

	if (!name || !role || !ipAddress) {
		return null;
	}

	return {
		name,
		role,
		ipAddress,
		...(iconKey ? { iconKey } : {}),
		...(macAddress ? { macAddress } : {})
	};
}

/**
 * @param {ValidationIssue[]} issues
 * @param {string} path
 * @param {unknown} value
 * @returns {Machine | null}
 */
function normalizeMachine(issues, path, value) {
	if (!isRecord(value)) {
		issues.push({ path, message: 'must be an object (machine)' });
		return null;
	}

	const machineName = readString(issues, `${path}.machineName`, value.machineName);
	const ipAddress = readString(issues, `${path}.ipAddress`, value.ipAddress);
	const role = readString(issues, `${path}.role`, value.role);
	const operatingSystem = readString(issues, `${path}.operatingSystem`, value.operatingSystem);
	const iconKey = readString(issues, `${path}.iconKey`, value.iconKey, { optional: true });
	const notes = readString(issues, `${path}.notes`, value.notes, { optional: true, allowEmpty: true });

	const softwareRaw = value.software;
	if (!isRecord(softwareRaw)) {
		issues.push({ path: `${path}.software`, message: 'must be an object' });
	}
	const vmRaw = isRecord(softwareRaw) ? softwareRaw.vms : undefined;
	if (!Array.isArray(vmRaw)) {
		issues.push({ path: `${path}.software.vms`, message: 'must be an array' });
	}
	/** @type {VmEntry[]} */
	const vmEntries = [];
	const vms = [];
	for (const [vmIndex, vmValue] of (Array.isArray(vmRaw) ? vmRaw : []).entries()) {
		const vm = normalizeVm(issues, `${path}.software.vms[${vmIndex}]`, vmValue);
		if (vm) {
			vmEntries.push({ vm, originalIndex: vmIndex });
			vms.push(vm);
		}
	}

	const vmSeen = new Set();
	for (const { vm, originalIndex } of vmEntries) {
		const vmKey = vm.name.toLowerCase();
		if (vmSeen.has(vmKey)) {
			issues.push({
				path: `${path}.software.vms[${originalIndex}].name`,
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
	/** @type {PortEntry[]} */
	const portEntries = [];
	const ports = [];
	for (const [portIndex, portValue] of (Array.isArray(portsRaw) ? portsRaw : []).entries()) {
		const port = normalizePort(issues, `${path}.ports[${portIndex}]`, portValue, 'machine');
		if (port) {
			portEntries.push({ port, originalIndex: portIndex });
			ports.push(port);
		}
	}
	validatePortUniqueness(issues, portEntries, `${path}.ports`, machineName ?? 'machine');

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
		...(notes !== undefined ? { notes } : {}),
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

/**
 * @param {ValidationIssue[]} issues
 * @param {string} path
 * @param {unknown} value
 * @returns {NetworkDevice | null}
 */
function normalizeDevice(issues, path, value) {
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
	/** @type {PortEntry[]} */
	const portEntries = [];
	const ports = [];
	for (const [portIndex, portValue] of (Array.isArray(portsRaw) ? portsRaw : []).entries()) {
		const port = normalizePort(issues, `${path}.ports[${portIndex}]`, portValue, 'device');
		if (port) {
			portEntries.push({ port, originalIndex: portIndex });
			ports.push(port);
		}
	}
	validatePortUniqueness(issues, portEntries, `${path}.ports`, name ?? 'device');

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

const ipv4CidrPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

/**
 * @param {string} cidr
 * @returns {boolean}
 */
export function isValidIpv4Cidr(cidr) {
	const match = ipv4CidrPattern.exec(cidr);
	if (!match) {
		return false;
	}
	const octets = match.slice(1, 5).map(Number);
	const prefix = Number(match[5]);
	return octets.every((octet) => octet <= 255) && prefix <= 32;
}

/**
 * @param {ValidationIssue[]} issues
 * @param {string} path
 * @param {unknown} value
 * @returns {Subnet | null}
 */
function normalizeSubnet(issues, path, value) {
	if (!isRecord(value)) {
		issues.push({ path, message: 'must be an object (subnet)' });
		return null;
	}

	const cidr = readString(issues, `${path}.cidr`, value.cidr);
	if (cidr && !isValidIpv4Cidr(cidr)) {
		issues.push({ path: `${path}.cidr`, message: 'must be an IPv4 CIDR like "192.168.1.0/24"' });
		return null;
	}
	const name = readString(issues, `${path}.name`, value.name, { optional: true, allowEmpty: true });
	const vlanId = readNumber(issues, `${path}.vlanId`, value.vlanId, { optional: true, min: 1 });
	if (typeof vlanId === 'number' && vlanId > 4094) {
		issues.push({ path: `${path}.vlanId`, message: 'must be <= 4094' });
		return null;
	}

	if (!cidr) {
		return null;
	}

	return {
		cidr,
		...(name ? { name } : {}),
		...(typeof vlanId === 'number' ? { vlanId } : {})
	};
}

/**
 * @param {unknown} value
 * @returns {ValidationResult}
 */
export function validateNetworkData(value) {
	/** @type {ValidationIssue[]} */
	const issues = [];
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

	const machines = [];
	const machineEntries = [];
	for (const [machineIndex, machineValue] of (Array.isArray(machinesRaw) ? machinesRaw : []).entries()) {
		const machine = normalizeMachine(issues, `$.machines[${machineIndex}]`, machineValue);
		if (machine) {
			machines.push(machine);
			machineEntries.push({ machine, originalIndex: machineIndex });
		}
	}

	const devices = [];
	const deviceEntries = [];
	for (const [deviceIndex, deviceValue] of (Array.isArray(devicesRaw) ? devicesRaw : []).entries()) {
		const device = normalizeDevice(issues, `$.devices[${deviceIndex}]`, deviceValue);
		if (device) {
			devices.push(device);
			deviceEntries.push({ device, originalIndex: deviceIndex });
		}
	}

	const seenMachineNames = new Set();
	for (const { machine, originalIndex } of machineEntries) {
		const key = machine.machineName.toLowerCase();
		if (seenMachineNames.has(key)) {
			issues.push({
				path: `$.machines[${originalIndex}].machineName`,
				message: `duplicate machine name "${machine.machineName}"`
			});
		}
		seenMachineNames.add(key);
	}

	const seenDeviceNames = new Set();
	for (const { device, originalIndex } of deviceEntries) {
		const key = device.name.toLowerCase();
		if (seenDeviceNames.has(key)) {
			issues.push({
				path: `$.devices[${originalIndex}].name`,
				message: `duplicate device name "${device.name}"`
			});
		}
		seenDeviceNames.add(key);
	}

	for (const { machine, originalIndex } of machineEntries) {
		if (seenDeviceNames.has(machine.machineName.toLowerCase())) {
			issues.push({
				path: `$.machines[${originalIndex}].machineName`,
				message: `name "${machine.machineName}" collides with a device name`
			});
		}
	}

	const subnetsRaw = value.subnets;
	const subnetsProvided = subnetsRaw !== undefined;
	if (subnetsProvided && !Array.isArray(subnetsRaw)) {
		issues.push({ path: '$.subnets', message: 'must be an array when provided' });
	}
	const subnets = [];
	const subnetEntries = [];
	for (const [subnetIndex, subnetValue] of (Array.isArray(subnetsRaw) ? subnetsRaw : []).entries()) {
		const subnet = normalizeSubnet(issues, `$.subnets[${subnetIndex}]`, subnetValue);
		if (subnet) {
			subnets.push(subnet);
			subnetEntries.push({ subnet, originalIndex: subnetIndex });
		}
	}

	const seenCidrs = new Set();
	for (const { subnet, originalIndex } of subnetEntries) {
		if (seenCidrs.has(subnet.cidr)) {
			issues.push({
				path: `$.subnets[${originalIndex}].cidr`,
				message: `duplicate subnet CIDR "${subnet.cidr}"`
			});
		}
		seenCidrs.add(subnet.cidr);
	}

	const data = {
		machines,
		devices,
		...(subnetsProvided ? { subnets } : {})
	};

	return {
		valid: issues.length === 0,
		errors: issues,
		...(issues.length === 0 ? { data } : {})
	};
}

/**
 * @param {NetworkData} data
 * @returns {NetworkData}
 */
export function normalizeNetworkData(data) {
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
