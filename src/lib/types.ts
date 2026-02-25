export interface ConnectedPortRef {
	device: string;
	port: string;
}

export interface Port {
	portName: string;
	speedGbps?: number; // default to 1 if not provided
	connectedTo?: ConnectedPortRef;
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
	software: Software;
	hardware: Hardware;
	ports?: Port[];
}

export interface NetworkDevice {
	name: string;
	ipAddress: string;
	type: string;
	iconKey?: string;
	notes?: string;
	ports?: Port[];
}

export interface NetworkData {
	machines: Machine[];
	devices: NetworkDevice[];
}
