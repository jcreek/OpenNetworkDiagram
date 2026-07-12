export type GraphNodeKind = 'machine' | 'device' | 'vm';
export type GraphEdgeKind = 'physical' | 'hosting';

export interface PortDetails {
	portName: string;
	speedGbps?: number;
	macAddress?: string;
	connectedTo?: {
		device: string;
		port: string;
		cable?: {
			type?: string;
			color?: string;
			lengthM?: number;
		};
	};
}

export interface MachineDetails {
	type: 'machine';
	name: string;
	iconKey?: string;
	ip: string;
	role: string;
	os: string;
	cpu: string;
	ram: string;
	gpu?: string;
	notes?: string;
	ports: PortDetails[];
	vmCount: number;
	vms: Array<{
		name: string;
		ip: string;
		role: string;
		macAddress?: string;
	}>;
}

export interface DeviceDetails {
	type: 'device';
	name: string;
	iconKey?: string;
	ip: string;
	deviceType: string;
	notes?: string;
	ports: PortDetails[];
}

export interface VmDetails {
	type: 'vm';
	name: string;
	iconKey?: string;
	ip: string;
	role: string;
	macAddress?: string;
	hostName: string;
}

export type GraphNodeDetails = MachineDetails | DeviceDetails | VmDetails;

export interface GraphNodeData {
	id: string;
	label: string;
	kind: GraphNodeKind;
	rawName?: string;
	hostMachineId?: string;
	nodeWidth?: number;
	nodeHeight?: number;
	iconUrl?: string;
	iconKey?: string;
	vlanId?: number;
	vlanColor?: string;
	details?: GraphNodeDetails;
}

export interface GraphEdgeData {
	id: string;
	source: string;
	target: string;
	kind: GraphEdgeKind;
	label?: string;
	sourcePort?: string;
	targetPort?: string;
	speedGbps?: number;
	reciprocal?: boolean;
	cableType?: string;
	cableColorName?: string;
	cableColor?: string;
	cableLengthM?: number;
}

export interface GraphNodeElement {
	data: GraphNodeData;
}

export interface GraphEdgeElement {
	data: GraphEdgeData;
}

export interface GraphTransformResult {
	nodes: GraphNodeElement[];
	edges: GraphEdgeElement[];
	warnings: string[];
	machineVmIndex: Record<
		string,
		{
			vmNodeIds: string[];
			hostingEdgeIds: string[];
			vmCount: number;
		}
	>;
}
