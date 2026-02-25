import type { Machine, NetworkData, NetworkDevice, Port, VM } from '../types';

export type OwnerKind = 'machine' | 'device';

interface OwnerRef {
	kind: OwnerKind;
	name: string;
	ports: Port[];
}

function deepClone<T>(value: T): T {
	if (typeof structuredClone === 'function') {
		return structuredClone(value);
	}
	return JSON.parse(JSON.stringify(value)) as T;
}

function equalsIgnoreCase(a: string, b: string): boolean {
	return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}

function normalizePorts(ports: Port[] | undefined): Port[] {
	return Array.isArray(ports) ? ports : [];
}

function normalizeVms(vms: VM[] | undefined): VM[] {
	return Array.isArray(vms) ? vms : [];
}

function allOwners(data: NetworkData): OwnerRef[] {
	const machineOwners = data.machines.map((machine) => {
		const ports = normalizePorts(machine.ports);
		return {
			kind: 'machine' as const,
			name: machine.machineName,
			ports
		};
	});
	const deviceOwners = data.devices.map((device) => {
		const ports = normalizePorts(device.ports);
		return {
			kind: 'device' as const,
			name: device.name,
			ports
		};
	});
	return [...machineOwners, ...deviceOwners];
}

export function cloneNetworkData(data: NetworkData): NetworkData {
	const cloned = deepClone(data);
	for (const machine of cloned.machines) {
		machine.ports = normalizePorts(machine.ports);
		machine.software = {
			vms: normalizeVms(machine.software?.vms)
		};
	}
	for (const device of cloned.devices) {
		device.ports = normalizePorts(device.ports);
	}
	return cloned;
}

function findOwnerByKindAndName(data: NetworkData, kind: OwnerKind, name: string): OwnerRef | undefined {
	if (kind === 'machine') {
		const machine = data.machines.find((item) => equalsIgnoreCase(item.machineName, name));
		if (!machine) {
			return undefined;
		}
		machine.ports = normalizePorts(machine.ports);
		return {
			kind,
			name: machine.machineName,
			ports: machine.ports
		};
	}

	const device = data.devices.find((item) => equalsIgnoreCase(item.name, name));
	if (!device) {
		return undefined;
	}
	device.ports = normalizePorts(device.ports);
	return {
		kind,
		name: device.name,
		ports: device.ports
	};
}

function findOwnerByName(data: NetworkData, name: string): OwnerRef | undefined {
	const owners = allOwners(data);
	return owners.find((owner) => equalsIgnoreCase(owner.name, name));
}

function findPort(owner: OwnerRef, portName: string): Port | undefined {
	return owner.ports.find((port) => equalsIgnoreCase(port.portName, portName));
}

function ensureReciprocalConnections(data: NetworkData) {
	const owners = allOwners(data);

	for (const owner of owners) {
		for (const port of owner.ports) {
			if (!port.connectedTo) {
				continue;
			}

			const targetOwner = owners.find((candidate) =>
				equalsIgnoreCase(candidate.name, port.connectedTo!.device)
			);
			if (!targetOwner) {
				delete port.connectedTo;
				continue;
			}

				const targetPort = findPort(targetOwner, port.connectedTo.port);
				if (!targetPort) {
					delete port.connectedTo;
					continue;
				}

				const expectedReciprocal = {
					device: owner.name,
					port: port.portName
				};
				if (!targetPort.connectedTo) {
					targetPort.connectedTo = expectedReciprocal;
					continue;
				}

				const hasMatchingReciprocal =
					equalsIgnoreCase(targetPort.connectedTo.device, owner.name) &&
					equalsIgnoreCase(targetPort.connectedTo.port, port.portName);
				if (hasMatchingReciprocal) {
					continue;
				}
			}
		}
	}

function clearInboundReferences(data: NetworkData, predicate: (connection: Port['connectedTo']) => boolean) {
	for (const owner of allOwners(data)) {
		for (const port of owner.ports) {
			if (!port.connectedTo) {
				continue;
			}
			if (predicate(port.connectedTo)) {
				delete port.connectedTo;
			}
		}
	}
}

export function withReconciledConnections(data: NetworkData): NetworkData {
	const cloned = cloneNetworkData(data);
	ensureReciprocalConnections(cloned);
	return cloned;
}

export function createEmptyMachine(): Machine {
	return {
		machineName: 'New Machine',
		ipAddress: '192.168.1.100',
		role: 'Role',
		operatingSystem: 'OS',
		software: {
			vms: []
		},
		hardware: {
			cpu: 'CPU',
			ram: '8GB',
			networkPorts: 1
		},
		ports: []
	};
}

export function createEmptyDevice(): NetworkDevice {
	return {
		name: 'New Device',
		ipAddress: '192.168.1.200',
		type: 'Device',
		notes: '',
		ports: []
	};
}

