import { writable } from 'svelte/store';
import type { NetworkData } from '../lib/types';

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

	// For now, set a static example with 'ports' and sample connections:
	const exampleData: NetworkData = {
		machines: [
			{
				machineName: 'ProxRouter',
				ipAddress: '10.0.0.3',
				role: 'Hypervisor',
				operatingSystem: 'Proxmox',
				ports: [
					{
						portName: 'eth0',
						speedGbps: 10,
						// Connect to the router's LAN2
						connectedTo: 'Router-LAN2'
					},
					{
						portName: 'eth1',
						speedGbps: 1
						// Not connected
					}
				],
				software: {
					vms: [
						{ name: 'OpnSense', role: 'Router', ipAddress: '10.0.0.4' },
						{ name: 'PiVPN', role: 'VPN Server', ipAddress: '10.0.0.5' },
						{ name: 'PiHole', role: 'DNS Ad-blocker', ipAddress: '10.0.0.6' },
						{ name: 'Dashy', role: 'Dashboard', ipAddress: '10.0.0.12' },
						{ name: 'DockerHost', role: 'Docker/Reverse Proxy', ipAddress: '10.0.0.23' }
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
				ports: [
					{
						portName: 'eth0',
						speedGbps: 1
						// No connection
					}
				],
				software: { vms: [] },
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
				ports: [
					{
						portName: 'eth0',
						speedGbps: 1
						// Not connected
					}
				],
				software: { vms: [] },
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
				ports: [
					{
						portName: 'eth0',
						speedGbps: 1
						// Not connected
					}
				],
				software: { vms: [] },
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
				ports: [
					{
						portName: 'eth0',
						speedGbps: 1
						// Not connected
					}
				],
				software: { vms: [] },
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
				ports: [
					{
						portName: 'eth0',
						speedGbps: 1
						// Not connected
					}
				],
				software: {
					vms: [
						{ name: 'Win11-Backblaze', role: 'Backblaze Backup', ipAddress: '10.0.0.24' },
						{ name: 'UbuntuDockerHost', role: 'Docker Host', ipAddress: '10.0.0.14' },
						{ name: 'MakeMKV', role: 'Blu-ray Ripper', ipAddress: '10.0.0.14' },
						{ name: 'Handbrake', role: 'Video Transcoder', ipAddress: '10.0.0.15' },
						{ name: 'NextCloud', role: 'Cloud Storage', ipAddress: 'TBD' }
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
				ports: [
					{
						portName: 'eth0',
						speedGbps: 10
						// Not connected
					}
				],
				software: {
					vms: [
						{ name: 'Ollama', role: 'LLM Inference', ipAddress: '10.0.0.21' },
						{ name: 'Bot Training', role: 'AI Training', ipAddress: '10.0.0.22' }
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
				notes: 'Main internet-facing router',
				ports: [
					{
						portName: 'LAN1',
						speedGbps: 1,
						// Connect to Omada Controller
						connectedTo: 'Omada Controller-eth0'
					},
					{
						portName: 'LAN2',
						speedGbps: 10,
						// Connected to ProxRouter
						connectedTo: 'ProxRouter-eth0'
					},
					{
						portName: 'LAN3',
						speedGbps: 1,
						// Connect to HDHomeRun
						connectedTo: 'HDHomeRun-eth0'
					}
				]
			},
			{
				name: 'HDHomeRun',
				ipAddress: '10.0.0.2',
				type: 'TV Tuner',
				ports: [
					{
						portName: 'eth0',
						speedGbps: 1,
						connectedTo: 'Router-LAN3'
					}
				]
			},
			{
				name: 'Omada Controller',
				ipAddress: '10.0.0.4',
				type: 'Network Controller',
				notes: 'Access via port 8043',
				ports: [
					{
						portName: 'eth0',
						speedGbps: 1,
						connectedTo: 'Router-LAN1'
					}
				]
			},
			{
				name: '3DS',
				ipAddress: '10.0.0.17',
				type: 'Handheld Console'
				// No ports => Wi-Fi only
			},
			{
				name: '2DS',
				ipAddress: '10.0.0.18',
				type: 'Handheld Console'
				// No ports => Wi-Fi only
			},
			{
				name: 'Nintendo Switch',
				ipAddress: '10.0.0.19',
				type: 'Gaming Console',
				notes: 'IP to be confirmed'
				// No ports => Wi-Fi only
			}
		]
	};

	networkStore.set(exampleData);
}
