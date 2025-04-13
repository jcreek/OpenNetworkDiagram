import { writable } from 'svelte/store';

export interface VMInfo {
	name: string;
	role: string;
	ipAddress: string;
}

export interface Software {
	vms: VMInfo[];
}

export interface Hardware {
	cpu: string;
	ram: string;
	networkPorts: number;
	networkPortSpeedGbps?: number;
	gpu?: string | null;
}

export interface Machine {
	machineName: string;
	ipAddress: string;
	role: string;
	operatingSystem: string;
	software: Software;
	hardware: Hardware;
}

export interface Device {
	name: string;
	ipAddress: string;
	type: string;
	notes?: string;
}

export interface NetworkData {
	machines: Machine[];
	devices: Device[];
}

// Create a writable store for the data
export const networkStore = writable<NetworkData>({
	machines: [],
	devices: []
});

// A function to load JSON from an API or local file if needed
export async function loadNetworkData(jsonPath: string) {
	// For a real app, fetch the file or do an import:
	// const response = await fetch(jsonPath);
	// const data = await response.json();
	// networkStore.set(data);

	// For now, set a static example:
	const exampleData: NetworkData = {
		machines: [
			{
				machineName: 'ProxRouter',
				ipAddress: '10.0.0.3',
				role: 'Hypervisor',
				operatingSystem: 'Proxmox',
				software: {
					vms: [
						{
							name: 'OpnSense',
							role: 'Router',
							ipAddress: '10.0.0.4'
						},
						{
							name: 'PiVPN',
							role: 'VPN Server',
							ipAddress: '10.0.0.5'
						},
						{
							name: 'PiHole',
							role: 'DNS Ad-blocker',
							ipAddress: '10.0.0.6'
						},
						{
							name: 'Dashy',
							role: 'Dashboard',
							ipAddress: '10.0.0.12'
						},
						{
							name: 'DockerHost',
							role: 'Docker/Reverse Proxy',
							ipAddress: '10.0.0.23'
						}
					]
				},
				hardware: {
					cpu: 'Intel N100',
					ram: '8GB',
					networkPorts: 4,
					networkPortSpeedGbps: 1,
					gpu: null
				}
			},
			{
				machineName: 'Asustor NAS',
				ipAddress: '10.0.0.9',
				role: 'NAS',
				operatingSystem: 'Asustor ADM',
				software: {
					vms: []
				},
				hardware: {
					cpu: 'Realtek RTD1296 Quad Core 1.4GHz',
					ram: '2GB',
					networkPorts: 1,
					networkPortSpeedGbps: 1,
					gpu: null
				}
			},
			{
				machineName: 'Home Assistant Green',
				ipAddress: '10.0.0.13',
				role: 'Smart Home Controller',
				operatingSystem: 'Home Assistant OS',
				software: {
					vms: []
				},
				hardware: {
					cpu: 'Home Assistant Custom SoC',
					ram: 'Unknown',
					networkPorts: 1,
					networkPortSpeedGbps: 1,
					gpu: null
				}
			},
			{
				machineName: 'Plex Server',
				ipAddress: '10.0.0.11',
				role: 'Media Server',
				operatingSystem: 'Ubuntu Server',
				software: {
					vms: []
				},
				hardware: {
					cpu: 'Intel N100',
					ram: 'Unknown',
					networkPorts: 1,
					networkPortSpeedGbps: 1,
					gpu: null
				}
			},
			{
				machineName: 'Win11 N100',
				ipAddress: '10.0.0.8',
				role: 'Media Downloader',
				operatingSystem: 'Windows 11',
				software: {
					vms: []
				},
				hardware: {
					cpu: 'Intel N100',
					ram: 'Unknown',
					networkPorts: 1,
					networkPortSpeedGbps: 1,
					gpu: null
				}
			},
			{
				machineName: 'Win11 Backblaze NAS',
				ipAddress: '10.0.0.7',
				role: 'Backup NAS + Hypervisor',
				operatingSystem: 'TrueNAS Scale',
				software: {
					vms: [
						{
							name: 'Win11-Backblaze',
							role: 'Backblaze Backup',
							ipAddress: '10.0.0.24'
						},
						{
							name: 'UbuntuDockerHost',
							role: 'Docker Host',
							ipAddress: '10.0.0.14'
						},
						{
							name: 'MakeMKV',
							role: 'Blu-ray Ripper',
							ipAddress: '10.0.0.14'
						},
						{
							name: 'Handbrake',
							role: 'Video Transcoder',
							ipAddress: '10.0.0.15'
						},
						{
							name: 'NextCloud',
							role: 'Cloud Storage',
							ipAddress: 'TBD'
						}
					]
				},
				hardware: {
					cpu: 'AMD Ryzen 5 4600G',
					ram: '16GB',
					networkPorts: 1,
					networkPortSpeedGbps: 1,
					gpu: 'EVGA GeForce GTX 1050 Ti'
				}
			},
			{
				machineName: 'AI Server',
				ipAddress: '10.0.0.20',
				role: 'AI Dev/Inference',
				operatingSystem: 'Pop!_OS',
				software: {
					vms: [
						{
							name: 'Ollama',
							role: 'LLM Inference',
							ipAddress: '10.0.0.21'
						},
						{
							name: 'Bot Training',
							role: 'AI Training',
							ipAddress: '10.0.0.22'
						}
					]
				},
				hardware: {
					cpu: 'AMD Ryzen 5 3600',
					ram: '32GB',
					networkPorts: 1,
					networkPortSpeedGbps: 1,
					gpu: 'Gigabyte GeForce GTX 1080'
				}
			}
		],
		devices: [
			{
				name: 'Router',
				ipAddress: '10.0.0.1',
				type: 'Gateway',
				notes: 'Main internet-facing router'
			},
			{
				name: 'HDHomeRun',
				ipAddress: '10.0.0.2',
				type: 'TV Tuner'
			},
			{
				name: 'Omada Controller',
				ipAddress: '10.0.0.4',
				type: 'Network Controller',
				notes: 'Access via port 8043'
			},
			{
				name: '3DS',
				ipAddress: '10.0.0.17',
				type: 'Handheld Console'
			},
			{
				name: '2DS',
				ipAddress: '10.0.0.18',
				type: 'Handheld Console'
			},
			{
				name: 'Nintendo Switch',
				ipAddress: '10.0.0.19',
				type: 'Gaming Console',
				notes: 'IP to be confirmed'
			}
		]
	};

	networkStore.set(exampleData);
}
