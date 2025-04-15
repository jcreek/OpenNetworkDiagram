<script lang="ts">
	import { onMount } from 'svelte';
	import { networkStore, loadNetworkData } from '../../stores/networkStore';
	import { get } from 'svelte/store';
	import MachineCard from './MachineCard.svelte';
	import DeviceCard from './DeviceCard.svelte';

	import type { NetworkData, Port } from '../../lib/types';

	export let jsonPath: string = '/data/network.json';

	let data: NetworkData;

	// We'll store all port references in one big map for easy access
	let lines: any[] = [];

	onMount(async () => {
		await loadNetworkData(jsonPath);
		data = get(networkStore);

		// Wait for DOM to render fully
		setTimeout(() => {
			createLines();
		}, 0);
	});

	/**
	 * Called after child components have rendered.
	 * We gather all port references and draw lines using global LeaderLine
	 */
	async function createLines() {
		// Use global UMD version from window
		const LeaderLine = (window as any).LeaderLine;
		if (!LeaderLine) {
			console.error('LeaderLine is not loaded.');
			return;
		}

		// Clear any previous lines
		for (const ln of lines) {
			ln.remove();
		}
		lines = [];

		type PortInfo = {
			parentName: string;
			port: Port;
			element: HTMLDivElement;
		};

		const portDataMap: Map<string, PortInfo> = new Map();

		// GATHER MACHINE PORTS
		for (const machine of data.machines) {
			if (machine.ports) {
				for (const p of machine.ports) {
					const key = `${machine.machineName}-${p.portName}`;
					const elem = document.querySelector(`[data-port-key="${key}"]`) as HTMLDivElement;
					if (elem) {
						portDataMap.set(key, {
							parentName: machine.machineName,
							port: p,
							element: elem
						});
					}
				}
			}
		}

		// GATHER DEVICE PORTS
		for (const dev of data.devices) {
			if (dev.ports) {
				for (const p of dev.ports) {
					const key = `${dev.name}-${p.portName}`;
					const elem = document.querySelector(`[data-port-key="${key}"]`) as HTMLDivElement;
					if (elem) {
						portDataMap.set(key, {
							parentName: dev.name,
							port: p,
							element: elem
						});
					}
				}
			}
		}

		// DRAW CONNECTIONS
		for (const [key, info] of portDataMap.entries()) {
			const localPort = info.port;
			if (!localPort.connectedTo) continue;

			const remoteKey = localPort.connectedTo;
			const remoteInfo = portDataMap.get(remoteKey);
			if (!remoteInfo) continue;

			if (key > remoteKey) continue; // Avoid duplicates

			const localSpeed = localPort.speedGbps ?? 1;
			const remoteSpeed = remoteInfo.port.speedGbps ?? 1;
			const cableSpeed = Math.min(localSpeed, remoteSpeed);
			const color = getLineColor(cableSpeed);

			// Calculate the best sockets for the line to exit/enter
			const localRect = info.element.getBoundingClientRect();
			const remoteRect = remoteInfo.element.getBoundingClientRect();
			const dx = remoteRect.left - localRect.left;
			const dy = remoteRect.top - localRect.top;

			let startSocket = 'right';
			let endSocket = 'left';
			if (Math.abs(dx) > Math.abs(dy)) {
				// More horizontal distance
				startSocket = dx > 0 ? 'right' : 'left';
				endSocket = dx > 0 ? 'left' : 'right';
			} else {
				// More vertical distance
				startSocket = dy > 0 ? 'bottom' : 'top';
				endSocket = dy > 0 ? 'top' : 'bottom';
			}

			const line = new LeaderLine(info.element, remoteInfo.element, {
				path: 'grid',
				startPlug: 'behind',
				endPlug: 'behind',
				startSocket,
				endSocket,
				color,
				size: 4,
				middleLabel: LeaderLine.captionLabel({
					text: `${cableSpeed}GbE`,
					fontSize: 12,
					color: 'white',
					outlineColor: 'black',
					outlineSize: 2
				})
			});

			lines.push(line);
		}
	}

	function getLineColor(speed: number): string {
		if (speed >= 10) return 'orange';
		if (speed >= 2.5) return 'green';
		if (speed >= 1) return 'blue';
		return 'gray';
	}
</script>

<main>
	{#if data}
		<div class="diagram-container">
			{#each data.machines as machine}
				<MachineCard {machine} />
			{/each}
			{#each data.devices as device}
				<DeviceCard {device} />
			{/each}
		</div>
	{/if}
</main>

<style>
	.diagram-container {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		padding: 1rem;
		position: relative; /* required for leader-line positioning */
	}
</style>