export function createEmptyVm(): VM {
	return {
		name: 'New VM',
		role: 'Role',
		ipAddress: '192.168.1.201'
	};
}

export function createEmptyPort(prefix = 'eth'): Port {
	return {
		portName: `${prefix}0`,
		speedGbps: 1
	};
}

export function renameOwner(
	data: NetworkData,
	kind: OwnerKind,
	previousName: string,
	nextName: string
): NetworkData {
	const cloned = cloneNetworkData(data);
	if (equalsIgnoreCase(previousName, nextName)) {
		return cloned;
	}

	if (kind === 'machine') {
		const machine = cloned.machines.find((item) => equalsIgnoreCase(item.machineName, previousName));
		if (machine) {
			machine.machineName = nextName;
		}
	} else {
		const device = cloned.devices.find((item) => equalsIgnoreCase(item.name, previousName));
		if (device) {
			device.name = nextName;
		}
	}

	for (const owner of allOwners(cloned)) {
		for (const port of owner.ports) {
			if (port.connectedTo && equalsIgnoreCase(port.connectedTo.device, previousName)) {
				port.connectedTo.device = nextName;
			}
		}
	}

	ensureReciprocalConnections(cloned);
	return cloned;
}

export function renamePort(
	data: NetworkData,
	kind: OwnerKind,
	ownerName: string,
	previousPortName: string,
	nextPortName: string
): NetworkData {
	const cloned = cloneNetworkData(data);
	if (equalsIgnoreCase(previousPortName, nextPortName)) {
		return cloned;
	}

	const owner = findOwnerByKindAndName(cloned, kind, ownerName);
	if (!owner) {
		return cloned;
	}

	const port = findPort(owner, previousPortName);
	if (!port) {
		return cloned;
	}
	port.portName = nextPortName;

	for (const candidateOwner of allOwners(cloned)) {
		for (const candidatePort of candidateOwner.ports) {
			if (
				candidatePort.connectedTo &&
				equalsIgnoreCase(candidatePort.connectedTo.device, owner.name) &&
				equalsIgnoreCase(candidatePort.connectedTo.port, previousPortName)
			) {
				candidatePort.connectedTo.port = nextPortName;
			}
		}
	}

	ensureReciprocalConnections(cloned);
	return cloned;
}

export function deleteOwner(data: NetworkData, kind: OwnerKind, ownerName: string): NetworkData {
	const cloned = cloneNetworkData(data);

	if (kind === 'machine') {
		cloned.machines = cloned.machines.filter((machine) => !equalsIgnoreCase(machine.machineName, ownerName));
	} else {
		cloned.devices = cloned.devices.filter((device) => !equalsIgnoreCase(device.name, ownerName));
	}

	clearInboundReferences(
		cloned,
		(connection) => Boolean(connection && equalsIgnoreCase(connection.device, ownerName))
	);
	ensureReciprocalConnections(cloned);
	return cloned;
}

export function deletePort(
	data: NetworkData,
	kind: OwnerKind,
	ownerName: string,
	portName: string
): NetworkData {
	const cloned = cloneNetworkData(data);
	const owner = findOwnerByKindAndName(cloned, kind, ownerName);
	if (!owner) {
		return cloned;
	}

	owner.ports = owner.ports.filter((port) => !equalsIgnoreCase(port.portName, portName));

	if (kind === 'machine') {
		const machine = cloned.machines.find((item) => equalsIgnoreCase(item.machineName, ownerName));
		if (machine) {
			machine.ports = owner.ports;
		}
	} else {
		const device = cloned.devices.find((item) => equalsIgnoreCase(item.name, ownerName));
		if (device) {
			device.ports = owner.ports;
		}
	}

	clearInboundReferences(
		cloned,
		(connection) =>
			Boolean(
				connection &&
					equalsIgnoreCase(connection.device, ownerName) &&
					equalsIgnoreCase(connection.port, portName)
			)
	);
	ensureReciprocalConnections(cloned);
	return cloned;
}

export function setPortConnection(
	data: NetworkData,
	kind: OwnerKind,
	ownerName: string,
	portName: string,
	target: Port['connectedTo'] | undefined
): NetworkData {
	const cloned = cloneNetworkData(data);
	const owner = findOwnerByKindAndName(cloned, kind, ownerName);
	if (!owner) {
		return cloned;
	}
	const port = findPort(owner, portName);
	if (!port) {
		return cloned;
	}

	const previousConnection = port.connectedTo;
	if (previousConnection) {
		const previousOwner = findOwnerByName(cloned, previousConnection.device);
		const previousPort = previousOwner ? findPort(previousOwner, previousConnection.port) : undefined;
		if (previousPort) {
			delete previousPort.connectedTo;
		}
	}

	if (!target?.device || !target.port) {
		delete port.connectedTo;
		return cloned;
	}

	port.connectedTo = {
		device: target.device,
		port: target.port
	};
	ensureReciprocalConnections(cloned);
	return cloned;
}
