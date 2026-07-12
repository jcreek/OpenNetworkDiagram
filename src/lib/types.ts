export interface CableInfo {
	type?: string;
	color?: string;
	lengthM?: number;
}

export interface ConnectedPortRef {
	device: string;
	port: string;
	cable?: CableInfo;
}

export interface Port {
	portName: string;
	speedGbps?: number; // default to 1 if not provided
	macAddress?: string;
	connectedTo?: ConnectedPortRef;
}

export interface RackPlacement {
	name: string;
	unit: number; // bottom U position, 1-based
	heightU?: number; // defaults to 1
}

export interface Hardware {
	cpu: string;
	ram: string;
	networkPorts: number;
	networkPortSpeedGbps?: number;
	gpu?: string;
}

export interface VM {
	name: string;
	role: string;
	ipAddress: string;
	iconKey?: string;
	macAddress?: string;
}

export interface Software {
	vms: VM[];
}

export interface Machine {
	machineName: string;
	ipAddress: string;
	role: string;
	operatingSystem: string;
	iconKey?: string;
	notes?: string;
	software: Software;
	hardware: Hardware;
	ports?: Port[];
	rack?: RackPlacement;
}

export interface NetworkDevice {
	name: string;
	ipAddress: string;
	type: string;
	iconKey?: string;
	notes?: string;
	ports?: Port[];
	rack?: RackPlacement;
}

export interface Subnet {
	cidr: string;
	name?: string;
	vlanId?: number;
}

export interface RackDefinition {
	name: string;
	heightU?: number;
}

export interface NetworkData {
	machines: Machine[];
	devices: NetworkDevice[];
	subnets?: Subnet[];
	racks?: RackDefinition[];
}
