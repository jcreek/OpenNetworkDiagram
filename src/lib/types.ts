export interface ConnectedPortRef {
	device: string;
	port: string;
}

export interface Port {
	portName: string;
	speedGbps?: number; // default to 1 if not provided
	macAddress?: string;
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
