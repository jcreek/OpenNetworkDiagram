interface Hardware {
	cpu: string;
	ram: string;
	networkPorts: number;
	networkPortSpeedGbps?: number;
	gpu?: string;
}

interface VM {
	name: string;
	role: string;
	ipAddress: string;
}

interface Software {
	vms: VM[];
}

interface Machine {
	machineName: string;
	ipAddress: string;
	role: string;
	operatingSystem: string;
	software: Software;
	hardware: Hardware;
}

interface NetworkDevice {
	name: string;
	ipAddress: string;
	type: string;
	notes?: string;
}

export interface NetworkData {
	machines: Machine[];
	devices: NetworkDevice[];
}
