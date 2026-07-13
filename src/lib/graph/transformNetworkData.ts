import type { ConnectedPortRef, NetworkData, Port, Subnet } from '../types';
import { cidrContains, parseCidr } from '../data/ipam';
import { resolveIconPath } from '../config/iconRegistry';
import { buildVlanIndexMap } from './vlanPalette';
import {
	NODE_DIMENSIONS,
	estimatePillWidth,
	type DeviceClass,
	type GraphEdgeElement,
	type GraphNodeElement,
	type GraphTransformResult
} from './types';

interface EndpointOwner {
	kind: 'machine' | 'device';
	nodeId: string;
	name: string;
	ports: Map<string, Port>;
}

function normalizeOwnerName(name: string): string {
	return name.trim().toLowerCase();
}

function toOwnerLookupKey(kind: EndpointOwner['kind'], name: string): string {
	return `${kind}:${normalizeOwnerName(name)}`;
}

function toMachineNodeId(name: string): string {
	return `machine:${encodeURIComponent(name)}`;
}

function toDeviceNodeId(name: string): string {
	return `device:${encodeURIComponent(name)}`;
}

function toVmNodeId(hostName: string, vmName: string): string {
	return `vm:${encodeURIComponent(hostName)}:${encodeURIComponent(vmName)}`;
}

function parseConnectedTo(connection: Port['connectedTo']): ConnectedPortRef | null {
	if (!connection?.device || !connection?.port) {
		return null;
	}
	return {
		device: connection.device.trim(),
		port: connection.port.trim()
	};
}

function hasReciprocalLink(
	targetPort: Port | undefined,
	expectedDeviceName: string,
	expectedPortName: string
): boolean {
	const reverse = parseConnectedTo(targetPort?.connectedTo);
	if (!reverse) {
		return false;
	}
	return reverse.device === expectedDeviceName && reverse.port === expectedPortName;
}

function connectionKey(a: string, b: string): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const cableColorHex: Record<string, string> = {
	blue: '#3b82f6',
	red: '#ef4444',
	green: '#22c55e',
	yellow: '#eab308',
	orange: '#f97316',
	purple: '#a855f7',
	pink: '#ec4899',
	white: '#e2e8f0',
	grey: '#94a3b8',
	gray: '#94a3b8',
	black: '#334155'
};

