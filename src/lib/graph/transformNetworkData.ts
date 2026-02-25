import type { ConnectedPortRef, NetworkData, Port } from '../types';
import { resolveIconPath } from '../config/iconRegistry';
import type { GraphEdgeElement, GraphNodeElement, GraphTransformResult } from './types';

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
			role: vm.role
		}));

		nodes.push({
			data: {
					id: machineNodeId,
					label: machine.machineName,
					rawName: machine.machineName,
					kind: 'machine',
				iconKey: machine.iconKey,
				iconUrl: resolveIconPath(machine.iconKey),
				nodeWidth: 200,
				nodeHeight: 110,
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
					nodeWidth: 140,
					nodeHeight: 66,
					details: {
						type: 'vm',
						name: vm.name,
						iconKey: vm.iconKey,
						ip: vm.ipAddress,
						role: vm.role,
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
					kind: 'hosting',
					label: 'hosts'
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

		nodes.push({
			data: {
				id: deviceNodeId,
				label: device.name,
				rawName: device.name,
				kind: 'device',
				iconKey: device.iconKey,
				iconUrl: resolveIconPath(device.iconKey),
				nodeWidth: 176,
				nodeHeight: 116,
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

			edges.push({
				data: {
					id: `physical:${physicalEdgeCounter}`,
					source: owner.nodeId,
					target: targetOwner.nodeId,
					kind: 'physical',
					label: speedGbps ? `${speedGbps}GbE` : undefined,
					sourcePort: port.portName,
					targetPort: connectedTo.port,
					speedGbps,
					reciprocal
				}
			});
		}
	}

	return { nodes, edges, warnings, machineVmIndex };
}
