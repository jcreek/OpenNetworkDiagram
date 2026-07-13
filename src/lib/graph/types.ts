export type GraphNodeKind = 'machine' | 'device' | 'vm';
export type GraphEdgeKind = 'physical' | 'hosting';
export type DeviceClass = 'infrastructure' | 'dumb';

// Hit-target dimensions for the invisible Cytoscape nodes. The HTML card
// layer sizes its cards from the same constants so edges anchor exactly at
// card borders.
export const NODE_DIMENSIONS = {
	machine: { width: 218, height: 56 },
	infrastructure: { width: 218, height: 56 },
	vm: { width: 170, height: 44 },
	dumbHeight: 36
} as const;

// Content-hugging pills need a width so edges anchor at the card border:
// 24px icon tile + gaps/padding ≈ 54px, plus the rendered text width.
// Text is measured with a canvas context (matching the pill's 12.5px type);
// the char-count estimate is only an SSR/test fallback.
let pillMeasureContext: CanvasRenderingContext2D | null = null;

export function estimatePillWidth(name: string): number {
	let textWidth = name.length * 7.6;
	if (typeof document !== 'undefined') {
		pillMeasureContext ??= document.createElement('canvas').getContext('2d');
		if (pillMeasureContext) {
			pillMeasureContext.font =
				'600 12.5px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
			textWidth = pillMeasureContext.measureText(name).width;
		}
	}
	return Math.round(Math.min(300, Math.max(110, textWidth + 60)));
}

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
	deviceClass?: DeviceClass;
	rawName?: string;
	hostMachineId?: string;
	nodeWidth?: number;
	nodeHeight?: number;
	iconUrl?: string;
	iconKey?: string;
	vlanId?: number;
	vlanIndex?: number;
	meta?: string;
	vmCount?: number;
	details?: GraphNodeDetails;
}

export interface GraphEdgeData {
	id: string;
	source: string;
	target: string;
	kind: GraphEdgeKind;
	label?: string;
	chipLabel?: string;
	chipLabelNoSpeed?: string;
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
