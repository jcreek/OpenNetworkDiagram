<script lang="ts">
	import { onMount } from 'svelte';
	import type { NetworkData } from '../types';
	import cytoscape from 'cytoscape';
	import dagre from 'cytoscape-dagre';
	let cy: cytoscape.Core | undefined;
	cytoscape.use(dagre);

	const networkData: NetworkData = {
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
	onMount(() => {
		const container = document.getElementById('cy') as HTMLDivElement;
		if (!container) {
			console.error("Container element '#cy' not found in the DOM.");
			return;
		}
		renderDiagram(networkData, container);
	});
	function renderDiagram(data: NetworkData, container: HTMLDivElement) {
		if (cy) {
			cy.destroy();
		}
		const nodes: cytoscape.NodeDefinition[] = [];
		const edges: cytoscape.EdgeDefinition[] = [];
		data.machines.forEach((machine) => {
			nodes.push({
				data: { id: machine.machineName, label: machine.machineName },
				classes: 'machine-node',
				position: { x: 0, y: 0 } // Initial position
			});
			machine.software.vms.forEach((vm) => {
				nodes.push({
					data: { id: vm.name, label: vm.name, parent: machine.machineName },
					classes: 'vm-node'
				});
			});
		});
		const elementsArray = [...nodes, ...edges];
		cy = cytoscape({
			container: container,
			elements: elementsArray,
			style: [
				{
					selector: 'node',
					style: {
						'background-color': '#3e4451',
						'border-color': '#555555',
						'border-width': 2,
						color: '#ffffff',
						'font-size': '14px',
						'text-halign': 'center',
						'text-valign': 'top',
						'text-margin-y': 20,
						padding: '20px'
					}
				},
				{
					selector: '.machine-node',
					style: {
						label: 'data(label)',
						'background-color': '#61afef',
						color: '#282c34',
						height: 150, // Set height and width for the parent node
						width: 200,
						shape: 'roundrectangle'
					}
				},
				{
					selector: '.vm-node',
					style: {
						label: 'data(label)',
						'background-color': '#c6c6c6',
						color: '#282c34',
						height: 50, // Set height and width for the child nodes
						width: 150,
						shape: 'roundrectangle'
					}
				},
				{
					selector: 'edge',
					style: {
						width: 3,
						'line-color': '#9dbaea',
						'target-arrow-color': '#9dbaea',
						'target-arrow-shape': 'triangle',
						'curve-style': 'bezier'
					}
				},
				{
					selector: ':parent',
					style: {
						'border-width': 3,
						'border-color': '#555555'
					}
				}
			],
			layout: {
				name: 'dagre',
				rankDir: 'TB', // Top-to-Bottom direction
				nodeSep: 50, // Pixel value between each node on the same level
				edgeSep: 30, // Minimum vertical separation that’s enforced between edges
				rankSep: 80 // Vertical separation that's used between ranks (levels of nodes)
			},
			minZoom: 1, // Set min and max zoom levels if needed
			maxZoom: 3
		});
	}
</script>

<main>
	<div id="cy" style="width: 100%; height: 1000px; background-color: #282c34;"></div>
</main>
