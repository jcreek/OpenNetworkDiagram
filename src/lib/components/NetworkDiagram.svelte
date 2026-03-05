<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import cytoscape from 'cytoscape';
	import dagre from 'cytoscape-dagre';

	import { listIconDefinitions, resolveIconPath } from '$lib/config/iconRegistry';
	import {
		cloneNetworkData,
		createEmptyDevice,
		createEmptyMachine,
		createEmptyPort,
		createEmptyVm,
		deleteOwner,
		deletePort,
		renameOwner,
		renamePort,
		setPortConnection,
		type OwnerKind,
		withReconciledConnections
	} from '$lib/data/networkEditor';
	import loadNetworkData from '$lib/data/loadNetworkData';
	import { validateNetworkData, type ValidationIssue } from '$lib/data/networkSchema';
	import transformNetworkDataToGraph from '$lib/graph/transformNetworkData';
	import type { GraphNodeData, GraphTransformResult } from '$lib/graph/types';
	import { themeMode, type ThemeMode } from '$lib/stores/theme';
	import type { NetworkData, Port } from '$lib/types';
	import Modal from './Modal.svelte';

	export let jsonPath = '/data/network.json';

	type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';
	type DiagramViewMode = 'network' | 'device';
	type Position = { x: number; y: number };
	type AddModalKind = 'machine' | 'device' | null;
	type DeleteTarget =
		| { type: 'machine'; index: number }
		| { type: 'device'; index: number }
		| { type: 'vm'; machineIndex: number; vmIndex: number }
		| null;
	type SelectedTarget =
		| { type: 'machine'; index: number }
		| { type: 'device'; index: number }
		| { type: 'vm'; machineIndex: number; vmIndex: number }
		| null;

	const autosaveDelayMs = 800;

	let container: HTMLDivElement;
	let diagramStage: HTMLDivElement;
	let tooltipElement: HTMLDivElement | null = null;
	let cy: cytoscape.Core | null = null;

	let networkData: NetworkData = {
		machines: [],
		devices: []
	};
	let warnings: string[] = [];
	let validationIssues: ValidationIssue[] = [];

	let selectedTarget: SelectedTarget = null;
	let addModalKind: AddModalKind = null;
	let deleteTarget: DeleteTarget = null;
	let showExportModal = false;

	let newMachineDraft = createEmptyMachine();
	let newDeviceDraft = createEmptyDevice();
	let iconSearch = '';

	let isLoadingData = false;
	let loadError: string | null = null;
	let saveError: string | null = null;
	let saveState: SaveState = 'saved';
	let dataSourceLabel = jsonPath;
	let writable = false;
	const defaultReadOnlyNotice = 'Read-only deployment; changes are not persisted.';
	let readOnlyNotice = defaultReadOnlyNotice;

	let showEthernetLabels = false;
	let diagramViewMode: DiagramViewMode = 'network';
	let machineVmIndex: GraphTransformResult['machineVmIndex'] = {};
	let collapsedHosts: Record<string, boolean> = {};
	let exportFileName = 'network-diagram';
	let exportScale = 2;
	let exportBackground: 'theme' | 'transparent' = 'theme';

	let currentTheme: ThemeMode = 'light';
	let unsubscribeTheme: (() => void) | null = null;

	let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
	let saveInFlight = false;
	let trailingSaveRequested = false;
	let lastSavedSnapshot = '';
	let hasLoadedInitialData = false;
	let connectionDraftByKey: Record<string, { device: string; port: string }> = {};
	let mapControlsCollapsed = false;

	const iconDefinitions = listIconDefinitions();
	const iconResultLimit = 100;
	let tooltip = {
		visible: false,
		text: '',
		x: 0,
		y: 0
	};

	const tooltipOffset = {
		x: 44,
		y: -8
	};
	const fallbackTooltipSize = {
		width: 260,
		height: 32
	};
	const tooltipViewportPadding = 8;

	function normalizeIconSearchValue(value: string): string {
		return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
	}

	$: normalizedIconSearch = normalizeIconSearchValue(iconSearch);
	$: iconSearchTokens = normalizedIconSearch.split(' ').filter(Boolean);
	$: filteredIconDefinitions = iconDefinitions.filter((icon) => {
		if (iconSearchTokens.length === 0) {
			return true;
		}
		const searchable = normalizeIconSearchValue(`${icon.label} ${icon.key}`);
		return (
			iconSearchTokens.every((token) => searchable.includes(token))
		);
	});
	$: visibleIconDefinitions = filteredIconDefinitions.slice(0, iconResultLimit);

	$: selectedMachine =
		selectedTarget?.type === 'machine' ? networkData.machines[selectedTarget.index] : null;
	$: selectedDevice =
		selectedTarget?.type === 'device' ? networkData.devices[selectedTarget.index] : null;
	$: selectedVm =
		selectedTarget?.type === 'vm'
			? networkData.machines[selectedTarget.machineIndex]?.software.vms[selectedTarget.vmIndex]
			: null;
	$: selectedMachineHostId = selectedMachine ? toMachineNodeId(selectedMachine.machineName) : null;
	$: selectedMachineVmCount =
		selectedMachineHostId && machineVmIndex[selectedMachineHostId]
			? machineVmIndex[selectedMachineHostId].vmCount
			: 0;
	$: machineConnectableOwnerNames = selectedMachine
		? listConnectableOwnerNames('machine', selectedMachine.machineName)
		: [];
	$: deviceConnectableOwnerNames = selectedDevice
		? listConnectableOwnerNames('device', selectedDevice.name)
		: [];
	$: hasAnyVmHosts = Object.values(machineVmIndex).some((entry) => (entry?.vmCount ?? 0) > 0);
	$: areAllVmHostsCollapsed =
		hasAnyVmHosts &&
		Object.keys(machineVmIndex)
			.filter((hostId) => (machineVmIndex[hostId]?.vmCount ?? 0) > 0)
			.every((hostId) => isHostCollapsed(hostId));
	$: selectedTargetIconKey =
		selectedTarget?.type === 'machine'
			? selectedMachine?.iconKey ?? ''
			: selectedTarget?.type === 'device'
				? selectedDevice?.iconKey ?? ''
				: selectedTarget?.type === 'vm'
					? selectedVm?.iconKey ?? ''
					: '';
	$: selectedTargetIconPath = resolveIconPath(selectedTargetIconKey || undefined);
	$: addModalIconKey =
		addModalKind === 'machine'
			? newMachineDraft.iconKey ?? ''
			: addModalKind === 'device'
				? newDeviceDraft.iconKey ?? ''
				: '';
	$: addModalIconPath = resolveIconPath(addModalIconKey || undefined);

	function equalsIgnoreCase(a: string, b: string): boolean {
		return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
	}

	function findMachineIndexByName(name: string): number {
		return networkData.machines.findIndex((machine) => equalsIgnoreCase(machine.machineName, name));
	}

	function findDeviceIndexByName(name: string): number {
		return networkData.devices.findIndex((device) => equalsIgnoreCase(device.name, name));
	}

	function findVmIndexByName(machineIndex: number, vmName: string): number {
		return networkData.machines[machineIndex]?.software.vms.findIndex((vm) => equalsIgnoreCase(vm.name, vmName)) ?? -1;
	}

	function listConnectableOwnerNames(kind: OwnerKind, ownerName: string): string[] {
		const names: string[] = [];
		const seen = new Set<string>();

		const add = (candidateName: string, ports: Port[] | undefined) => {
			const trimmed = candidateName.trim();
			if (!trimmed) {
				return;
			}
			if (equalsIgnoreCase(trimmed, ownerName)) {
				return;
			}
			if (!ports || ports.length === 0) {
				return;
			}

			const normalized = trimmed.toLowerCase();
			if (seen.has(normalized)) {
				return;
			}
			seen.add(normalized);
			names.push(trimmed);
		};

		for (const machine of networkData.machines) {
			add(machine.machineName, machine.ports);
		}
		for (const device of networkData.devices) {
			add(device.name, device.ports);
		}

		return names.sort((a, b) => a.localeCompare(b));
	}

	function decodeNodeId(nodeId: string): SelectedTarget {
		if (nodeId.startsWith('machine:')) {
			const machineName = decodeURIComponent(nodeId.slice('machine:'.length));
			const index = findMachineIndexByName(machineName);
			if (index >= 0) {
				return { type: 'machine', index };
			}
		}

		if (nodeId.startsWith('device:')) {
			const deviceName = decodeURIComponent(nodeId.slice('device:'.length));
			const index = findDeviceIndexByName(deviceName);
			if (index >= 0) {
				return { type: 'device', index };
			}
		}

		if (nodeId.startsWith('vm:')) {
			const suffix = nodeId.slice('vm:'.length);
			const [encodedHost, ...vmParts] = suffix.split(':');
			const encodedVm = vmParts.join(':');
			if (encodedHost && encodedVm) {
				const hostName = decodeURIComponent(encodedHost);
				const vmName = decodeURIComponent(encodedVm);
				const machineIndex = findMachineIndexByName(hostName);
				if (machineIndex >= 0) {
					const vmIndex = findVmIndexByName(machineIndex, vmName);
					if (vmIndex >= 0) {
						return { type: 'vm', machineIndex, vmIndex };
					}
				}
			}
		}

		return null;
	}

	function toMachineNodeId(name: string): string {
		return `machine:${encodeURIComponent(name)}`;
	}

	function selectedMachineNodeId(): string | null {
		if (!selectedMachine) {
			return null;
		}
		return toMachineNodeId(selectedMachine.machineName);
	}

	function connectionDraftKey(kind: OwnerKind, ownerName: string, portName: string): string {
		return `${kind}:${ownerName}::${portName}`;
	}

	function resolveConnectionDraft(
		kind: OwnerKind,
		ownerName: string,
		port: Port
	): { device: string; port: string } {
		const key = connectionDraftKey(kind, ownerName, port.portName);
		const draft = connectionDraftByKey[key];
		if (draft) {
			return draft;
		}
		return {
			device: port.connectedTo?.device ?? '',
			port: port.connectedTo?.port ?? ''
		};
	}

	function setConnectionDraft(
		kind: OwnerKind,
		ownerName: string,
		portName: string,
		next: { device: string; port: string }
	) {
		const key = connectionDraftKey(kind, ownerName, portName);
		connectionDraftByKey = {
			...connectionDraftByKey,
			[key]: next
		};
	}

	function clearConnectionDraft(kind: OwnerKind, ownerName: string, portName: string) {
		const key = connectionDraftKey(kind, ownerName, portName);
		if (!(key in connectionDraftByKey)) {
			return;
		}
		const next = { ...connectionDraftByKey };
		delete next[key];
		connectionDraftByKey = next;
	}

	function normalizeConnectionTarget(
		target: Port['connectedTo']
	): { device: string; port: string } | undefined {
		const device = target?.device?.trim();
		const port = target?.port?.trim();
		if (!device || !port) {
			return undefined;
		}
		return { device, port };
	}

	function sameConnection(
		a: Port['connectedTo'] | undefined,
		b: Port['connectedTo'] | undefined
	): boolean {
		if (!a && !b) {
			return true;
		}
		if (!a || !b) {
			return false;
		}
		return a.device === b.device && a.port === b.port;
	}

	function getTooltipSize(): { width: number; height: number } {
		if (tooltipElement) {
			const rect = tooltipElement.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) {
				return { width: rect.width, height: rect.height };
			}
		}

		return fallbackTooltipSize;
	}

	function clampTooltipPosition(rawX: number, rawY: number): Position {
		const stageRect = diagramStage.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		const { width: tooltipWidth, height: tooltipHeight } = getTooltipSize();

		const rawViewportX = containerRect.left + rawX;
		const rawViewportY = containerRect.top + rawY;

		const minViewportX = stageRect.left + tooltipViewportPadding;
		const maxViewportX = stageRect.right - tooltipWidth - tooltipViewportPadding;
		const minViewportY = stageRect.top + tooltipViewportPadding;
		const maxViewportY = stageRect.bottom - tooltipHeight - tooltipViewportPadding;

		const clampedViewportX = Math.max(minViewportX, Math.min(rawViewportX, maxViewportX));
		const clampedViewportY = Math.max(minViewportY, Math.min(rawViewportY, maxViewportY));

		return {
			x: clampedViewportX - stageRect.left + diagramStage.scrollLeft,
			y: clampedViewportY - stageRect.top + diagramStage.scrollTop
		};
	}

	function ensureSelectedTargetValid() {
		if (!selectedTarget) {
			return;
		}

		if (selectedTarget.type === 'machine') {
			if (!networkData.machines[selectedTarget.index]) {
				closeSelectedTargetModal();
			}
			return;
		}

		if (selectedTarget.type === 'device') {
			if (!networkData.devices[selectedTarget.index]) {
				closeSelectedTargetModal();
			}
			return;
		}

		if (!networkData.machines[selectedTarget.machineIndex]?.software.vms[selectedTarget.vmIndex]) {
			closeSelectedTargetModal();
		}
	}

	function resolveErrorMessage(error: unknown): string {
		if (error instanceof Error && error.message) {
			return error.message;
		}
		return 'Unexpected error';
	}

	function resolveReadOnlyNotice(reason: string | null | undefined): string {
		if (!reason) {
			return defaultReadOnlyNotice;
		}
		return `Read-only: ${reason}`;
	}

	function createGraphStyles(theme: ThemeMode): cytoscape.Stylesheet[] {
		const nodeText = theme === 'dark' ? '#e2e8f0' : '#1e293b';
		const textOutline = theme === 'dark' ? '#0f172a' : '#f8fafc';
		const edgeColor = theme === 'dark' ? '#94a3b8' : '#475569';

		return [
			{
				selector: 'node',
				style: {
					label: 'data(label)',
					'font-size': 12,
					'font-weight': 600,
					'text-wrap': 'wrap',
					'text-max-width': '140px',
					'text-valign': 'center',
					'text-halign': 'center',
					color: nodeText,
					'text-outline-color': textOutline,
					'text-outline-width': 2,
					width: 'data(nodeWidth)',
					height: 'data(nodeHeight)',
					'border-width': 2,
					'border-color': '#64748b',
					'background-color': theme === 'dark' ? '#1e293b' : '#f1f5f9'
				}
			},
			{
				selector: 'node[kind = "machine"]',
				style: {
					shape: 'round-rectangle',
					'background-color': theme === 'dark' ? '#1d4ed8' : '#bfdbfe',
					'border-color': '#3b82f6'
				}
			},
			{
				selector: 'node[kind = "vm"]',
				style: {
					shape: 'ellipse',
					'background-color': theme === 'dark' ? '#14532d' : '#bbf7d0',
					'border-color': '#16a34a',
					'font-size': 10,
					'text-max-width': '120px'
				}
			},
			{
				selector: 'node[kind = "device"]',
				style: {
					shape: 'hexagon',
					'background-color': theme === 'dark' ? '#78350f' : '#fde68a',
					'border-color': '#d97706'
				}
			},
			{
				selector: 'node[iconUrl]',
				style: {
					'background-image': 'data(iconUrl)',
					'background-fit': 'contain',
					'background-clip': 'none',
					'background-width': 'auto',
					'background-height': 'auto',
					'background-position-y': '30%'
				}
			},
			{
				selector: 'edge',
				style: {
					width: 2,
					'curve-style': 'bezier',
					'line-color': edgeColor,
					'target-arrow-color': edgeColor,
					'target-arrow-shape': 'triangle',
					label: 'data(label)',
					'font-size': 9,
					'text-rotation': 'autorotate',
					color: nodeText,
					'text-outline-color': textOutline,
					'text-outline-width': 3
				}
			},
			{
				selector: 'edge[kind = "physical"]',
				style: {
					'target-arrow-shape': 'none',
					label: '',
					'source-label': '',
					'target-label': '',
					'source-text-offset': 28,
					'target-text-offset': 28,
					'source-text-margin-y': -9,
					'target-text-margin-y': 9,
					'text-background-color': theme === 'dark' ? '#0f172a' : '#f8fafc',
					'text-background-opacity': 1,
					'text-background-padding': '4px'
				}
			},
			{
				selector: 'edge[kind = "hosting"]',
				style: {
					'line-style': 'dashed',
					'line-dash-pattern': [7, 5],
					'line-color': theme === 'dark' ? '#64748b' : '#94a3b8',
					'target-arrow-color': theme === 'dark' ? '#64748b' : '#94a3b8',
					'font-size': 8,
					color: theme === 'dark' ? '#94a3b8' : '#64748b'
				}
			}
		];
	}

	function runDagreLayout(core: cytoscape.Core) {
		core
			.layout({
				name: 'dagre',
				rankDir: 'TB',
				ranker: 'network-simplex',
				nodeSep: 70,
				rankSep: 130,
				edgeSep: 35,
				fit: false,
				padding: 20,
				animate: false
			} as unknown as cytoscape.LayoutOptions)
			.run();
	}

	function resolveRankCollisions(core: cytoscape.Core) {
		const nodes = core.nodes().toArray();
		if (nodes.length === 0) {
			return;
		}

		const buckets: Record<string, cytoscape.NodeSingular[]> = {};
		const rankBand = 70;

		for (const node of nodes) {
			const bucketKey = String(Math.round(node.position().y / rankBand));
			const bucket = buckets[bucketKey] ?? [];
			bucket.push(node);
			buckets[bucketKey] = bucket;
		}

		const bucketKeys = Object.keys(buckets).sort((a, b) => Number(a) - Number(b));
		core.batch(() => {
			for (const bucketKey of bucketKeys) {
				const rankNodes = (buckets[bucketKey] ?? []).sort((a, b) => a.position().x - b.position().x);
				let prevRight: number | null = null;
				for (const node of rankNodes) {
					const pos = node.position();
					const halfWidth = node.outerWidth() / 2;
					let { x } = pos;
					if (prevRight !== null) {
						const minCenter = prevRight + halfWidth + 28;
						if (x < minCenter) {
							x = minCenter;
						}
					}
					node.position({ x, y: pos.y });
					prevRight = x + halfWidth;
				}
			}
		});
	}

	function capturePositions(core: cytoscape.Core): Record<string, Position> {
		const positions: Record<string, Position> = {};
		for (const node of core.nodes().toArray()) {
			const pos = node.position();
			positions[node.id()] = { x: pos.x, y: pos.y };
		}
		return positions;
	}

	function restorePositions(core: cytoscape.Core, positions: Record<string, Position>) {
		core.batch(() => {
			for (const nodeId of Object.keys(positions)) {
				const node = core.getElementById(nodeId);
				if (node.empty()) {
					continue;
				}
				const pos = positions[nodeId];
				node.position({ x: pos.x, y: pos.y });
			}
		});
	}

	function collectComponents(core: cytoscape.Core): cytoscape.NodeSingular[][] {
		const components: cytoscape.NodeSingular[][] = [];
		const visited: Record<string, boolean> = {};
		const all = core.nodes().toArray();

		for (const start of all) {
			const startId = start.id();
			if (visited[startId]) {
				continue;
			}

			const queue: cytoscape.NodeSingular[] = [start];
			visited[startId] = true;
			const component: cytoscape.NodeSingular[] = [];

			while (queue.length > 0) {
				const current = queue.shift();
				if (!current) {
					break;
				}
				component.push(current);

				const neighbors = current.neighborhood().nodes().toArray();
				for (const neighbor of neighbors) {
					const neighborId = neighbor.id();
					if (visited[neighborId]) {
						continue;
					}
					visited[neighborId] = true;
					queue.push(neighbor);
				}
			}

			components.push(component);
		}

		return components;
	}

	function componentBounds(nodes: cytoscape.NodeSingular[]) {
		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;

		for (const node of nodes) {
			const pos = node.position();
			const halfW = node.outerWidth() / 2;
			const halfH = node.outerHeight() / 2;
			minX = Math.min(minX, pos.x - halfW);
			maxX = Math.max(maxX, pos.x + halfW);
			minY = Math.min(minY, pos.y - halfH);
			maxY = Math.max(maxY, pos.y + halfH);
		}

		return {
			minX,
			maxX,
			minY,
			maxY,
			width: maxX - minX,
			height: maxY - minY
		};
	}

	function centerGraphHorizontally(core: cytoscape.Core) {
		const all = core.nodes().toArray();
		if (all.length === 0) {
			return;
		}

		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		for (const node of all) {
			const pos = node.position();
			const halfW = node.outerWidth() / 2;
			minX = Math.min(minX, pos.x - halfW);
			maxX = Math.max(maxX, pos.x + halfW);
		}

		const shiftX = -((minX + maxX) / 2);
		core.batch(() => {
			for (const node of all) {
				const pos = node.position();
				node.position({ x: pos.x + shiftX, y: pos.y });
			}
		});
	}

	function packConnectedComponents(core: cytoscape.Core, wrapWidth: number) {
		const components = collectComponents(core)
			.map((nodes) => ({ nodes, ...componentBounds(nodes) }))
			.sort((a, b) => {
				if (a.minY !== b.minY) {
					return a.minY - b.minY;
				}
				if (a.minX !== b.minX) {
					return a.minX - b.minX;
				}
				return a.nodes[0].id().localeCompare(b.nodes[0].id());
			});

		const gapX = 52;
		const gapY = 88;
		let cursorX = 0;
		let cursorY = 0;
		let rowHeight = 0;

		core.batch(() => {
			for (const component of components) {
				if (cursorX > 0 && cursorX + component.width > wrapWidth) {
					cursorX = 0;
					cursorY += rowHeight + gapY;
					rowHeight = 0;
				}

				const dx = cursorX - component.minX;
				const dy = cursorY - component.minY;
				for (const node of component.nodes) {
					const pos = node.position();
					node.position({ x: pos.x + dx, y: pos.y + dy });
				}

				cursorX += component.width + gapX;
				rowHeight = Math.max(rowHeight, component.height);
			}
		});

		centerGraphHorizontally(core);
	}

	function runAdaptiveLayout(core: cytoscape.Core) {
		runDagreLayout(core);
		resolveRankCollisions(core);
		const basePositions = capturePositions(core);

		const stageWidth = Math.max(container?.clientWidth ?? 1200, 420);
		const zoomFloor = 0.55;
		const maxAttempts = 7;
		let lastZoom = 0;
		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			const widthFactor = Math.max(0.35, 1.12 - attempt * 0.12);
			const wrapWidth = Math.max(stageWidth * widthFactor, 420);

			restorePositions(core, basePositions);
			packConnectedComponents(core, wrapWidth);
			core.fit(undefined, 24);

			lastZoom = core.zoom();
			if (lastZoom >= zoomFloor) {
				break;
			}
		}
	}

	function applyPhysicalEdgeDeconfliction(core: cytoscape.Core) {
		const physicalEdges = core.edges('[kind = "physical"]').toArray();
		const grouped = new Map<string, cytoscape.EdgeSingular[]>();

		for (const edge of physicalEdges) {
			const source = String(edge.data('source'));
			const target = String(edge.data('target'));
			const key = source < target ? `${source}|${target}` : `${target}|${source}`;
			const group = grouped.get(key) ?? [];
			group.push(edge);
			grouped.set(key, group);
		}

		core.batch(() => {
			for (const group of grouped.values()) {
				const count = group.length;
				for (let index = 0; index < group.length; index += 1) {
					const edge = group[index];
					const offsetIndex = index - (count - 1) / 2;
					const controlPointDistance = offsetIndex * 16;
					const sourceOffset = 30 + Math.abs(offsetIndex) * 4;
					const targetOffset = 30 + Math.abs(offsetIndex) * 4;

					edge.style('curve-style', count > 1 ? 'unbundled-bezier' : 'bezier');
					edge.style('control-point-distances', `${controlPointDistance}`);
					edge.style('control-point-weights', '0.5');
					edge.style('source-text-offset', sourceOffset);
					edge.style('target-text-offset', targetOffset);
					edge.style('text-margin-y', -14 + offsetIndex * 10);
				}
			}
		});
	}

	function applyEthernetLabelVisibility(visible: boolean) {
		if (!cy) {
			return;
		}
		const physicalEdges = cy.edges('[kind = "physical"]').toArray();
		cy.batch(() => {
			for (const edge of physicalEdges) {
				edge.style('label', visible ? String(edge.data('label') ?? '') : '');
				edge.style('source-label', visible ? String(edge.data('sourcePort') ?? '') : '');
				edge.style('target-label', visible ? String(edge.data('targetPort') ?? '') : '');
			}
		});
	}

	function onDiagramViewSelectChange(event: Event) {
		const nextValue = (event.currentTarget as HTMLSelectElement).value;
		diagramViewMode = nextValue === 'device' ? 'device' : 'network';
		refreshGraph();
	}

	function isHostCollapsed(hostId: string): boolean {
		return collapsedHosts[hostId] === true;
	}

	function syncCollapsedHosts(index: GraphTransformResult['machineVmIndex']) {
		const next: Record<string, boolean> = {};
		for (const hostId of Object.keys(index)) {
			if ((index[hostId]?.vmCount ?? 0) === 0) {
				continue;
			}
			next[hostId] = collapsedHosts[hostId] ?? true;
		}
		collapsedHosts = next;
	}

	function buildVisibleElements(transformed: GraphTransformResult) {
		const nodes = transformed.nodes
			.filter((node) => {
				if (node.data.kind !== 'vm') {
					return true;
				}
				const hostId = node.data.hostMachineId;
				if (!hostId) {
					return true;
				}
				return !isHostCollapsed(hostId);
			})
			.map((node) => {
				if (node.data.kind !== 'machine') {
					return node;
				}

				const hostId = node.data.id;
				const vmCount = machineVmIndex[hostId]?.vmCount ?? 0;
				const rawName = node.data.rawName ?? node.data.label;
				if (vmCount <= 0 || !isHostCollapsed(hostId)) {
					return {
						...node,
						data: {
							...node.data,
							label: rawName
						}
					};
				}

				const suffix = vmCount === 1 ? 'VM' : 'VMs';
				return {
					...node,
					data: {
						...node.data,
						label: `${rawName} (+ ${vmCount} ${suffix})`
					}
				};
			});

		const edges = transformed.edges.filter((edge) => {
			if (diagramViewMode === 'device' && edge.data.kind === 'physical') {
				return false;
			}
			if (edge.data.kind !== 'hosting') {
				return true;
			}
			return !isHostCollapsed(edge.data.source);
		});

		return { nodes, edges };
	}

	function setCollapsedStateForAll(nextValue: boolean) {
		const next: Record<string, boolean> = {};
		for (const hostId of Object.keys(machineVmIndex)) {
			if ((machineVmIndex[hostId]?.vmCount ?? 0) === 0) {
				continue;
			}
			next[hostId] = nextValue;
		}
		collapsedHosts = next;
		refreshGraph();
	}

	function onAllVmsToggleChange(event: Event) {
		const hideAll = (event.currentTarget as HTMLInputElement).checked;
		setCollapsedStateForAll(hideAll);
	}

	function toggleHostVmVisibility(hostId: string) {
		collapsedHosts = {
			...collapsedHosts,
			[hostId]: !isHostCollapsed(hostId)
		};
		refreshGraph();
	}

	function toggleSelectedMachineVmVisibility() {
		const hostId = selectedMachineNodeId();
		if (!hostId) {
			return;
		}
		toggleHostVmVisibility(hostId);
	}

	function refreshGraph() {
		if (!cy) {
			return;
		}

		const transformed = transformNetworkDataToGraph(networkData);
		machineVmIndex = transformed.machineVmIndex;
		syncCollapsedHosts(machineVmIndex);
		const visible = buildVisibleElements(transformed);
		warnings = transformed.warnings;
			cy.batch(() => {
				cy?.elements().remove();
				cy?.add([...visible.nodes, ...visible.edges]);
			});
			runAdaptiveLayout(cy);
			if (diagramViewMode === 'network') {
				applyPhysicalEdgeDeconfliction(cy);
				applyEthernetLabelVisibility(showEthernetLabels);
			}
			tooltip.visible = false;
		}

	function revalidateDraft() {
		const validation = validateNetworkData(networkData);
		validationIssues = validation.errors;
	}

	function clearAutosaveTimer() {
		if (autosaveTimer !== null) {
			clearTimeout(autosaveTimer);
			autosaveTimer = null;
		}
	}

	function scheduleAutosave() {
		if (!hasLoadedInitialData) {
			return;
		}
		saveError = null;
		saveState = 'unsaved';
		if (!writable) {
			return;
		}

		clearAutosaveTimer();
		autosaveTimer = setTimeout(() => {
			void persistDraft();
		}, autosaveDelayMs);
	}

	async function persistDraft() {
		if (!writable) {
			return;
		}

		const snapshot = JSON.stringify(networkData);
		if (snapshot === lastSavedSnapshot) {
			saveState = 'saved';
			return;
		}

		if (saveInFlight) {
			trailingSaveRequested = true;
			return;
		}

		saveInFlight = true;
		saveState = 'saving';
		saveError = null;

		try {
			const response = await fetch('/api/network-data', {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json'
				},
				body: snapshot
			});

			if (response.status === 403) {
				const body = (await response.json().catch(() => ({}))) as {
					error?: string;
					writableReason?: string | null;
				};
				writable = false;
				readOnlyNotice = resolveReadOnlyNotice(body.writableReason ?? body.error ?? null);
				saveState = 'unsaved';
				return;
			}

			if (!response.ok) {
				const body = (await response.json().catch(() => ({}))) as {
					error?: string;
					details?: Array<{ path: string; message: string }>;
				};
				saveState = 'error';
				saveError = body.error ?? 'Save failed';
				if (Array.isArray(body.details)) {
					validationIssues = body.details;
				}
				return;
			}

			const body = (await response.json()) as {
				data: NetworkData;
				writable: boolean;
				writableReason?: string | null;
				source: string;
				updatedAt: string;
			};
			writable = body.writable;
			readOnlyNotice = body.writable
				? defaultReadOnlyNotice
				: resolveReadOnlyNotice(body.writableReason);
			dataSourceLabel = body.source;
			lastSavedSnapshot = JSON.stringify(body.data);
			networkData = cloneNetworkData(body.data);
			revalidateDraft();
			refreshGraph();
			saveState = 'saved';
		} catch (error) {
			saveState = 'error';
			saveError = resolveErrorMessage(error);
		} finally {
			saveInFlight = false;
			if (trailingSaveRequested) {
				trailingSaveRequested = false;
				void persistDraft();
			}
		}
	}

	function applyDraft(next: NetworkData, options?: { autosave?: boolean }) {
		networkData = cloneNetworkData(next);
		ensureSelectedTargetValid();
		revalidateDraft();
		refreshGraph();
		if (options?.autosave ?? true) {
			scheduleAutosave();
		}
	}

	function mutateDraft(
		mutator: (draft: NetworkData) => void,
		options?: { autosave?: boolean; reconcile?: boolean }
	) {
		const draft = cloneNetworkData(networkData);
		mutator(draft);
		const next = options?.reconcile ? withReconciledConnections(draft) : draft;
		applyDraft(next, { autosave: options?.autosave ?? true });
	}

	function setSelectedTargetIconKey(nextKey: string) {
		const normalized = nextKey.trim();
		const target = selectedTarget;
		if (!target) {
			return;
		}

		if (target.type === 'machine') {
			const index = target.index;
			mutateDraft(
				(draft) => {
					draft.machines[index].iconKey = normalized || undefined;
				},
				{ autosave: true }
			);
			return;
		}

		if (target.type === 'device') {
			const index = target.index;
			mutateDraft(
				(draft) => {
					draft.devices[index].iconKey = normalized || undefined;
				},
				{ autosave: true }
			);
			return;
		}

		const machineIndex = target.machineIndex;
		const vmIndex = target.vmIndex;
		mutateDraft(
			(draft) => {
				draft.machines[machineIndex].software.vms[vmIndex].iconKey = normalized || undefined;
			},
			{ autosave: true }
		);
	}

	function setAddModalIconKey(nextKey: string) {
		const normalized = nextKey.trim();
		if (addModalKind === 'machine') {
			newMachineDraft.iconKey = normalized || undefined;
			return;
		}
		if (addModalKind === 'device') {
			newDeviceDraft.iconKey = normalized || undefined;
		}
	}

	function nextUniqueName(base: string, existing: string[]): string {
		const normalized = new Set(existing.map((name) => name.toLowerCase()));
		if (!normalized.has(base.toLowerCase())) {
			return base;
		}
		for (let index = 2; index < 1000; index += 1) {
			const candidate = `${base} ${index}`;
			if (!normalized.has(candidate.toLowerCase())) {
				return candidate;
			}
		}
		return `${base} ${Date.now()}`;
	}

	function hasOwnerNameCollision(nextName: string, ignore?: { type: 'machine' | 'device'; index: number }) {
		const normalized = nextName.trim().toLowerCase();
		if (!normalized) {
			return false;
		}

		for (const [index, machine] of networkData.machines.entries()) {
			if (ignore?.type === 'machine' && ignore.index === index) {
				continue;
			}
			if (machine.machineName.trim().toLowerCase() === normalized) {
				return true;
			}
		}

		for (const [index, device] of networkData.devices.entries()) {
			if (ignore?.type === 'device' && ignore.index === index) {
				continue;
			}
			if (device.name.trim().toLowerCase() === normalized) {
				return true;
			}
		}

		return false;
	}

	function updateMachineName(index: number, nextName: string) {
		const previous = networkData.machines[index]?.machineName;
		if (!previous || !nextName.trim()) {
			return;
		}
		if (hasOwnerNameCollision(nextName, { type: 'machine', index })) {
			saveError = `Name "${nextName.trim()}" is already used by another machine or device.`;
			return;
		}
		const renamed = renameOwner(networkData, 'machine', previous, nextName.trim());
		const nextIndex = renamed.machines.findIndex((machine) => equalsIgnoreCase(machine.machineName, nextName));
		applyDraft(renamed);
		if (nextIndex >= 0) {
			selectedTarget = { type: 'machine', index: nextIndex };
		}
	}

	function updateDeviceName(index: number, nextName: string) {
		const previous = networkData.devices[index]?.name;
		if (!previous || !nextName.trim()) {
			return;
		}
		if (hasOwnerNameCollision(nextName, { type: 'device', index })) {
			saveError = `Name "${nextName.trim()}" is already used by another machine or device.`;
			return;
		}
		const renamed = renameOwner(networkData, 'device', previous, nextName.trim());
		const nextIndex = renamed.devices.findIndex((device) => equalsIgnoreCase(device.name, nextName));
		applyDraft(renamed);
		if (nextIndex >= 0) {
			selectedTarget = { type: 'device', index: nextIndex };
		}
	}

	function updateMachinePortName(machineIndex: number, portIndex: number, nextPortName: string) {
		const machine = networkData.machines[machineIndex];
		const previous = machine?.ports?.[portIndex]?.portName;
		if (!machine || !previous || !nextPortName.trim()) {
			return;
		}
		const duplicate = (machine.ports ?? []).some(
			(port, index) => index !== portIndex && equalsIgnoreCase(port.portName, nextPortName)
		);
		if (duplicate) {
			saveError = `Port name "${nextPortName.trim()}" already exists on ${machine.machineName}.`;
			return;
		}
		applyDraft(renamePort(networkData, 'machine', machine.machineName, previous, nextPortName.trim()));
	}

	function updateDevicePortName(deviceIndex: number, portIndex: number, nextPortName: string) {
		const device = networkData.devices[deviceIndex];
		const previous = device?.ports?.[portIndex]?.portName;
		if (!device || !previous || !nextPortName.trim()) {
			return;
		}
		const duplicate = (device.ports ?? []).some(
			(port, index) => index !== portIndex && equalsIgnoreCase(port.portName, nextPortName)
		);
		if (duplicate) {
			saveError = `Port name "${nextPortName.trim()}" already exists on ${device.name}.`;
			return;
		}
		applyDraft(renamePort(networkData, 'device', device.name, previous, nextPortName.trim()));
	}

	function updateMachinePortConnection(machineIndex: number, portIndex: number, target: Port['connectedTo']) {
		const machine = networkData.machines[machineIndex];
		const port = machine?.ports?.[portIndex];
		const portName = port?.portName;
		if (!machine || !portName || !port) {
			return;
		}
		const normalizedTarget = normalizeConnectionTarget(target);
		if (sameConnection(port.connectedTo, normalizedTarget)) {
			return;
		}
		applyDraft(setPortConnection(networkData, 'machine', machine.machineName, portName, normalizedTarget));
	}

	function updateDevicePortConnection(deviceIndex: number, portIndex: number, target: Port['connectedTo']) {
		const device = networkData.devices[deviceIndex];
		const port = device?.ports?.[portIndex];
		const portName = port?.portName;
		if (!device || !portName || !port) {
			return;
		}
		const normalizedTarget = normalizeConnectionTarget(target);
		if (sameConnection(port.connectedTo, normalizedTarget)) {
			return;
		}
		applyDraft(setPortConnection(networkData, 'device', device.name, portName, normalizedTarget));
	}

	function onMachinePortConnectionFieldChange(
		machineIndex: number,
		portIndex: number,
		field: 'device' | 'port',
		value: string
	) {
		const machine = networkData.machines[machineIndex];
		const port = machine?.ports?.[portIndex];
		if (!machine || !port) {
			return;
		}
		const current = resolveConnectionDraft('machine', machine.machineName, port);
		const next = {
			...current,
			[field]: value
		};
		setConnectionDraft('machine', machine.machineName, port.portName, next);
		updateMachinePortConnection(machineIndex, portIndex, next);
	}

	function onDevicePortConnectionFieldChange(
		deviceIndex: number,
		portIndex: number,
		field: 'device' | 'port',
		value: string
	) {
		const device = networkData.devices[deviceIndex];
		const port = device?.ports?.[portIndex];
		if (!device || !port) {
			return;
		}
		const current = resolveConnectionDraft('device', device.name, port);
		const next = {
			...current,
			[field]: value
		};
		setConnectionDraft('device', device.name, port.portName, next);
		updateDevicePortConnection(deviceIndex, portIndex, next);
	}

	function deleteMachine(machineIndex: number) {
		const machine = networkData.machines[machineIndex];
		if (!machine) {
			return;
		}
		applyDraft(deleteOwner(networkData, 'machine', machine.machineName));
		closeSelectedTargetModal();
		deleteTarget = null;
	}

	function deleteDevice(deviceIndex: number) {
		const device = networkData.devices[deviceIndex];
		if (!device) {
			return;
		}
		applyDraft(deleteOwner(networkData, 'device', device.name));
		closeSelectedTargetModal();
		deleteTarget = null;
	}

	function deleteVm(machineIndex: number, vmIndex: number) {
		mutateDraft((draft) => {
			draft.machines[machineIndex]?.software.vms.splice(vmIndex, 1);
		});
		closeSelectedTargetModal();
		deleteTarget = null;
	}

	function addMachine() {
		const existingNames = [...networkData.machines.map((item) => item.machineName), ...networkData.devices.map((item) => item.name)];
		newMachineDraft = {
			...createEmptyMachine(),
			machineName: nextUniqueName('New Machine', existingNames)
		};
		addModalKind = 'machine';
	}

	function addDevice() {
		const existingNames = [...networkData.machines.map((item) => item.machineName), ...networkData.devices.map((item) => item.name)];
		newDeviceDraft = {
			...createEmptyDevice(),
			name: nextUniqueName('New Device', existingNames)
		};
		addModalKind = 'device';
	}

	function submitAddEntity() {
		if (addModalKind === 'machine') {
			mutateDraft((draft) => {
				draft.machines.push(cloneNetworkData({ machines: [newMachineDraft], devices: [] }).machines[0]);
			});
			selectedTarget = { type: 'machine', index: networkData.machines.length - 1 };
		}
		if (addModalKind === 'device') {
			mutateDraft((draft) => {
				draft.devices.push(cloneNetworkData({ machines: [], devices: [newDeviceDraft] }).devices[0]);
			});
			selectedTarget = { type: 'device', index: networkData.devices.length - 1 };
		}
		closeAddEntityModal();
	}

	function onThemeToggleChange(event: Event) {
		const isDark = (event.currentTarget as HTMLInputElement).checked;
		themeMode.set(isDark ? 'dark' : 'light');
	}

	function onEthernetLabelsToggleChange(event: Event) {
		showEthernetLabels = (event.currentTarget as HTMLInputElement).checked;
		if (diagramViewMode === 'network') {
			applyEthernetLabelVisibility(showEthernetLabels);
		}
	}

	function toggleMapControls() {
		mapControlsCollapsed = !mapControlsCollapsed;
	}

	function clearIconSearch() {
		iconSearch = '';
	}

	function closeSelectedTargetModal() {
		selectedTarget = null;
		clearIconSearch();
	}

	function closeAddEntityModal() {
		addModalKind = null;
		clearIconSearch();
	}

	function saveStateLabel(): string {
		if (saveState === 'saved') {
			return writable ? 'Saved' : 'Read-only';
		}
		if (saveState === 'saving') {
			return 'Saving...';
		}
		if (saveState === 'error') {
			return 'Save failed';
		}
		return writable ? 'Unsaved changes' : 'Unsaved (read-only)';
	}

	async function loadData() {
		isLoadingData = true;
		loadError = null;
		saveError = null;

		try {
			const response = await fetch('/api/network-data', {
				headers: { Accept: 'application/json' }
			});
			if (!response.ok) {
				throw new Error(`API responded with ${response.status}`);
			}
			const body = (await response.json()) as {
				data: NetworkData;
				writable: boolean;
				writableReason?: string | null;
				source: string;
				updatedAt: string;
			};
			const validation = validateNetworkData(body.data);
			if (!validation.valid || !validation.data) {
				throw new Error('API returned invalid network data');
			}

				networkData = cloneNetworkData(validation.data);
				ensureSelectedTargetValid();
				writable = body.writable;
				readOnlyNotice = body.writable
					? defaultReadOnlyNotice
					: resolveReadOnlyNotice(body.writableReason);
				dataSourceLabel = body.source;
				lastSavedSnapshot = JSON.stringify(networkData);
				saveState = 'saved';
				connectionDraftByKey = {};
				revalidateDraft();
				refreshGraph();
			hasLoadedInitialData = true;
			isLoadingData = false;
			return;
		} catch (apiError) {
			console.warn('[OpenNetworkDiagram] API load unavailable, falling back to static JSON', apiError);
		}

		try {
			const fallbackData = await loadNetworkData(jsonPath);
				networkData = cloneNetworkData(fallbackData);
				ensureSelectedTargetValid();
				writable = false;
				readOnlyNotice = 'Read-only: API unavailable; using bundled static data.';
				dataSourceLabel = jsonPath;
				lastSavedSnapshot = JSON.stringify(networkData);
				saveState = 'saved';
				connectionDraftByKey = {};
				revalidateDraft();
				refreshGraph();
			hasLoadedInitialData = true;
		} catch (error) {
			loadError = resolveErrorMessage(error);
		}
		isLoadingData = false;
	}

	function openDeleteConfirmation(target: DeleteTarget) {
		deleteTarget = target;
	}

	function confirmDelete() {
		if (!deleteTarget) {
			return;
		}
		if (deleteTarget.type === 'machine') {
			deleteMachine(deleteTarget.index);
			return;
		}
		if (deleteTarget.type === 'device') {
			deleteDevice(deleteTarget.index);
			return;
		}
		deleteVm(deleteTarget.machineIndex, deleteTarget.vmIndex);
	}

	function exportPng() {
		if (!cy) {
			return;
		}

		const background =
			exportBackground === 'transparent'
				? 'transparent'
				: currentTheme === 'dark'
					? '#0b1220'
					: '#e2e8f0';

		const dataUrl = cy.png({
			full: true,
			scale: exportScale,
			bg: background
		});
		const anchor = document.createElement('a');
		anchor.href = dataUrl;
		anchor.download = `${exportFileName || 'network-diagram'}.png`;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		showExportModal = false;
	}

	onMount(() => {
		let resizeHandler: (() => void) | null = null;
		let resizeTimeoutId: ReturnType<typeof setTimeout> | null = null;

		if (!cytoscape('layout', 'dagre')) {
			cytoscape.use(dagre);
		}

		themeMode.initialize();
			unsubscribeTheme = themeMode.subscribe((theme) => {
				currentTheme = theme;
				if (cy) {
					cy.style(createGraphStyles(theme));
					runAdaptiveLayout(cy);
					if (diagramViewMode === 'network') {
						applyPhysicalEdgeDeconfliction(cy);
						applyEthernetLabelVisibility(showEthernetLabels);
					}
				}
			});

		cy = cytoscape({
			container,
			elements: [],
			layout: { name: 'preset' },
			autoungrabify: true,
			minZoom: 0.2,
			maxZoom: 2.5,
			style: createGraphStyles(get(themeMode))
		});

		void loadData().finally(() => {
			isLoadingData = false;
		});

		cy.on('tap', 'node', (event) => {
			const data = event.target.data() as GraphNodeData;
			selectedTarget = decodeNodeId(data.id);
		});

		cy.on('tap', (event) => {
			if (event.target === cy) {
				closeSelectedTargetModal();
			}
		});

		cy.on('mouseover', 'node', (event) => {
			const node = event.target;
			const renderedPosition = node.renderedPosition();
			const data = node.data() as GraphNodeData;
			const nextText = data.rawName ?? data.label;
			const rawX = renderedPosition.x + tooltipOffset.x;
			const rawY = renderedPosition.y + tooltipOffset.y;
			const clampedPosition = clampTooltipPosition(rawX, rawY);
			tooltip = {
				visible: true,
				text: nextText,
				x: clampedPosition.x,
				y: clampedPosition.y
			};
		});

		cy.on('mouseout', 'node', () => {
			tooltip.visible = false;
		});

		cy.on('pan zoom', () => {
			tooltip.visible = false;
		});

		resizeHandler = () => {
			if (resizeTimeoutId !== null) {
				clearTimeout(resizeTimeoutId);
			}

			resizeTimeoutId = setTimeout(() => {
					if (!cy) {
						return;
					}
					runAdaptiveLayout(cy);
					if (diagramViewMode === 'network') {
						applyPhysicalEdgeDeconfliction(cy);
						applyEthernetLabelVisibility(showEthernetLabels);
					}
					resizeTimeoutId = null;
				}, 100);
			};
		window.addEventListener('resize', resizeHandler);

		return () => {
			clearAutosaveTimer();
			if (resizeHandler) {
				window.removeEventListener('resize', resizeHandler);
			}
			if (resizeTimeoutId !== null) {
				clearTimeout(resizeTimeoutId);
				resizeTimeoutId = null;
			}
			if (unsubscribeTheme) {
				unsubscribeTheme();
				unsubscribeTheme = null;
			}
			if (cy) {
				cy.destroy();
				cy = null;
			}
		};
	});
