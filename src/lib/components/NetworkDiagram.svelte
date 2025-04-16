<script lang="ts">
	import { onMount, afterUpdate, tick } from 'svelte';
	import { networkStore, loadNetworkData } from '../../stores/networkStore';
	import { get } from 'svelte/store';
	import MachineCard from './MachineCard.svelte';
	import DeviceCard from './DeviceCard.svelte';

	import type { NetworkData, Port } from '../../lib/types';
	import { astar } from '../utils/pathfinding';
	import type { Point } from '../utils/pathfinding';

	export let jsonPath: string = '/data/network.json';

	let data: NetworkData | undefined = undefined;

	// DEBUG: Log when component mounts
	onMount(() => {
		// Async block for data loading and initial connection
		(async () => {
			console.log('NetworkDiagram mounted');
			await loadNetworkData(jsonPath);
			data = get(networkStore);
			console.log('Loaded network data:', data);
			await tick(); // Wait for DOM update
			const container = document.querySelector('.diagram-container');
			if (container) {
				updateSVGConnections();
			} else {
				console.warn('Container not found, skipping updateSVGConnections');
			}
		})();

		// Optionally, update connections on window resize
		const handleResize = () => {
			const container = document.querySelector('.diagram-container');
			if (container) updateSVGConnections();
		};
		window.addEventListener('resize', handleResize);

		return () => {
			window.removeEventListener('resize', handleResize);
		};
	});

	// SVG-based connection rendering
	let svgWidth = 0;
	let svgHeight = 0;
	let svgOffsetX = 0;
	let svgOffsetY = 0;
	let svgConnections: { points: [number, number][]; color: string; label: string }[] = [];

	const GRID_SIZE = 40; // px per grid cell

	function updateSVGConnections() {
		const container = document.querySelector('.diagram-container') as HTMLElement;
		if (!container) {
			console.warn('No container element found in updateSVGConnections');
			return;
		}
		const rect = container.getBoundingClientRect();
		svgWidth = rect.width;
		svgHeight = rect.height;
		svgOffsetX = rect.left;
		svgOffsetY = rect.top;

		console.log('updateSVGConnections called');

		const portDataMap: Map<string, { element: HTMLDivElement; port: Port }> = new Map();
		// Gather all port elements
		if (!data) {
			console.warn('No data loaded in updateSVGConnections');
			return;
		}

		for (const machine of data.machines) {
			if (machine.ports) {
				for (const p of machine.ports) {
					const key = `${machine.machineName}-${p.portName}`;
					const elem = document.querySelector(`[data-port-key="${key}"]`) as HTMLDivElement;
					if (elem) portDataMap.set(key, { element: elem, port: p });
				}
			}

			for (const dev of data.devices) {
				if (dev.ports) {
					for (const p of dev.ports) {
						const key = `${dev.name}-${p.portName}`;
						const elem = document.querySelector(`[data-port-key="${key}"]`) as HTMLDivElement;
						if (elem) portDataMap.set(key, { element: elem, port: p });
					}
				}
			}
		}

		// DRAW CONNECTIONS
		svgConnections = [];
		// Pathfinding: mark all cards as obstacles
		const cols = Math.ceil(svgWidth / GRID_SIZE);
		const rows = Math.ceil(svgHeight / GRID_SIZE);
		const cardElements = document.querySelectorAll('.device-card, .machine-card');
		const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
		for (const el of cardElements) {
			const r = el.getBoundingClientRect();
			const left = Math.floor((r.left - svgOffsetX) / GRID_SIZE);
			const top = Math.floor((r.top - svgOffsetY) / GRID_SIZE);
			const right = Math.ceil((r.right - svgOffsetX) / GRID_SIZE);
			const bottom = Math.ceil((r.bottom - svgOffsetY) / GRID_SIZE);
			for (let y = top; y < bottom; y++) {
				for (let x = left; x < right; x++) {
					if (x >= 0 && y >= 0 && x < cols && y < rows) grid[y][x] = 1;
				}
			}
		}

		svgConnections = [];
		for (const [key, info] of portDataMap.entries()) {
			const localPort = info.port;
			if (!localPort.connectedTo) continue;
			const remoteInfo = portDataMap.get(localPort.connectedTo);
			if (!remoteInfo) continue;
			if (key > localPort.connectedTo) continue; // Avoid duplicates

			const a = info.element.getBoundingClientRect();
			const b = remoteInfo.element.getBoundingClientRect();
			const PADDING = 8;
			const isRightward = (b.left + b.width / 2) > (a.left + a.width / 2);
			const startX = isRightward ? a.right - svgOffsetX + PADDING : a.left - svgOffsetX - PADDING;
			const endX = isRightward ? b.left - svgOffsetX - PADDING : b.right - svgOffsetX + PADDING;
			const startY = a.top + a.height / 2 - svgOffsetY;
			const endY = b.top + b.height / 2 - svgOffsetY;

			// Source/target grid points
			const start: Point = [Math.floor(startX / GRID_SIZE), Math.floor(startY / GRID_SIZE)];
			const end: Point = [Math.floor(endX / GRID_SIZE), Math.floor(endY / GRID_SIZE)];
			// Temporarily clear source/target cells
			grid[start[1]][start[0]] = 0;
			grid[end[1]][end[0]] = 0;

			let path = astar(grid, start, end);
			let points: [number, number][] = [];
			if (path.length > 0) {
				points = path.map(([gx, gy]) => [
					gx * GRID_SIZE + GRID_SIZE / 2,
					gy * GRID_SIZE + GRID_SIZE / 2
				]);
				// Ensure start and end points are exactly at the card edges
				points[0] = [startX, startY];
				points[points.length - 1] = [endX, endY];
			} else {
				// fallback: simple L-bend
				points = [
					[startX, startY],
					[endX, startY],
					[endX, endY]
				];
			}
			const speed = Math.min(localPort.speedGbps ?? 1, remoteInfo.port.speedGbps ?? 1);
			const color = getLineColor(speed);
			const label = `${speed}GbE`;
			svgConnections.push({ points, color, label });
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
		<div class="diagram-container" style="position:relative;">
			<svg
				class="diagram-svg"
				width={svgWidth}
				height={svgHeight}
				style="position:absolute;top:0;left:0;z-index:0;pointer-events:none;"
			>
				{#each svgConnections as conn}
					<polyline
						points={conn.points.map(([x, y]) => `${x},${y}`).join(' ')}
						stroke={conn.color}
						stroke-width="4"
						fill="none"
					/>
					<!-- Optionally render a label at the midpoint -->
					<text
						x={(conn.points[1][0] + conn.points[2][0]) / 2}
						y={(conn.points[1][1] + conn.points[2][1]) / 2 - 6}
						font-size="12"
						fill="white"
						stroke="black"
						stroke-width="2"
						paint-order="stroke"
						text-anchor="middle">{conn.label}</text
					>
				{/each}
			</svg>
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
		position: relative;
	}
	.diagram-svg {
		pointer-events: none;
	}
</style>