function resolveCableColor(name: string | undefined): string | undefined {
	if (!name) {
		return undefined;
	}
	const trimmed = name.trim();
	return (
		cableColorHex[trimmed.toLowerCase()] ??
		(/^#[0-9a-fA-F]{3,8}$/.test(trimmed) ? trimmed : undefined)
	);
}

function buildVlanResolver(subnets: Subnet[] | undefined) {
	const vlanSubnets = (subnets ?? [])
		.filter((subnet) => typeof subnet.vlanId === 'number')
		.sort((a, b) => (parseCidr(b.cidr)?.prefix ?? 0) - (parseCidr(a.cidr)?.prefix ?? 0));
	const vlanIndexById = buildVlanIndexMap(subnets);
	return (ip: string): { vlanId: number; vlanIndex: number } | undefined => {
		const home = vlanSubnets.find((subnet) => cidrContains(subnet.cidr, ip));
		if (!home || typeof home.vlanId !== 'number') {
			return undefined;
		}
		return { vlanId: home.vlanId, vlanIndex: vlanIndexById.get(home.vlanId) ?? 0 };
	};
}

// Devices whose type reads as network infrastructure get the dark "infra"
// treatment on the map; everything else (consoles, peripherals, UPSes) is an
// unmanaged "dumb" device rendered as a dashed pill.
const infrastructureTypePattern =
	/switch|router|firewall|gateway|access\s?point|\bap\b|wan|isp|modem|dns|patch\s?panel/i;

export function classifyDevice(type: string | undefined): DeviceClass {
	return type && infrastructureTypePattern.test(type) ? 'infrastructure' : 'dumb';
}

function edgeSpeed(a: number | undefined, b: number | undefined): number | undefined {
	if (typeof a === 'number' && typeof b === 'number') {
		return Math.min(a, b);
	}
	if (typeof a === 'number') {
		return a;
	}
	if (typeof b === 'number') {
		return b;
	}
	return undefined;
}

export default function transformNetworkDataToGraph(data: NetworkData): GraphTransformResult {
	const nodes: GraphNodeElement[] = [];
	const edges: GraphEdgeElement[] = [];
	const warnings: string[] = [];
	const machineVmIndex: Record<
		string,
		{
			vmNodeIds: string[];
			hostingEdgeIds: string[];
			vmCount: number;
		}
	> = {};
	const ownersByLookup = new Map<string, EndpointOwner>();
	const seenWarnings = new Set<string>();
	const resolveVlan = buildVlanResolver(data.subnets);

	const warn = (message: string) => {
		if (!seenWarnings.has(message)) {
			seenWarnings.add(message);
			warnings.push(message);
		}
	};

	const addOwner = (owner: EndpointOwner) => {
		const ownerLookupKey = toOwnerLookupKey(owner.kind, owner.name);
		if (ownersByLookup.has(ownerLookupKey)) {
			warn(
				`Duplicate ${owner.kind} name "${owner.name}" found. First occurrence will be used for link resolution.`
			);
			return;
		}
		ownersByLookup.set(ownerLookupKey, owner);
	};

	let hostingEdgeCounter = 0;

	for (const machine of data.machines) {
		const machineNodeId = toMachineNodeId(machine.machineName);
		const machinePortsList = [...(machine.ports ?? [])];
		const sourceMachineVms = machine.software?.vms ?? [];
		const machineVms = sourceMachineVms.map((vm) => ({
			name: vm.name,
			ip: vm.ipAddress,
			role: vm.role,
			macAddress: vm.macAddress
		}));

		nodes.push({
			data: {
				id: machineNodeId,
				label: machine.machineName,
				rawName: machine.machineName,
				kind: 'machine',
				iconKey: machine.iconKey,
				iconUrl: resolveIconPath(machine.iconKey),
				nodeWidth: NODE_DIMENSIONS.machine.width,
				nodeHeight: NODE_DIMENSIONS.machine.height,
				meta: machine.ipAddress,
				vmCount: sourceMachineVms.length,
				...resolveVlan(machine.ipAddress),
				details: {
					type: 'machine',
					name: machine.machineName,
					iconKey: machine.iconKey,
					ip: machine.ipAddress,
					role: machine.role,
					os: machine.operatingSystem,
					cpu: machine.hardware?.cpu ?? 'Unknown',
					ram: machine.hardware?.ram ?? 'Unknown',
					gpu: machine.hardware?.gpu ?? undefined,
					notes: machine.notes,
					ports: machinePortsList,
					vmCount: machineVms.length,
					vms: machineVms
				}
			}
		});

		machineVmIndex[machineNodeId] = {
			vmNodeIds: [],
			hostingEdgeIds: [],
			vmCount: sourceMachineVms.length
		};

		for (const vm of sourceMachineVms) {
			const vmNodeId = toVmNodeId(machine.machineName, vm.name);

			nodes.push({
				data: {
					id: vmNodeId,
					label: vm.name,
					rawName: vm.name,
					kind: 'vm',
					hostMachineId: machineNodeId,
					iconKey: vm.iconKey,
					iconUrl: resolveIconPath(vm.iconKey),
					nodeWidth: NODE_DIMENSIONS.vm.width,
					nodeHeight: NODE_DIMENSIONS.vm.height,
					meta: vm.ipAddress,
					...resolveVlan(vm.ipAddress),
					details: {
						type: 'vm',
						name: vm.name,
						iconKey: vm.iconKey,
						ip: vm.ipAddress,
						role: vm.role,
						macAddress: vm.macAddress,
						hostName: machine.machineName
					}
				}
			});

			hostingEdgeCounter += 1;
			const hostingEdgeId = `hosting:${hostingEdgeCounter}`;
			edges.push({
				data: {
					id: hostingEdgeId,
					source: machineNodeId,
					target: vmNodeId,
					kind: 'hosting'
				}
			});

			machineVmIndex[machineNodeId].vmNodeIds.push(vmNodeId);
			machineVmIndex[machineNodeId].hostingEdgeIds.push(hostingEdgeId);
		}

		const machinePorts = new Map<string, Port>();
		for (const port of machine.ports ?? []) {
			machinePorts.set(port.portName, port);
		}

		addOwner({
			kind: 'machine',
			nodeId: machineNodeId,
			name: machine.machineName,
			ports: machinePorts
		});
	}

	for (const device of data.devices) {
		const deviceNodeId = toDeviceNodeId(device.name);
		const devicePorts = [...(device.ports ?? [])];
		const deviceClass = classifyDevice(device.type);
		const portsInUse = devicePorts.filter((port) => parseConnectedTo(port.connectedTo)).length;
		let deviceMeta: string | undefined;
		if (deviceClass === 'infrastructure') {
			deviceMeta =
				devicePorts.length > 0
					? `${devicePorts.length} ${devicePorts.length === 1 ? 'port' : 'ports'} · ${portsInUse} in use`
					: device.ipAddress;
		}

		nodes.push({
			data: {
				id: deviceNodeId,
				label: device.name,
				rawName: device.name,
				kind: 'device',
				deviceClass,
				iconKey: device.iconKey,
				iconUrl: resolveIconPath(device.iconKey),
				nodeWidth:
					deviceClass === 'infrastructure'
						? NODE_DIMENSIONS.infrastructure.width
						: estimatePillWidth(device.name),
				nodeHeight:
					deviceClass === 'infrastructure'
						? NODE_DIMENSIONS.infrastructure.height
						: NODE_DIMENSIONS.dumbHeight,
				...(deviceMeta ? { meta: deviceMeta } : {}),
				...resolveVlan(device.ipAddress),
				details: {
					type: 'device',
					name: device.name,
					iconKey: device.iconKey,
					ip: device.ipAddress,
					deviceType: device.type,
					notes: device.notes,
					ports: devicePorts
				}
			}
		});

		const devicePortMap = new Map<string, Port>();
		for (const port of device.ports ?? []) {
			devicePortMap.set(port.portName, port);
		}

		addOwner({
			kind: 'device',
			nodeId: deviceNodeId,
			name: device.name,
			ports: devicePortMap
		});
	}

	const seenPhysicalConnections = new Set<string>();
	let physicalEdgeCounter = 0;

	for (const owner of ownersByLookup.values()) {
		for (const port of owner.ports.values()) {
			const connectedTo = parseConnectedTo(port.connectedTo);
			if (!connectedTo) {
				continue;
			}

			const machineTargetOwner = ownersByLookup.get(
				toOwnerLookupKey('machine', connectedTo.device)
			);
			const deviceTargetOwner = ownersByLookup.get(toOwnerLookupKey('device', connectedTo.device));
			if (machineTargetOwner && deviceTargetOwner) {
				warn(
					`Link from "${owner.name}:${port.portName}" references ambiguous device "${connectedTo.device}" (matches both machine and device names).`
				);
				continue;
			}

			const targetOwner = machineTargetOwner ?? deviceTargetOwner;
			if (!targetOwner) {
				warn(
					`Link from "${owner.name}:${port.portName}" references unknown device "${connectedTo.device}".`
				);
				continue;
			}

			const targetPort = targetOwner.ports.get(connectedTo.port);
			if (!targetPort) {
				warn(
					`Link from "${owner.name}:${port.portName}" references unknown port "${connectedTo.device}:${connectedTo.port}".`
				);
				continue;
			}

			const a = `${owner.nodeId}:${port.portName}`;
			const b = `${targetOwner.nodeId}:${connectedTo.port}`;
			const dedupeKey = connectionKey(a, b);
			if (seenPhysicalConnections.has(dedupeKey)) {
				continue;
			}
			seenPhysicalConnections.add(dedupeKey);

			const reciprocal = hasReciprocalLink(targetPort, owner.name, port.portName);
			if (!reciprocal) {
				warn(
					`Non-reciprocal link: "${owner.name}:${port.portName}" points to "${connectedTo.device}:${connectedTo.port}" but reverse link is missing.`
				);
			}

			physicalEdgeCounter += 1;
			const speedGbps = edgeSpeed(port.speedGbps, targetPort.speedGbps);
			const cable = port.connectedTo?.cable ?? targetPort.connectedTo?.cable;

			// One chip per cable: interface name (prefer the machine side —
			// "eth0" reads better than "port 3") plus speed, with the network
			// default of 1GbE omitted so only exceptions are informative.
			const ifname =
				owner.kind !== 'machine' && targetOwner.kind === 'machine'
					? connectedTo.port
					: port.portName;
			const chipLabelNoSpeed = ifname;
			const chipLabel =
				typeof speedGbps === 'number' && speedGbps !== 1 ? `${ifname} · ${speedGbps}GbE` : ifname;

			edges.push({
				data: {
					id: `physical:${physicalEdgeCounter}`,
					source: owner.nodeId,
					target: targetOwner.nodeId,
					kind: 'physical',
					chipLabel,
					chipLabelNoSpeed,
					sourcePort: port.portName,
					targetPort: connectedTo.port,
					speedGbps,
					reciprocal,
					...(cable?.type ? { cableType: cable.type } : {}),
					...(cable?.color ? { cableColorName: cable.color } : {}),
					...(resolveCableColor(cable?.color)
						? { cableColor: resolveCableColor(cable?.color) }
						: {}),
					...(typeof cable?.lengthM === 'number' ? { cableLengthM: cable.lengthM } : {})
				}
			});
		}
	}

	return { nodes, edges, warnings, machineVmIndex };
}