</script>

	<div class="diagram-shell">
		<div class="diagram-stage" bind:this={diagramStage}>
			<div class="diagram-canvas" bind:this={container}></div>

			<div class="map-controls-shell">
				{#if mapControlsCollapsed}
					<button type="button" class="controls-toggle" on:click={toggleMapControls}>Show Controls</button>
				{:else}
					<div class="map-controls">
						<button type="button" on:click={loadData} disabled={isLoadingData}>Reload JSON</button>
						<button type="button" on:click={addMachine}>Add Machine</button>
						<button type="button" on:click={addDevice}>Add Device</button>
						<label class="select-control">
							<span>Diagram View</span>
							<select
								value={diagramViewMode}
								aria-label="Select diagram view"
								on:change={onDiagramViewSelectChange}
							>
								<option value="network">Network view (with ethernet)</option>
								<option value="device">Device view (without ethernet)</option>
							</select>
						</label>
						<label
							class="toggle-control"
							class:disabled={diagramViewMode === 'device'}
							title={diagramViewMode === 'device' ? 'Ethernet labels are available in Network view.' : undefined}
						>
							<span>Ethernet Labels</span>
							<input
								class="toggle-input"
								type="checkbox"
								checked={showEthernetLabels}
								aria-label="Toggle ethernet labels"
								disabled={diagramViewMode === 'device'}
								on:change={onEthernetLabelsToggleChange}
							/>
							<span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
						</label>
						<button type="button" on:click={() => (showExportModal = true)}>Export PNG</button>
						<label class="toggle-control">
							<span>Dark Mode</span>
							<input
								class="toggle-input"
								type="checkbox"
								checked={currentTheme === 'dark'}
								aria-label="Toggle dark mode"
								on:change={onThemeToggleChange}
							/>
							<span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
						</label>
						<label class="toggle-control" class:disabled={!hasAnyVmHosts}>
							<span>Hide All VMs</span>
							<input
								class="toggle-input"
								type="checkbox"
								checked={areAllVmHostsCollapsed}
								aria-label="Toggle all virtual machine visibility"
								disabled={!hasAnyVmHosts}
								on:change={onAllVmsToggleChange}
							/>
							<span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
						</label>
						<button
							type="button"
							class="controls-collapse-tab"
							aria-label="Hide controls"
							title="Hide controls"
							on:click={toggleMapControls}
						>
							›
						</button>
					</div>
				{/if}
			</div>

		<div class="data-source">Source: {dataSourceLabel}</div>
		<div class="status-chip" class:error={saveState === 'error'}>
			{saveStateLabel()}
		</div>

		{#if hasLoadedInitialData && !writable}
			<div class="readonly-banner">{readOnlyNotice}</div>
		{/if}

		{#if isLoadingData}
			<div class="status-chip loading">Loading JSON...</div>
		{/if}

		{#if loadError}
			<div class="status-chip error secondary">{loadError}</div>
		{/if}
		{#if saveError}
			<div class="status-chip error tertiary">{saveError}</div>
		{/if}

		{#if tooltip.visible}
			<div class="tooltip" bind:this={tooltipElement} style={`left: ${tooltip.x}px; top: ${tooltip.y}px;`}>
				{tooltip.text}
			</div>
		{/if}
	</div>

	{#if warnings.length > 0}
		<details class="warnings-panel">
			<summary>Data warnings ({warnings.length})</summary>
			<ul>
				{#each warnings as warning (warning)}
					<li>{warning}</li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if validationIssues.length > 0}
		<details class="validation-panel">
			<summary>Validation issues ({validationIssues.length})</summary>
			<ul>
				{#each validationIssues as issue (`${issue.path}:${issue.message}`)}
					<li><strong>{issue.path}</strong>: {issue.message}</li>
				{/each}
			</ul>
		</details>
	{/if}
</div>

<Modal
	isOpen={selectedTarget !== null}
	title={
		selectedTarget?.type === 'machine'
			? selectedMachine?.machineName ?? 'Machine'
			: selectedTarget?.type === 'device'
				? selectedDevice?.name ?? 'Device'
				: selectedVm?.name ?? 'Virtual Machine'
	}
	maxWidth="880px"
	on:close={closeSelectedTargetModal}
>
	<div class="icon-search">
		<label>
			Icon Search
			<input
				type="text"
				bind:value={iconSearch}
				placeholder="Search icons..."
				autocomplete="off"
			/>
		</label>
		{#if selectedTargetIconPath}
			<div class="icon-preview-card">
				<img src={selectedTargetIconPath} alt="Selected icon preview" loading="lazy" />
				<code>{selectedTargetIconKey}</code>
			</div>
		{/if}
		<p class="icon-results-meta">
			Showing {Math.min(visibleIconDefinitions.length, iconResultLimit)} of {filteredIconDefinitions.length}
			matching icons
		</p>
		<div class="icon-results-grid">
			{#each visibleIconDefinitions as icon (icon.key)}
				<button
					type="button"
					class="icon-result-option"
					on:click={() => setSelectedTargetIconKey(icon.key)}
					title={icon.key}
				>
					<img src={icon.path} alt={icon.label} loading="lazy" />
					<span>{icon.label}</span>
					<code>{icon.key}</code>
				</button>
			{/each}
		</div>
		{#if filteredIconDefinitions.length === 0}
			<p class="icon-results-empty">No icons match your search.</p>
		{/if}
	</div>
	{#if selectedTarget?.type === 'machine' && selectedMachine}
		<div class="inline-actions">
			{#if selectedMachineHostId && selectedMachineVmCount > 0}
				<button type="button" on:click={toggleSelectedMachineVmVisibility}>
					{isHostCollapsed(selectedMachineHostId) ? 'Show VMs on Diagram' : 'Hide VMs on Diagram'}
				</button>
			{/if}
		</div>
		<section class="edit-section">
			<label>
				Machine Name
				<input
					type="text"
					value={selectedMachine.machineName}
					on:change={(event) =>
						updateMachineName(selectedTarget.index, (event.currentTarget as HTMLInputElement).value)}
				/>
			</label>
			<label>
				IP Address
				<input
					type="text"
					value={selectedMachine.ipAddress}
					on:input={(event) =>
						mutateDraft(
							(draft) => {
								draft.machines[selectedTarget.index].ipAddress = (
									event.currentTarget as HTMLInputElement
								).value;
							},
							{ autosave: true }
						)}
				/>
			</label>
			<label>
				Role
				<input
					type="text"
					value={selectedMachine.role}
					on:input={(event) =>
						mutateDraft(
							(draft) => {
								draft.machines[selectedTarget.index].role = (
									event.currentTarget as HTMLInputElement
								).value;
							},
							{ autosave: true }
						)}
				/>
			</label>
			<label>
				Operating System
				<input
					type="text"
					value={selectedMachine.operatingSystem}
					on:input={(event) =>
						mutateDraft(
							(draft) => {
								draft.machines[selectedTarget.index].operatingSystem = (
									event.currentTarget as HTMLInputElement
								).value;
							},
							{ autosave: true }
						)}
				/>
			</label>
		</section>

		<section class="edit-section">
			<h4>Hardware</h4>
			<div class="field-row">
				<label>
					CPU
					<input
						type="text"
						value={selectedMachine.hardware.cpu}
						on:input={(event) =>
							mutateDraft(
								(draft) => {
									draft.machines[selectedTarget.index].hardware.cpu = (
										event.currentTarget as HTMLInputElement
									).value;
								},
								{ autosave: true }
							)}
					/>
				</label>
				<label>
					RAM
					<input
						type="text"
						value={selectedMachine.hardware.ram}
						on:input={(event) =>
							mutateDraft(
								(draft) => {
									draft.machines[selectedTarget.index].hardware.ram = (
										event.currentTarget as HTMLInputElement
									).value;
								},
								{ autosave: true }
							)}
					/>
				</label>
				<label>
					Ports
					<input
						type="number"
						min="0"
						value={selectedMachine.hardware.networkPorts}
						on:input={(event) =>
							mutateDraft(
								(draft) => {
									const rawValue = (event.currentTarget as HTMLInputElement).value;
									const parsed = Number(rawValue);
									draft.machines[selectedTarget.index].hardware.networkPorts = Number.isFinite(
										parsed
									)
										? parsed
										: 0;
								},
								{ autosave: true }
							)}
					/>
				</label>
			</div>
		</section>

		<section class="edit-section">
			<h4>Virtual Machines</h4>
			<div class="inline-actions">
				<button
					type="button"
					on:click={() =>
						mutateDraft((draft) => {
							draft.machines[selectedTarget.index].software.vms.push({
								...createEmptyVm(),
								name: nextUniqueName(
									'New VM',
									draft.machines[selectedTarget.index].software.vms.map((vm) => vm.name)
								)
							});
						})}
				>
					Add VM
				</button>
			</div>
			{#each selectedMachine.software.vms as vm, vmIndex (`${vm.name}:${vm.ipAddress}:${vmIndex}`)}
				<div class="item-card">
					<label>
						Name
						<input
							type="text"
							bind:value={vm.name}
							on:input={() => mutateDraft(() => undefined, { autosave: true })}
						/>
					</label>
					<label>
						Role
						<input
							type="text"
							bind:value={vm.role}
							on:input={() => mutateDraft(() => undefined, { autosave: true })}
						/>
					</label>
					<label>
						IP
						<input
							type="text"
							bind:value={vm.ipAddress}
							on:input={() => mutateDraft(() => undefined, { autosave: true })}
						/>
					</label>
					<label>
						Icon
						<input
							type="text"
							bind:value={vm.iconKey}
							on:change={() => mutateDraft(() => undefined, { autosave: true })}
						/>
					</label>
					<button
						type="button"
						class="danger"
						on:click={() => openDeleteConfirmation({ type: 'vm', machineIndex: selectedTarget.index, vmIndex })}
					>
						Delete VM
					</button>
				</div>
			{/each}
		</section>

			<section class="edit-section">
				<h4>Ports</h4>
				<datalist id="machine-connectable-owner-options">
					{#each machineConnectableOwnerNames as ownerName (ownerName)}
						<option value={ownerName}></option>
					{/each}
				</datalist>
				<div class="inline-actions">
					<button
						type="button"
					on:click={() =>
						mutateDraft((draft) => {
							draft.machines[selectedTarget.index].ports ??= [];
							draft.machines[selectedTarget.index].ports.push({
								...createEmptyPort('eth'),
								portName: nextUniqueName(
									'eth0',
									draft.machines[selectedTarget.index].ports.map((port) => port.portName)
								)
							});
						})}
				>
					Add Port
				</button>
			</div>
			{#each selectedMachine.ports ?? [] as port, portIndex (`${port.portName}:${portIndex}`)}
				<div class="item-card">
					<label>
						Port Name
						<input
							type="text"
							value={port.portName}
							on:change={(event) =>
								updateMachinePortName(selectedTarget.index, portIndex, (event.currentTarget as HTMLInputElement).value)}
						/>
					</label>
					<label>
						Speed (Gbps)
						<input
							type="number"
							min="0"
							bind:value={port.speedGbps}
							on:input={() => mutateDraft(() => undefined, { autosave: true })}
						/>
					</label>
						<label>
							Connect To Device
							<input
								type="text"
								list="machine-connectable-owner-options"
								value={resolveConnectionDraft('machine', selectedMachine.machineName, port).device}
								on:change={(event) =>
									onMachinePortConnectionFieldChange(
									selectedTarget.index,
									portIndex,
									'device',
									(event.currentTarget as HTMLInputElement).value
								)}
						/>
					</label>
					<label>
						Target Port
						<input
							type="text"
							value={resolveConnectionDraft('machine', selectedMachine.machineName, port).port}
							on:change={(event) =>
								onMachinePortConnectionFieldChange(
									selectedTarget.index,
									portIndex,
									'port',
									(event.currentTarget as HTMLInputElement).value
								)}
						/>
					</label>
					<div class="item-actions">
						<button
							type="button"
							on:click={() => {
								clearConnectionDraft('machine', selectedMachine.machineName, port.portName);
								updateMachinePortConnection(selectedTarget.index, portIndex, undefined);
							}}
						>
							Disconnect
						</button>
						<button
							type="button"
							class="danger"
							on:click={() => {
								clearConnectionDraft('machine', selectedMachine.machineName, port.portName);
								applyDraft(deletePort(networkData, 'machine', selectedMachine.machineName, port.portName));
							}}
						>
							Delete Port
						</button>
					</div>
				</div>
			{/each}
		</section>

		<div class="modal-footer">
			<button type="button" class="danger" on:click={() => openDeleteConfirmation({ type: 'machine', index: selectedTarget.index })}>
				Delete Machine
			</button>
		</div>
	{:else if selectedTarget?.type === 'device' && selectedDevice}
		<section class="edit-section">
			<label>
				Device Name
				<input
					type="text"
					value={selectedDevice.name}
					on:change={(event) =>
						updateDeviceName(selectedTarget.index, (event.currentTarget as HTMLInputElement).value)}
				/>
			</label>
			<label>
				IP Address
				<input
					type="text"
					value={selectedDevice.ipAddress}
					on:input={(event) =>
						mutateDraft(
							(draft) => {
								draft.devices[selectedTarget.index].ipAddress = (
									event.currentTarget as HTMLInputElement
								).value;
							},
							{ autosave: true }
						)}
				/>
			</label>
			<label>
				Type
				<input
					type="text"
					value={selectedDevice.type}
					on:input={(event) =>
						mutateDraft(
							(draft) => {
								draft.devices[selectedTarget.index].type = (
									event.currentTarget as HTMLInputElement
								).value;
							},
							{ autosave: true }
						)}
				/>
			</label>
			<label>
				Notes
				<textarea
					value={selectedDevice.notes ?? ''}
					on:input={(event) =>
						mutateDraft(
							(draft) => {
								draft.devices[selectedTarget.index].notes = (
									event.currentTarget as HTMLTextAreaElement
								).value;
							},
							{ autosave: true }
						)}
				></textarea>
			</label>
		</section>

			<section class="edit-section">
				<h4>Ports</h4>
				<datalist id="device-connectable-owner-options">
					{#each deviceConnectableOwnerNames as ownerName (ownerName)}
						<option value={ownerName}></option>
					{/each}
				</datalist>
				<div class="inline-actions">
					<button
						type="button"
					on:click={() =>
						mutateDraft((draft) => {
							draft.devices[selectedTarget.index].ports ??= [];
							draft.devices[selectedTarget.index].ports.push({
								...createEmptyPort('port'),
								portName: nextUniqueName(
									'port0',
									draft.devices[selectedTarget.index].ports.map((port) => port.portName)
								)
							});
						})}
				>
					Add Port
				</button>
			</div>
			{#each selectedDevice.ports ?? [] as port, portIndex (`${port.portName}:${portIndex}`)}
				<div class="item-card">
					<label>
						Port Name
						<input
							type="text"
							value={port.portName}
							on:change={(event) =>
								updateDevicePortName(selectedTarget.index, portIndex, (event.currentTarget as HTMLInputElement).value)}
						/>
					</label>
					<label>
						Speed (Gbps)
						<input
							type="number"
							min="0"
							bind:value={port.speedGbps}
							on:input={() => mutateDraft(() => undefined, { autosave: true })}
						/>
					</label>
						<label>
							Connect To Device
							<input
								type="text"
								list="device-connectable-owner-options"
								value={resolveConnectionDraft('device', selectedDevice.name, port).device}
								on:change={(event) =>
									onDevicePortConnectionFieldChange(
									selectedTarget.index,
									portIndex,
									'device',
									(event.currentTarget as HTMLInputElement).value
								)}
						/>
					</label>
					<label>
						Target Port
						<input
							type="text"
							value={resolveConnectionDraft('device', selectedDevice.name, port).port}
							on:change={(event) =>
								onDevicePortConnectionFieldChange(
									selectedTarget.index,
									portIndex,
									'port',
									(event.currentTarget as HTMLInputElement).value
								)}
						/>
					</label>
					<div class="item-actions">
						<button
							type="button"
							on:click={() => {
								clearConnectionDraft('device', selectedDevice.name, port.portName);
								updateDevicePortConnection(selectedTarget.index, portIndex, undefined);
							}}
						>
							Disconnect
						</button>
						<button
							type="button"
							class="danger"
							on:click={() => {
								clearConnectionDraft('device', selectedDevice.name, port.portName);
								applyDraft(deletePort(networkData, 'device', selectedDevice.name, port.portName));
							}}
						>
							Delete Port
						</button>
					</div>
				</div>
			{/each}
		</section>

		<div class="modal-footer">
			<button type="button" class="danger" on:click={() => openDeleteConfirmation({ type: 'device', index: selectedTarget.index })}>
				Delete Device
			</button>
		</div>
	{:else if selectedTarget?.type === 'vm' && selectedVm}
		<section class="edit-section">
			<label>
				VM Name
				<input
					type="text"
					value={selectedVm.name}
					on:input={(event) =>
						mutateDraft(
							(draft) => {
								draft.machines[selectedTarget.machineIndex].software.vms[
									selectedTarget.vmIndex
								].name = (event.currentTarget as HTMLInputElement).value;
							},
							{ autosave: true }
						)}
				/>
			</label>
			<label>
				Role
				<input
					type="text"
					value={selectedVm.role}
					on:input={(event) =>
						mutateDraft(
							(draft) => {
								draft.machines[selectedTarget.machineIndex].software.vms[
									selectedTarget.vmIndex
								].role = (event.currentTarget as HTMLInputElement).value;
							},
							{ autosave: true }
						)}
				/>
			</label>
			<label>
				IP Address
				<input
					type="text"
					value={selectedVm.ipAddress}
					on:input={(event) =>
						mutateDraft(
							(draft) => {
								draft.machines[selectedTarget.machineIndex].software.vms[
									selectedTarget.vmIndex
								].ipAddress = (event.currentTarget as HTMLInputElement).value;
							},
							{ autosave: true }
						)}
				/>
			</label>
		</section>
		<div class="modal-footer">
			<button
				type="button"
				class="danger"
				on:click={() =>
					openDeleteConfirmation({
						type: 'vm',
						machineIndex: selectedTarget.machineIndex,
						vmIndex: selectedTarget.vmIndex
					})}
			>
				Delete VM
			</button>
		</div>
	{/if}
</Modal>

<Modal
	isOpen={addModalKind !== null}
	title={addModalKind === 'machine' ? 'Add Machine' : 'Add Device'}
	maxWidth="760px"
	on:close={closeAddEntityModal}
>
	<div class="icon-search">
		<label>
			Icon Search
			<input
				type="text"
				bind:value={iconSearch}
				placeholder="Search icons..."
				autocomplete="off"
			/>
		</label>
		{#if addModalIconPath}
			<div class="icon-preview-card">
				<img src={addModalIconPath} alt="Selected icon preview" loading="lazy" />
				<code>{addModalIconKey}</code>
			</div>
		{/if}
		<p class="icon-results-meta">
			Showing {Math.min(visibleIconDefinitions.length, iconResultLimit)} of {filteredIconDefinitions.length}
			matching icons
		</p>
		<div class="icon-results-grid">
			{#each visibleIconDefinitions as icon (icon.key)}
				<button
					type="button"
					class="icon-result-option"
					on:click={() => setAddModalIconKey(icon.key)}
					title={icon.key}
				>
					<img src={icon.path} alt={icon.label} loading="lazy" />
					<span>{icon.label}</span>
					<code>{icon.key}</code>
				</button>
			{/each}
		</div>
		{#if filteredIconDefinitions.length === 0}
			<p class="icon-results-empty">No icons match your search.</p>
		{/if}
	</div>
	{#if addModalKind === 'machine'}
		<section class="edit-section">
			<label>
				Machine Name
				<input type="text" bind:value={newMachineDraft.machineName} />
			</label>
			<label>
				IP Address
				<input type="text" bind:value={newMachineDraft.ipAddress} />
			</label>
			<label>
				Role
				<input type="text" bind:value={newMachineDraft.role} />
			</label>
			<label>
				Operating System
				<input type="text" bind:value={newMachineDraft.operatingSystem} />
			</label>
		</section>
	{:else if addModalKind === 'device'}
		<section class="edit-section">
			<label>
				Device Name
				<input type="text" bind:value={newDeviceDraft.name} />
			</label>
			<label>
				IP Address
				<input type="text" bind:value={newDeviceDraft.ipAddress} />
			</label>
			<label>
				Type
				<input type="text" bind:value={newDeviceDraft.type} />
			</label>
			<label>
				Notes
				<textarea bind:value={newDeviceDraft.notes}></textarea>
			</label>
		</section>
	{/if}

	<div class="modal-footer">
		<button type="button" on:click={submitAddEntity}>Add</button>
	</div>
</Modal>

<Modal
	isOpen={deleteTarget !== null}
	title="Confirm Delete"
	maxWidth="520px"
	on:close={() => (deleteTarget = null)}
>
	<p>This action will remove the selected item and clean up related links. Continue?</p>
	<div class="modal-footer">
		<button type="button" class="danger" on:click={confirmDelete}>Delete</button>
		<button type="button" on:click={() => (deleteTarget = null)}>Cancel</button>
	</div>
</Modal>

<Modal isOpen={showExportModal} title="Export PNG" maxWidth="520px" on:close={() => (showExportModal = false)}>
	<section class="edit-section">
		<label>
			File Name
			<input type="text" bind:value={exportFileName} />
		</label>
		<label>
			Scale
			<select bind:value={exportScale}>
				<option value={1}>1x</option>
				<option value={2}>2x</option>
				<option value={3}>3x</option>
			</select>
		</label>
		<label>
			Background
			<select bind:value={exportBackground}>
				<option value="theme">Match Theme</option>
				<option value="transparent">Transparent</option>
			</select>
		</label>
	</section>
	<div class="modal-footer">
		<button type="button" on:click={exportPng}>Download PNG</button>
	</div>
</Modal>

<style>
	.diagram-shell {
		display: grid;
		grid-template-rows: minmax(580px, 1fr) auto;
		gap: 0.75rem;
		padding: 0.75rem;
		height: calc(100vh - 2rem);
	}

	.diagram-stage {
		position: relative;
		min-height: 580px;
		border: 1px solid var(--panel-border);
		border-radius: 10px;
		background: linear-gradient(180deg, var(--panel-bg) 0%, color-mix(in oklab, var(--panel-bg) 88%, black 12%) 100%);
		overflow: hidden;
	}

	.diagram-canvas {
		position: absolute;
		inset: 0;
	}

	.map-controls-shell {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		z-index: 14;
	}

	.map-controls {
		display: flex;
		gap: 0.4rem;
		background: color-mix(in oklab, var(--panel-bg) 93%, transparent 7%);
		border: 1px solid var(--panel-border);
		border-radius: 10px;
		padding: 0.4rem;
		padding-right: 2.2rem;
		flex-wrap: wrap;
		max-width: min(84vw, 760px);
		position: relative;
	}

	.controls-toggle {
		display: flex;
		gap: 0.4rem;
		border: 1px solid var(--panel-border);
		background: color-mix(in oklab, var(--panel-bg) 93%, transparent 7%);
		color: var(--panel-contrast);
		padding: 0.35rem 0.55rem;
		border-radius: 10px;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}

	.controls-collapse-tab {
		position: absolute;
		top: 50%;
		right: -0.95rem;
		transform: translateY(-50%);
		width: 1.9rem;
		height: 2.1rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--panel-border);
		border-radius: 0 9px 9px 0;
		background: color-mix(in oklab, var(--panel-bg) 93%, transparent 7%);
		color: var(--panel-contrast);
		font-size: 1.2rem;
		font-weight: 700;
		line-height: 1;
		cursor: pointer;
		box-shadow: 0 4px 14px rgba(15, 23, 42, 0.22);
	}

	.controls-collapse-tab:hover {
		background: color-mix(in oklab, var(--panel-bg) 82%, #3b82f6 18%);
	}

	.controls-collapse-tab:focus-visible {
		outline: 2px solid #60a5fa;
		outline-offset: 2px;
	}

	.map-controls button,
	.map-controls select,
	.modal-footer button,
	.item-actions button,
	.inline-actions button {
		border: 1px solid var(--panel-border);
		background: var(--panel-bg);
		color: var(--panel-contrast);
		padding: 0.35rem 0.55rem;
		border-radius: 7px;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}

	.map-controls select {
		min-width: 13.5rem;
	}

	.select-control {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		border: 1px solid var(--panel-border);
		background: var(--panel-bg);
		color: var(--panel-contrast);
		padding: 0.32rem 0.5rem;
		border-radius: 7px;
		font-size: 0.78rem;
		font-weight: 600;
	}

	button.danger {
		border-color: #ef4444;
		color: #dc2626;
	}

	.map-controls button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.toggle-control {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		border: 1px solid var(--panel-border);
		background: var(--panel-bg);
		color: var(--panel-contrast);
		padding: 0.32rem 0.5rem;
		border-radius: 7px;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		position: relative;
	}

	.toggle-control.disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.toggle-input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
		width: 1px;
		height: 1px;
	}

	.toggle-track {
		width: 2rem;
		height: 1.1rem;
		border-radius: 999px;
		border: 1px solid var(--panel-border);
		background: color-mix(in oklab, var(--panel-bg) 80%, black 20%);
		display: inline-flex;
		align-items: center;
		padding: 0.08rem;
		transition: background-color 0.15s ease, border-color 0.15s ease;
	}

	.toggle-thumb {
		width: 0.86rem;
		height: 0.86rem;
		border-radius: 999px;
		background: #ffffff;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.22);
		transform: translateX(0);
		transition: transform 0.15s ease;
	}

	.toggle-input:checked + .toggle-track {
		background: #2563eb;
		border-color: #2563eb;
	}

	.toggle-input:checked + .toggle-track .toggle-thumb {
		transform: translateX(0.9rem);
	}

	.toggle-input:focus-visible + .toggle-track {
		outline: 2px solid #60a5fa;
		outline-offset: 2px;
	}

	.data-source {
		position: absolute;
		top: 0.75rem;
		left: 0.75rem;
		z-index: 14;
		border: 1px solid var(--panel-border);
		border-radius: 8px;
		background: color-mix(in oklab, var(--panel-bg) 93%, transparent 7%);
		color: var(--muted-text);
		padding: 0.35rem 0.5rem;
		font-size: 0.72rem;
		font-weight: 600;
		max-width: min(55vw, 500px);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status-chip {
		position: absolute;
		left: 0.75rem;
		top: 2.75rem;
		z-index: 14;
		border: 1px solid var(--panel-border);
		border-radius: 8px;
		padding: 0.35rem 0.5rem;
		font-size: 0.73rem;
		font-weight: 600;
		background: var(--chip-bg);
		color: var(--chip-text);
	}

	.status-chip.loading {
		top: 4.95rem;
	}

	.status-chip.secondary {
		top: 6.95rem;
		max-width: min(65vw, 560px);
	}

	.status-chip.tertiary {
		top: 8.95rem;
		max-width: min(65vw, 560px);
	}

	.status-chip.error {
		border-color: #fca5a5;
		color: #b91c1c;
		background: #fee2e2;
	}

	.readonly-banner {
		position: absolute;
		left: 0.75rem;
		top: 4.95rem;
		z-index: 14;
		border: 1px solid #f59e0b;
		border-radius: 8px;
		padding: 0.35rem 0.5rem;
		font-size: 0.73rem;
		font-weight: 600;
		background: #ffedd5;
		color: #9a3412;
	}

	.tooltip {
		position: absolute;
		pointer-events: none;
		z-index: 12;
		background: rgba(15, 23, 42, 0.92);
		color: #f8fafc;
		font-size: 0.74rem;
		padding: 0.25rem 0.45rem;
		border-radius: 0.35rem;
		white-space: nowrap;
	}

	.warnings-panel,
	.validation-panel {
		border: 1px solid var(--panel-border);
		border-radius: 8px;
		background: var(--panel-bg);
		padding: 0.65rem 0.8rem;
		color: var(--panel-contrast);
		font-size: 0.92rem;
	}

	.validation-panel {
		border-color: #f59e0b;
	}

	.warnings-panel summary,
	.validation-panel summary {
		cursor: pointer;
		font-weight: 600;
	}

	.warnings-panel ul,
	.validation-panel ul {
		margin: 0.6rem 0 0;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.28rem;
	}

	.edit-section {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.65rem;
		margin-bottom: 1rem;
	}

	.edit-section h4 {
		grid-column: 1 / -1;
		margin: 0;
		font-size: 1rem;
	}

	.edit-section label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted-text);
	}

	.edit-section input,
	.edit-section textarea,
	.edit-section select {
		padding: 0.45rem 0.5rem;
		border-radius: 8px;
		border: 1px solid var(--panel-border);
		background: var(--panel-bg);
		color: var(--panel-contrast);
		font-size: 0.86rem;
	}

	.edit-section textarea {
		min-height: 64px;
		resize: vertical;
	}

	.field-row {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.6rem;
	}

	.item-card {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.45rem;
		padding: 0.65rem;
		border: 1px solid var(--panel-border);
		border-radius: 10px;
		background: color-mix(in oklab, var(--panel-bg) 92%, black 8%);
	}

	.item-actions {
		display: flex;
		gap: 0.4rem;
		align-items: end;
	}

	.inline-actions {
		grid-column: 1 / -1;
		display: flex;
		justify-content: flex-end;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.icon-search {
		margin-bottom: 0.7rem;
		display: grid;
		gap: 0.6rem;
	}

	.icon-search label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted-text);
	}

	.icon-search input {
		padding: 0.45rem 0.5rem;
		border-radius: 8px;
		border: 1px solid var(--panel-border);
		background: var(--panel-bg);
		color: var(--panel-contrast);
		font-size: 0.86rem;
	}

	.icon-preview-card {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem;
		border: 1px solid var(--panel-border);
		border-radius: 8px;
		background: color-mix(in oklab, var(--panel-bg) 92%, black 8%);
	}

	.icon-preview-card img {
		width: 28px;
		height: 28px;
		object-fit: contain;
	}

	.icon-preview-card code {
		font-size: 0.74rem;
		color: var(--muted-text);
		word-break: break-all;
	}

	.icon-results-meta {
		margin: 0;
		font-size: 0.74rem;
		font-weight: 600;
		color: var(--muted-text);
	}

	.icon-results-empty {
		margin: 0;
		font-size: 0.74rem;
		font-weight: 600;
		color: var(--muted-text);
	}

	.icon-results-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 0.45rem;
		max-height: 280px;
		overflow: auto;
		padding-right: 0.25rem;
	}

	.icon-result-option {
		display: grid;
		grid-template-columns: 24px 1fr;
		grid-template-areas:
			'icon label'
			'icon key';
		align-items: center;
		gap: 0.2rem 0.5rem;
		border: 1px solid var(--panel-border);
		background: var(--panel-bg);
		color: var(--panel-contrast);
		padding: 0.4rem 0.45rem;
		border-radius: 8px;
		cursor: pointer;
		text-align: left;
	}

	.icon-result-option:hover {
		background: color-mix(in oklab, var(--panel-bg) 84%, #3b82f6 16%);
	}

	.icon-result-option img {
		grid-area: icon;
		width: 20px;
		height: 20px;
		object-fit: contain;
	}

	.icon-result-option span {
		grid-area: label;
		font-size: 0.75rem;
		font-weight: 700;
		line-height: 1.2;
	}

	.icon-result-option code {
		grid-area: key;
		font-size: 0.66rem;
		color: var(--muted-text);
		line-height: 1.2;
		word-break: break-all;
	}

	@media (max-width: 900px) {
		.diagram-shell {
			height: auto;
			grid-template-rows: minmax(560px, 1fr) auto;
		}

		.data-source {
			max-width: min(72vw, 420px);
		}
	}
</style>
