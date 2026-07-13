<script lang="ts">
	import { onMount } from 'svelte';
	import cytoscape from 'cytoscape';
	import dagre from 'cytoscape-dagre';

	import { resolveIconPath } from '$lib/config/iconRegistry';
	import IconPickerPopover from './IconPickerPopover.svelte';
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
		renameRack,
		setPortCable,
		setPortConnection,
		type OwnerKind,
		withReconciledConnections
	} from '$lib/data/networkEditor';
	import loadNetworkData from '$lib/data/loadNetworkData';
	import { buildIpamReport, suggestNextFreeIp, type IpamReport } from '$lib/data/ipam';
	import { buildVlanIndexMap, vlanPaletteColor } from '$lib/graph/vlanPalette';
	import { readCanvasTokens, type CanvasTokens } from '$lib/graph/canvasTokens';
	import { buildRackLayout, knownRackNames } from '$lib/data/rackLayout';
	import RackView from './RackView.svelte';
	import NodeCardLayer from './NodeCardLayer.svelte';
	import { validateNetworkData, type ValidationIssue } from '$lib/data/networkSchema';
	import transformNetworkDataToGraph from '$lib/graph/transformNetworkData';
	import { computeSearchMatches, computeSearchMatchList } from '$lib/graph/searchHighlight';
	import type { GraphEdgeData, GraphNodeData, GraphTransformResult } from '$lib/graph/types';
	import { themeMode, type ThemeMode } from '$lib/stores/theme';
	import type { NetworkData, Port } from '$lib/types';
	import Modal from './Modal.svelte';
	import AppBar from './AppBar.svelte';
	import FirstRunCard from './FirstRunCard.svelte';
	import { toPng } from 'html-to-image';

	export let jsonPath = '/data/network.json';

	type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';
	type DiagramViewMode = 'network' | 'device' | 'rack';
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
	let iconPopoverOpen = false;
	let vmIconPopoverIndex: number | null = null;
	let expandedVmIndex: number | null = null;
	let expandedPortIndex: number | null = null;
	let lastIconPickerContext = '';

	let isLoadingData = false;
	let loadError: string | null = null;
	let saveError: string | null = null;
	let saveState: SaveState = 'saved';
	let dataSourceLabel = jsonPath;
	let writable = false;
	const defaultReadOnlyNotice = 'Read-only deployment; changes are not persisted.';
	let readOnlyNotice = defaultReadOnlyNotice;

	let showEthernetLabels = false;
	let showCableSpeeds = true;
	let diagramViewMode: DiagramViewMode = 'network';
	let searchQuery = '';
	let searchMatchCount = 0;
	let lastTransformResult: GraphTransformResult | null = null;
	let visibleGraphNodes: GraphTransformResult['nodes'] = [];
	let dimmedNodeIds: ReadonlySet<string> = new Set();
	let matchedNodeIds: ReadonlySet<string> = new Set();
	let activeSearchNodeId: string | null = null;
	let searchMatchIds: string[] = [];
	let searchActiveIndex = -1;
	let showIpamPanel = false;
	let activeVlanFilter: number | null = null;
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
	let appBar: AppBar | null = null;
	let graphViewport: HTMLDivElement;
	let isExportingPng = false;

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

	$: vlanLegend = (() => {
		const indexByVlanId = buildVlanIndexMap(networkData.subnets);
		const seen = new Set<number>();
		const entries: Array<{
			vlanId: number;
			name: string;
			cidr: string;
			color: string;
			count: number;
		}> = [];
		for (const subnet of networkData.subnets ?? []) {
			if (typeof subnet.vlanId !== 'number' || seen.has(subnet.vlanId)) {
				continue;
			}
			seen.add(subnet.vlanId);
			entries.push({
				vlanId: subnet.vlanId,
				name: subnet.name ?? `VLAN ${subnet.vlanId}`,
				cidr: subnet.cidr,
				color: vlanPaletteColor(indexByVlanId.get(subnet.vlanId) ?? 0),
				count: 0
			});
		}
		for (const node of lastTransformResult?.nodes ?? []) {
			const entry = entries.find((candidate) => candidate.vlanId === node.data.vlanId);
			if (entry) {
				entry.count += 1;
			}
		}
		return entries;
	})();
	$: if (
		activeVlanFilter !== null &&
		!vlanLegend.some((entry) => entry.vlanId === activeVlanFilter)
	) {
		activeVlanFilter = null;
		applyEmphasis();
	}

	$: rackLayout = buildRackLayout(networkData);
	$: rackNames = knownRackNames(networkData);

	let rackNewNameTarget: { kind: OwnerKind; index: number } | null = null;

	function onRackSelectChange(kind: OwnerKind, index: number, value: string) {
		if (value === '__new__') {
			rackNewNameTarget = { kind, index };
			return;
		}
		rackNewNameTarget = null;
		updateRackField(kind, index, 'name', value);
	}

	function submitNewRackName(value: string) {
		const target = rackNewNameTarget;
		rackNewNameTarget = null;
		const name = value.trim();
		if (!target || !name) {
			return;
		}
		mutateDraft(
			(draft) => {
				draft.racks ??= [];
				if (!draft.racks.some((rack) => rack.name.toLowerCase() === name.toLowerCase())) {
					draft.racks.push({ name });
				}
				const entity =
					target.kind === 'machine' ? draft.machines[target.index] : draft.devices[target.index];
				if (entity) {
					entity.rack = {
						name,
						unit: entity.rack?.unit ?? 1,
						...(entity.rack?.heightU ? { heightU: entity.rack.heightU } : {})
					};
				}
			},
			{ autosave: true }
		);
	}

	function renameRackDefinition(previousName: string, nextName: string) {
		if (!nextName.trim() || nextName.trim() === previousName) {
			return;
		}
		applyDraft(renameRack(networkData, previousName, nextName));
	}

	function setRackHeightU(rackName: string, value: string) {
		const parsed = Number(value);
		mutateDraft(
			(draft) => {
				draft.racks ??= [];
				let definition = draft.racks.find(
					(rack) => rack.name.toLowerCase() === rackName.toLowerCase()
				);
				if (!definition) {
					definition = { name: rackName };
					draft.racks.push(definition);
				}
				if (value.trim() && Number.isInteger(parsed) && parsed >= 1) {
					definition.heightU = parsed;
				} else {
					delete definition.heightU;
				}
			},
			{ autosave: true }
		);
	}

	function addRackDefinition() {
		const existing = new Set(rackNames.map((name) => name.toLowerCase()));
		let candidate = 'New Rack';
		for (let index = 2; existing.has(candidate.toLowerCase()) && index < 100; index += 1) {
			candidate = `New Rack ${index}`;
		}
		if (existing.has(candidate.toLowerCase())) {
			return;
		}
		mutateDraft(
			(draft) => {
				draft.racks ??= [];
				draft.racks.push({ name: candidate });
			},
			{ autosave: true }
		);
	}

	function removeRackDefinition(rackName: string) {
		mutateDraft(
			(draft) => {
				if (!draft.racks) {
					return;
				}
				draft.racks = draft.racks.filter(
					(rack) => rack.name.toLowerCase() !== rackName.toLowerCase()
				);
				if (draft.racks.length === 0) {
					delete draft.racks;
				}
			},
			{ autosave: true }
		);
	}

	$: ipamReport = buildIpamReport(networkData);
	$: ipamWarnings = ipamReport.duplicates.map(
		(duplicate) => `Duplicate IP ${duplicate.ip}: assigned to ${duplicate.owners.join(' and ')}.`
	);
	$: ipamView = ipamReport.subnets.map((subnet) => ({
		...subnet,
		utilisation: Math.min(100, Math.round((subnet.used / Math.max(subnet.capacity, 1)) * 100)),
		nextFree: suggestNextFreeIp(networkData, subnet.cidr)
	}));

	let subnetEditorOpen = false;
	let showRackManager = false;

	// First-run card: shown for an empty dataset or the untouched example
	// file, until dismissed (persisted) or the user makes their first edit.
	const firstRunDismissKey = 'ond-firstrun-dismissed';
	let firstRunDismissed =
		typeof localStorage !== 'undefined' && localStorage.getItem(firstRunDismissKey) === '1';

	function dismissFirstRun() {
		firstRunDismissed = true;
		try {
			localStorage.setItem(firstRunDismissKey, '1');
		} catch {
			// localStorage unavailable; the card just returns next session.
		}
	}

	function openFirstMachineEditor() {
		if (networkData.machines.length > 0) {
			selectedTarget = { type: 'machine', index: 0 };
		}
	}

	$: totalEntities = networkData.machines.length + networkData.devices.length;
	$: allExampleNames =
		totalEntities > 0 &&
		[
			...networkData.machines.map((machine) => machine.machineName),
			...networkData.devices.map((device) => device.name)
		].every((name) => name.trim().toLowerCase().startsWith('example'));
	$: showFirstRun =
		hasLoadedInitialData &&
		!firstRunDismissed &&
		!isLoadingData &&
		(totalEntities === 0 || (totalEntities <= 4 && allExampleNames));
	let copiedIp: string | null = null;
	let copiedIpTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingSubnetRemoval: number | null = null;

	async function copyNextFreeIp(ip: string) {
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(ip);
			} else {
				const scratch = document.createElement('textarea');
				scratch.value = ip;
				scratch.style.position = 'fixed';
				scratch.style.opacity = '0';
				document.body.appendChild(scratch);
				scratch.select();
				document.execCommand('copy');
				scratch.remove();
			}
			copiedIp = ip;
			if (copiedIpTimer !== null) {
				clearTimeout(copiedIpTimer);
			}
			copiedIpTimer = setTimeout(() => {
				copiedIp = null;
			}, 1500);
		} catch {
			// Clipboard unavailable (e.g. plain-http self-hosted deployments).
		}
	}

	// Removing a declared subnet is destructive-ish, so the quiet Remove
	// button asks for a second click instead of opening a modal.
	function requestSubnetRemoval(index: number) {
		if (pendingSubnetRemoval === index) {
			pendingSubnetRemoval = null;
			removeDeclaredSubnet(index);
		} else {
			pendingSubnetRemoval = index;
		}
	}

	function duplicateOwnersForIp(report: IpamReport, ip: string, selfLabel: string): string[] {
		const entry = report.duplicates.find((duplicate) => duplicate.ip === ip.trim());
		if (!entry) {
			return [];
		}
		return entry.owners.filter((owner) => owner !== selfLabel);
	}

	$: selectedMachine =
		selectedTarget?.type === 'machine' ? networkData.machines[selectedTarget.index] : null;
	$: selectedDevice =
		selectedTarget?.type === 'device' ? networkData.devices[selectedTarget.index] : null;
	$: selectedVm =
		selectedTarget?.type === 'vm'
			? networkData.machines[selectedTarget.machineIndex]?.software.vms[selectedTarget.vmIndex]
			: null;
	$: selectedMachineIpConflicts = selectedMachine
		? duplicateOwnersForIp(ipamReport, selectedMachine.ipAddress, selectedMachine.machineName)
		: [];
	$: selectedDeviceIpConflicts = selectedDevice
		? duplicateOwnersForIp(ipamReport, selectedDevice.ipAddress, selectedDevice.name)
		: [];
	$: selectedVmIpConflicts =
		selectedVm && selectedTarget?.type === 'vm'
			? duplicateOwnersForIp(
					ipamReport,
					selectedVm.ipAddress,
					`${selectedVm.name} (VM on ${networkData.machines[selectedTarget.machineIndex]?.machineName ?? ''})`
				)
			: [];
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
			? (selectedMachine?.iconKey ?? '')
			: selectedTarget?.type === 'device'
				? (selectedDevice?.iconKey ?? '')
				: selectedTarget?.type === 'vm'
					? (selectedVm?.iconKey ?? '')
					: '';
	$: selectedTargetIconPath = resolveIconPath(selectedTargetIconKey || undefined);
	// close popovers and collapse expanded rows whenever the modal target changes
	$: {
		const context = addModalKind ?? (selectedTarget ? JSON.stringify(selectedTarget) : '');
		if (context !== lastIconPickerContext) {
			lastIconPickerContext = context;
			iconPopoverOpen = false;
			vmIconPopoverIndex = null;
			expandedVmIndex = null;
			expandedPortIndex = null;
		}
	}
	// Narrowed copies of the selected-target indices: TypeScript can't narrow
	// the SelectedTarget union across the big template, so the markup uses
	// these instead of selectedTarget.index directly.
	$: selectedMachineIndex = selectedTarget?.type === 'machine' ? selectedTarget.index : -1;
	$: selectedDeviceIndex = selectedTarget?.type === 'device' ? selectedTarget.index : -1;
	$: selectedVmMachineIndex = selectedTarget?.type === 'vm' ? selectedTarget.machineIndex : -1;
	$: selectedVmIndex = selectedTarget?.type === 'vm' ? selectedTarget.vmIndex : -1;
	$: addModalIconKey =
		addModalKind === 'machine'
			? (newMachineDraft.iconKey ?? '')
			: addModalKind === 'device'
				? (newDeviceDraft.iconKey ?? '')
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
		return (
			networkData.machines[machineIndex]?.software.vms.findIndex((vm) =>
				equalsIgnoreCase(vm.name, vmName)
			) ?? -1
		);
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

	// Nodes are invisible hit targets (interaction, layout, edge anchoring);
	// the visible cards live in NodeCardLayer. Only edges are canvas-drawn,
	// styled from the same CSS tokens as the chrome.
	function createGraphStyles(tokens: CanvasTokens): cytoscape.StylesheetStyle[] {
		const monoStack = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
		const portLabelStyle = {
			'source-label': 'data(sourcePort)',
			'target-label': 'data(targetPort)'
		} as const;

		return [
			{
				selector: 'node',
				style: {
					shape: 'round-rectangle',
					width: 'data(nodeWidth)',
					height: 'data(nodeHeight)',
					'background-opacity': 0,
					'border-width': 0,
					label: ''
				}
			},
			{
				selector: 'edge',
				style: {
					width: 2,
					'curve-style': 'bezier',
					'line-color': tokens.edge,
					'target-arrow-shape': 'none'
				}
			},
			{
				selector: 'edge[kind = "physical"]',
				style: {
					label: '',
					'source-label': '',
					'target-label': '',
					'source-text-offset': 28,
					'target-text-offset': 28,
					'source-text-margin-y': -9,
					'target-text-margin-y': 9,
					'font-family': monoStack,
					'font-size': 9,
					'text-rotation': 'autorotate',
					color: tokens.chipText,
					'text-background-color': tokens.chipBg,
					'text-background-opacity': 1,
					'text-background-shape': 'roundrectangle',
					'text-background-padding': '3px',
					'text-border-width': 1,
					'text-border-color': tokens.border,
					'text-border-opacity': 1
				}
			},
			{
				selector: 'edge[kind = "hosting"]',
				style: {
					'line-style': 'dashed',
					'line-dash-pattern': [7, 5],
					'line-color': tokens.edge,
					opacity: 0.7
				}
			},
			{
				selector: 'edge[cableColor]',
				style: {
					'line-color': 'data(cableColor)'
				}
			},
			{
				// Port numbers fade in on hover/selection only.
				selector: 'edge.show-ports',
				style: { ...portLabelStyle }
			},
			{
				selector: 'edge:selected',
				style: {
					...portLabelStyle,
					width: 3,
					'line-color': tokens.accent
				}
			},
			{
				selector: 'edge.dimmed',
				style: {
					opacity: 0.1
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
				const rankNodes = (buckets[bucketKey] ?? []).sort(
					(a, b) => a.position().x - b.position().x
				);
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
		const chipField = showCableSpeeds ? 'chipLabel' : 'chipLabelNoSpeed';
		const physicalEdges = cy.edges('[kind = "physical"]').toArray();
		cy.batch(() => {
			for (const edge of physicalEdges) {
				edge.style('label', visible ? String(edge.data(chipField) ?? '') : '');
			}
		});
	}

	function handleViewChange(nextValue: string) {
		diagramViewMode = nextValue === 'device' || nextValue === 'rack' ? nextValue : 'network';
		if (diagramViewMode !== 'rack') {
			refreshGraph();
		}
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
		// The card layer shows the VM count in the meta line, so collapsed
		// hosts no longer need a label suffix — collapse only filters nodes.
		const nodes = transformed.nodes.filter((node) => {
			if (node.data.kind !== 'vm') {
				return true;
			}
			const hostId = node.data.hostMachineId;
			if (!hostId) {
				return true;
			}
			return !isHostCollapsed(hostId);
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
		lastTransformResult = transformed;
		machineVmIndex = transformed.machineVmIndex;
		syncCollapsedHosts(machineVmIndex);
		const visible = buildVisibleElements(transformed);
		visibleGraphNodes = visible.nodes;
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
		applyEmphasis();
		tooltip.visible = false;
	}

	function applyEmphasis() {
		if (!cy) {
			return;
		}

		const hasQuery = Boolean(searchQuery.trim());
		const hasVlanFilter = activeVlanFilter !== null;
		activeSearchNodeId = null;
		searchActiveIndex = -1;
		if (!hasQuery && !hasVlanFilter) {
			cy.batch(() => {
				cy?.edges().removeClass('dimmed');
			});
			dimmedNodeIds = new Set();
			matchedNodeIds = new Set();
			searchMatchIds = [];
			searchMatchCount = 0;
			return;
		}

		const searchMatches =
			hasQuery && lastTransformResult
				? computeSearchMatches(lastTransformResult, searchQuery)
				: null;
		const passing = new Set<string>();
		const dimmed = new Set<string>();
		const matched = new Set<string>();
		let matchCount = 0;
		cy.batch(() => {
			for (const node of cy?.nodes().toArray() ?? []) {
				const matchesSearch = !searchMatches || searchMatches.has(node.id());
				const matchesVlan = !hasVlanFilter || node.data('vlanId') === activeVlanFilter;
				const passes = matchesSearch && matchesVlan;
				if (passes) {
					passing.add(node.id());
					matchCount += 1;
					if (searchMatches) {
						matched.add(node.id());
					}
				} else {
					dimmed.add(node.id());
				}
			}
			for (const edge of cy?.edges().toArray() ?? []) {
				const touchesPassing =
					passing.has(String(edge.data('source'))) || passing.has(String(edge.data('target')));
				edge.toggleClass('dimmed', !touchesPassing);
			}
		});
		dimmedNodeIds = dimmed;
		matchedNodeIds = matched;
		searchMatchCount = matchCount;
		// Ordered list for Enter-cycling, restricted to nodes actually present
		// (VMs of collapsed hosts are represented by their host).
		searchMatchIds =
			hasQuery && lastTransformResult
				? computeSearchMatchList(lastTransformResult, searchQuery).filter(
						(id) => cy?.getElementById(id).nonempty() && !dimmed.has(id)
					)
				: [];
	}

	function clearSearch() {
		searchQuery = '';
		applyEmphasis();
	}

	function toggleVlanFilter(vlanId: number) {
		activeVlanFilter = activeVlanFilter === vlanId ? null : vlanId;
		applyEmphasis();
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
		firstRunDismissed = true;
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
		iconPopoverOpen = false;

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
		iconPopoverOpen = false;
		if (addModalKind === 'machine') {
			newMachineDraft.iconKey = normalized || undefined;
			return;
		}
		if (addModalKind === 'device') {
			newDeviceDraft.iconKey = normalized || undefined;
		}
	}

	function setVmIconKey(machineIndex: number, vmIndex: number, nextKey: string) {
		const normalized = nextKey.trim();
		vmIconPopoverIndex = null;
		mutateDraft(
			(draft) => {
				draft.machines[machineIndex].software.vms[vmIndex].iconKey = normalized || undefined;
			},
			{ autosave: true }
		);
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

	function hasOwnerNameCollision(
		nextName: string,
		ignore?: { type: 'machine' | 'device'; index: number }
	) {
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
		const nextIndex = renamed.machines.findIndex((machine) =>
			equalsIgnoreCase(machine.machineName, nextName)
		);
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
		const nextIndex = renamed.devices.findIndex((device) =>
			equalsIgnoreCase(device.name, nextName)
		);
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
		applyDraft(
			renamePort(networkData, 'machine', machine.machineName, previous, nextPortName.trim())
		);
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

	function updateMachinePortConnection(
		machineIndex: number,
		portIndex: number,
		target: Port['connectedTo']
	) {
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
		applyDraft(
			setPortConnection(networkData, 'machine', machine.machineName, portName, normalizedTarget)
		);
	}

	function updateDevicePortConnection(
		deviceIndex: number,
		portIndex: number,
		target: Port['connectedTo']
	) {
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

	function updateRackField(
		kind: OwnerKind,
		index: number,
		field: 'name' | 'unit' | 'heightU',
		value: string
	) {
		mutateDraft(
			(draft) => {
				const entity = kind === 'machine' ? draft.machines[index] : draft.devices[index];
				if (!entity) {
					return;
				}
				if (field === 'name') {
					const name = value.trim();
					if (!name) {
						delete entity.rack;
						return;
					}
					entity.rack = {
						name,
						unit: entity.rack?.unit ?? 1,
						...(entity.rack?.heightU ? { heightU: entity.rack.heightU } : {})
					};
					return;
				}
				if (!entity.rack) {
					return;
				}
				const parsed = Number(value);
				if (field === 'unit') {
					entity.rack.unit = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
				} else if (Number.isInteger(parsed) && parsed >= 1) {
					entity.rack.heightU = parsed;
				} else {
					delete entity.rack.heightU;
				}
			},
			{ autosave: true }
		);
	}

	function updatePortCableField(
		kind: OwnerKind,
		ownerName: string,
		port: Port,
		field: 'type' | 'color' | 'lengthM',
		value: string
	) {
		const current: NonNullable<NonNullable<Port['connectedTo']>['cable']> = {
			...(port.connectedTo?.cable ?? {})
		};
		if (field === 'lengthM') {
			const parsed = Number(value);
			if (value.trim() && Number.isFinite(parsed) && parsed >= 0) {
				current.lengthM = parsed;
			} else {
				delete current.lengthM;
			}
		} else if (value.trim()) {
			current[field] = value.trim();
		} else {
			delete current[field];
		}
		applyDraft(setPortCable(networkData, kind, ownerName, port.portName, current));
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
		const existingNames = [
			...networkData.machines.map((item) => item.machineName),
			...networkData.devices.map((item) => item.name)
		];
		newMachineDraft = {
			...createEmptyMachine(),
			machineName: nextUniqueName('New Machine', existingNames)
		};
		newMachineDraft.ipAddress = suggestNextFreeIp(networkData) ?? newMachineDraft.ipAddress;
		addModalKind = 'machine';
	}

	function addDevice() {
		const existingNames = [
			...networkData.machines.map((item) => item.machineName),
			...networkData.devices.map((item) => item.name)
		];
		newDeviceDraft = {
			...createEmptyDevice(),
			name: nextUniqueName('New Device', existingNames)
		};
		newDeviceDraft.ipAddress = suggestNextFreeIp(networkData) ?? newDeviceDraft.ipAddress;
		addModalKind = 'device';
	}

	function suggestIpForAddModal() {
		const suggested = suggestNextFreeIp(networkData);
		if (!suggested) {
			return;
		}
		if (addModalKind === 'machine') {
			newMachineDraft.ipAddress = suggested;
		} else if (addModalKind === 'device') {
			newDeviceDraft.ipAddress = suggested;
		}
	}

	function addDeclaredSubnet() {
		const firstInferred = ipamReport.subnets.find((subnet) => !subnet.declared);
		const existing = new Set((networkData.subnets ?? []).map((subnet) => subnet.cidr));
		let cidr = firstInferred?.cidr ?? '192.168.1.0/24';
		if (existing.has(cidr)) {
			cidr = '192.168.1.0/24';
		}
		if (existing.has(cidr)) {
			return;
		}
		mutateDraft((draft) => {
			draft.subnets ??= [];
			draft.subnets.push({ cidr });
		});
	}

	function removeDeclaredSubnet(index: number) {
		mutateDraft((draft) => {
			draft.subnets?.splice(index, 1);
			if (draft.subnets && draft.subnets.length === 0) {
				delete draft.subnets;
			}
		});
	}

	function submitAddEntity() {
		if (addModalKind === 'machine') {
			mutateDraft((draft) => {
				draft.machines.push(
					cloneNetworkData({ machines: [newMachineDraft], devices: [] }).machines[0]
				);
			});
			selectedTarget = { type: 'machine', index: networkData.machines.length - 1 };
		}
		if (addModalKind === 'device') {
			mutateDraft((draft) => {
				draft.devices.push(
					cloneNetworkData({ machines: [], devices: [newDeviceDraft] }).devices[0]
				);
			});
			selectedTarget = { type: 'device', index: networkData.devices.length - 1 };
		}
		closeAddEntityModal();
	}

	function handleEthernetLabelsChange(nextValue: boolean) {
		showEthernetLabels = nextValue;
		if (diagramViewMode === 'network') {
			applyEthernetLabelVisibility(showEthernetLabels);
		}
	}

	function handleCableSpeedsChange(nextValue: boolean) {
		showCableSpeeds = nextValue;
		if (diagramViewMode === 'network') {
			applyEthernetLabelVisibility(showEthernetLabels);
		}
	}

	// Enter/Shift-Enter cycles through matches, panning the camera to each.
	function cycleSearchMatch(direction: 1 | -1) {
		if (!cy || searchMatchIds.length === 0) {
			return;
		}
		searchActiveIndex =
			(searchActiveIndex + direction + searchMatchIds.length) % searchMatchIds.length;
		const nodeId = searchMatchIds[searchActiveIndex];
		const node = cy.getElementById(nodeId);
		if (node.empty()) {
			return;
		}
		activeSearchNodeId = nodeId;
		cy.stop();
		cy.animate(
			{ center: { eles: node }, zoom: Math.max(cy.zoom(), 0.8) },
			{ duration: 250, easing: 'ease-in-out-quad' }
		);
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
			return;
		}
		const target = event.target as HTMLElement | null;
		const tag = target?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
			return;
		}
		if (
			selectedTarget !== null ||
			addModalKind !== null ||
			showExportModal ||
			deleteTarget !== null
		) {
			return;
		}
		event.preventDefault();
		appBar?.focusSearch();
	}

	function closeSelectedTargetModal() {
		selectedTarget = null;
		rackNewNameTarget = null;
		iconPopoverOpen = false;
		vmIconPopoverIndex = null;
		expandedVmIndex = null;
		expandedPortIndex = null;
	}

	function closeAddEntityModal() {
		addModalKind = null;
		iconPopoverOpen = false;
	}

	function toggleExpandedVm(index: number) {
		expandedVmIndex = expandedVmIndex === index ? null : index;
		vmIconPopoverIndex = null;
	}

	function toggleExpandedPort(index: number) {
		expandedPortIndex = expandedPortIndex === index ? null : index;
	}

	function rowKeydown(event: KeyboardEvent, toggle: () => void) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			toggle();
		}
	}

	function formatSpeed(speedGbps: number | undefined): string {
		return typeof speedGbps === 'number' ? `${speedGbps} GbE` : '—';
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
			console.warn(
				'[OpenNetworkDiagram] API load unavailable, falling back to static JSON',
				apiError
			);
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

	function nextFrame(): Promise<void> {
		return new Promise((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}

	// cy.png() can't see the HTML card layer, so exports rasterise the graph
	// viewport (canvas edges + cards) with html-to-image instead. The graph is
	// fitted to the viewport for the shot and the camera restored afterwards.
	async function exportPng() {
		if (!cy || !graphViewport || isExportingPng) {
			return;
		}
		isExportingPng = true;

		const previousPan = { ...cy.pan() };
		const previousZoom = cy.zoom();
		try {
			cy.fit(undefined, 32);
			// Two frames: one for the card layer's rAF sync, one for Svelte to
			// paint the updated card transforms.
			await nextFrame();
			await nextFrame();
			await Promise.all(
				Array.from(graphViewport.querySelectorAll('img'), (image) =>
					image.decode().catch(() => undefined)
				)
			);

			const dataUrl = await toPng(graphViewport, {
				pixelRatio: exportScale,
				...(exportBackground === 'transparent'
					? {}
					: { backgroundColor: readCanvasTokens().bgCanvas })
			});
			const anchor = document.createElement('a');
			anchor.href = dataUrl;
			anchor.download = `${exportFileName || 'network-diagram'}.png`;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			showExportModal = false;
		} catch (error) {
			saveError = `PNG export failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			cy.viewport({ zoom: previousZoom, pan: previousPan });
			isExportingPng = false;
		}
	}

	onMount(() => {
		let resizeHandler: (() => void) | null = null;
		let resizeTimeoutId: ReturnType<typeof setTimeout> | null = null;

		if (!cytoscape('layout', 'dagre')) {
			// cytoscape-dagre's types still reference @types/cytoscape, which
			// clashes with cytoscape's own bundled types since 3.33.
			cytoscape.use(dagre as unknown as cytoscape.Ext);
		}

		themeMode.initialize();
		unsubscribeTheme = themeMode.subscribe((theme) => {
			currentTheme = theme;
			if (cy) {
				// data-theme is already applied to <html> by the store, so the
				// tokens read here are the new theme's values — canvas and
				// chrome can't drift. Cards restyle themselves via CSS.
				cy.style(createGraphStyles(readCanvasTokens()));
				if (diagramViewMode === 'network') {
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
			style: createGraphStyles(readCanvasTokens())
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

		cy.on('mouseover', 'edge[kind = "physical"]', (event) => {
			const edge = event.target;
			edge.addClass('show-ports');
			const data = edge.data() as GraphEdgeData;
			const parts = [
				`${data.sourcePort ?? '?'} ↔ ${data.targetPort ?? '?'}`,
				...(data.speedGbps ? [`${data.speedGbps}GbE`] : []),
				...(data.cableType ? [data.cableType] : []),
				...(data.cableColorName ? [data.cableColorName] : []),
				...(typeof data.cableLengthM === 'number' ? [`${data.cableLengthM}m`] : [])
			];
			const midpoint = edge.renderedMidpoint();
			const clampedPosition = clampTooltipPosition(
				midpoint.x + tooltipOffset.x,
				midpoint.y + tooltipOffset.y
			);
			tooltip = {
				visible: true,
				text: parts.join(' · '),
				x: clampedPosition.x,
				y: clampedPosition.y
			};
		});

		cy.on('mouseout', 'edge', (event) => {
			event.target.removeClass('show-ports');
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

<svelte:window on:keydown={onWindowKeydown} />

<div class="diagram-shell">
	<AppBar
		bind:this={appBar}
		bind:searchQuery
		{dataSourceLabel}
		{saveState}
		{writable}
		{hasLoadedInitialData}
		{readOnlyNotice}
		{saveError}
		{isLoadingData}
		viewMode={diagramViewMode}
		searchCountLabel={searchActiveIndex >= 0
			? `${searchActiveIndex + 1} of ${searchMatchIds.length}`
			: String(searchMatchCount)}
		{showEthernetLabels}
		{showCableSpeeds}
		showVms={!areAllVmHostsCollapsed}
		{hasAnyVmHosts}
		ipamOpen={showIpamPanel}
		theme={currentTheme}
		on:viewchange={(event) => handleViewChange(event.detail)}
		on:search={applyEmphasis}
		on:searchcycle={(event) => cycleSearchMatch(event.detail.direction)}
		on:clearsearch={clearSearch}
		on:addmachine={addMachine}
		on:adddevice={addDevice}
		on:toggleipam={() => (showIpamPanel = !showIpamPanel)}
		on:ethernetlabels={(event) => handleEthernetLabelsChange(event.detail)}
		on:cablespeeds={(event) => handleCableSpeedsChange(event.detail)}
		on:showvms={(event) => setCollapsedStateForAll(!event.detail)}
		on:exportpng={() => (showExportModal = true)}
		on:reload={loadData}
		on:toggletheme={() => themeMode.toggle()}
	/>
	<div class="diagram-stage" bind:this={diagramStage}>
		<div class="graph-viewport" bind:this={graphViewport}>
			<div class="diagram-canvas" bind:this={container}></div>
			<NodeCardLayer
				{cy}
				nodes={diagramViewMode === 'rack' ? [] : visibleGraphNodes}
				dimmedIds={dimmedNodeIds}
				matchedIds={matchedNodeIds}
				activeId={activeSearchNodeId}
			/>
		</div>

		{#if diagramViewMode === 'rack'}
			<RackView
				layout={rackLayout}
				on:select={(event) => {
					const { kind, name } = event.detail;
					const index =
						kind === 'machine' ? findMachineIndexByName(name) : findDeviceIndexByName(name);
					if (index >= 0) {
						selectedTarget = { type: kind, index };
					}
				}}
			/>
		{/if}

		{#if diagramViewMode === 'rack' && writable}
			<div class="racks-manager">
				<button
					type="button"
					class="ipam-disclosure racks-manager-toggle"
					aria-expanded={showRackManager}
					on:click={() => (showRackManager = !showRackManager)}
				>
					<span class="disclosure-chevron" class:open={showRackManager} aria-hidden="true">›</span>
					Manage racks
				</button>
				{#if showRackManager}
					{#each rackLayout.racks as rack (rack.name)}
						<div class="racks-manager-row">
							<label>
								Name
								<input
									type="text"
									value={rack.name}
									on:change={(event) =>
										renameRackDefinition(
											rack.name,
											(event.currentTarget as HTMLInputElement).value
										)}
								/>
							</label>
							<label>
								Units
								<input
									type="number"
									min="1"
									placeholder={String(rack.heightU)}
									value={rack.declaredHeightU ?? ''}
									on:change={(event) =>
										setRackHeightU(rack.name, (event.currentTarget as HTMLInputElement).value)}
								/>
							</label>
							{#if rack.declared && rack.slots.length === 0}
								<button
									type="button"
									class="btn-danger-quiet subnet-remove"
									title="Remove this empty rack"
									on:click={() => removeRackDefinition(rack.name)}
								>
									Remove
								</button>
							{/if}
						</div>
					{/each}
					<div class="inline-actions">
						<button type="button" class="btn-small" on:click={addRackDefinition}>Add rack</button>
					</div>
				{/if}
			</div>
		{/if}

		{#if diagramViewMode !== 'rack' && (vlanLegend.length > 0 || visibleGraphNodes.length > 0)}
			<div class="map-legend" role="group" aria-label="Map legend">
				{#if vlanLegend.length > 0}
					<div class="legend-title">VLANs · click to filter</div>
					{#each vlanLegend as entry (entry.vlanId)}
						<button
							type="button"
							class="legend-row"
							class:selected={activeVlanFilter === entry.vlanId}
							class:filtered-out={activeVlanFilter !== null && activeVlanFilter !== entry.vlanId}
							title={`Show only VLAN ${entry.vlanId}`}
							on:click={() => toggleVlanFilter(entry.vlanId)}
						>
							<span class="vlan-swatch" style={`background: ${entry.color};`}></span>
							<span class="legend-name">{entry.name}</span>
							<span class="legend-cidr">{entry.cidr}</span>
							<span class="legend-count">{entry.count}</span>
						</button>
					{/each}
					<div class="legend-rule"></div>
				{/if}
				<div class="shape-key">
					<span class="shape-item"><span class="shape-swatch host"></span>Host</span>
					<span class="shape-item"><span class="shape-swatch infra"></span>Infra</span>
					<span class="shape-item"><span class="shape-swatch device"></span>Device</span>
				</div>
			</div>
		{/if}

		{#if showIpamPanel}
			<div class="ipam-panel">
				<div class="ipam-panel-head">
					<h3>IPAM</h3>
					<button
						type="button"
						class="ipam-close"
						aria-label="Close IPAM panel"
						on:click={() => (showIpamPanel = false)}
					>
						×
					</button>
				</div>

				<section class="ipam-section">
					{#each ipamView as subnet (subnet.cidr)}
						<div class="ipam-subnet">
							<div class="ipam-subnet-head">
								{#if subnet.name}<span class="ipam-subnet-name">{subnet.name}</span>{/if}
								<code class="ipam-cidr">{subnet.cidr}</code>
								{#if subnet.vlanId}<span class="ipam-badge">VLAN {subnet.vlanId}</span>{/if}
								{#if !subnet.declared}<span class="ipam-badge inferred">inferred</span>{/if}
							</div>
							<div class="ipam-bar" role="presentation">
								<div
									class="ipam-bar-fill"
									class:hot={subnet.utilisation > 90}
									style={`width: ${subnet.utilisation}%;`}
								></div>
							</div>
							<div class="ipam-subnet-meta">
								<span>{subnet.used} of {subnet.capacity} in use</span>
								{#if subnet.nextFree}
									<button
										type="button"
										class="ipam-copy-ip"
										title="Copy next free IP"
										on:click={() => copyNextFreeIp(subnet.nextFree ?? '')}
									>
										{copiedIp === subnet.nextFree ? 'Copied ✓' : `next free ${subnet.nextFree}`}
									</button>
								{/if}
							</div>
						</div>
					{:else}
						<p class="ipam-empty">No IPv4 addresses found yet.</p>
					{/each}
				</section>

				{#if ipamReport.duplicates.length > 0}
					<section class="ipam-section">
						<h4>Conflicts</h4>
						<ul class="ipam-conflicts">
							{#each ipamReport.duplicates as duplicate (duplicate.ip)}
								<li><code>{duplicate.ip}</code> — {duplicate.owners.join(', ')}</li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if ipamReport.unparsed.length > 0}
					<section class="ipam-section">
						<h4>Not an IPv4 address</h4>
						<ul class="ipam-unparsed">
							{#each ipamReport.unparsed as assignment (`${assignment.ownerLabel}:${assignment.ip}`)}
								<li>{assignment.ownerLabel}: <code>{assignment.ip}</code></li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if writable}
					<section class="ipam-section ipam-manage">
						<button
							type="button"
							class="ipam-disclosure"
							aria-expanded={subnetEditorOpen}
							on:click={() => {
								subnetEditorOpen = !subnetEditorOpen;
								pendingSubnetRemoval = null;
							}}
						>
							<span class="disclosure-chevron" class:open={subnetEditorOpen} aria-hidden="true"
								>›</span
							>
							Edit subnets
						</button>
						{#if subnetEditorOpen}
							{#each networkData.subnets ?? [] as subnet, subnetIndex (`${subnet.cidr}:${subnetIndex}`)}
								<div class="ipam-subnet-editor">
									<label>
										CIDR
										<input
											type="text"
											value={subnet.cidr}
											on:change={(event) =>
												mutateDraft(
													(draft) => {
														if (draft.subnets?.[subnetIndex]) {
															draft.subnets[subnetIndex].cidr = (
																event.currentTarget as HTMLInputElement
															).value;
														}
													},
													{ autosave: true }
												)}
										/>
									</label>
									<label>
										Name
										<input
											type="text"
											value={subnet.name ?? ''}
											on:change={(event) =>
												mutateDraft(
													(draft) => {
														const nextName = (event.currentTarget as HTMLInputElement).value.trim();
														if (draft.subnets?.[subnetIndex]) {
															if (nextName) {
																draft.subnets[subnetIndex].name = nextName;
															} else {
																delete draft.subnets[subnetIndex].name;
															}
														}
													},
													{ autosave: true }
												)}
										/>
									</label>
									<label>
										VLAN
										<input
											type="number"
											min="1"
											max="4094"
											value={subnet.vlanId ?? ''}
											on:change={(event) =>
												mutateDraft(
													(draft) => {
														const parsed = Number((event.currentTarget as HTMLInputElement).value);
														if (draft.subnets?.[subnetIndex]) {
															if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 4094) {
																draft.subnets[subnetIndex].vlanId = parsed;
															} else {
																delete draft.subnets[subnetIndex].vlanId;
															}
														}
													},
													{ autosave: true }
												)}
										/>
									</label>
									<button
										type="button"
										class="btn-danger-quiet subnet-remove"
										class:confirming={pendingSubnetRemoval === subnetIndex}
										aria-label={`Remove subnet ${subnet.cidr}`}
										on:click={() => requestSubnetRemoval(subnetIndex)}
									>
										{pendingSubnetRemoval === subnetIndex ? 'Confirm?' : 'Remove'}
									</button>
								</div>
							{:else}
								<p class="ipam-empty">
									None declared; subnets above are inferred as /24 from the IPs in use.
								</p>
							{/each}
							<div class="inline-actions">
								<button type="button" class="btn-small" on:click={addDeclaredSubnet}>
									Declare subnet
								</button>
							</div>
						{/if}
					</section>
				{/if}
			</div>
		{/if}

		{#if showFirstRun && diagramViewMode !== 'rack'}
			<FirstRunCard
				isSampleData={allExampleNames}
				{writable}
				hasMachines={networkData.machines.length > 0}
				on:addmachine={addMachine}
				on:connectport={openFirstMachineEditor}
				on:openipam={() => (showIpamPanel = true)}
				on:dismiss={dismissFirstRun}
			/>
		{/if}

		{#if loadError || saveError}
			<div class="stage-toasts">
				{#if loadError}
					<div class="stage-toast">{loadError}</div>
				{/if}
				{#if saveError}
					<div class="stage-toast">{saveError}</div>
				{/if}
			</div>
		{/if}

		{#if tooltip.visible}
			<div
				class="tooltip"
				bind:this={tooltipElement}
				style={`left: ${tooltip.x}px; top: ${tooltip.y}px;`}
			>
				{tooltip.text}
			</div>
		{/if}
	</div>

	{#if warnings.length + ipamWarnings.length + rackLayout.warnings.length > 0}
		<details class="warnings-panel">
			<summary
				>Data warnings ({warnings.length +
					ipamWarnings.length +
					rackLayout.warnings.length})</summary
			>
			<ul>
				{#each [...warnings, ...ipamWarnings, ...rackLayout.warnings] as warning (warning)}
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

<datalist id="cable-type-options">
	<option value="Cat5e"></option>
	<option value="Cat6"></option>
	<option value="Cat6a"></option>
	<option value="Cat7"></option>
	<option value="Cat8"></option>
	<option value="DAC"></option>
	<option value="Fibre"></option>
</datalist>
<datalist id="cable-color-options">
	<option value="blue"></option>
	<option value="red"></option>
	<option value="green"></option>
	<option value="yellow"></option>
	<option value="orange"></option>
	<option value="purple"></option>
	<option value="pink"></option>
	<option value="white"></option>
	<option value="grey"></option>
	<option value="black"></option>
</datalist>
<datalist id="machine-connectable-owner-options">
	{#each machineConnectableOwnerNames as ownerName (ownerName)}
		<option value={ownerName}></option>
	{/each}
</datalist>
<datalist id="device-connectable-owner-options">
	{#each deviceConnectableOwnerNames as ownerName (ownerName)}
		<option value={ownerName}></option>
	{/each}
</datalist>

<Modal isOpen={selectedTarget !== null} maxWidth="680px" on:close={closeSelectedTargetModal}>
	<svelte:fragment slot="header">
		<div class="entity-header">
			<div class="icon-anchor">
				<button
					type="button"
					class="icon-btn"
					title="Change icon"
					aria-label="Change icon"
					on:click={() => (iconPopoverOpen = !iconPopoverOpen)}
				>
					{#if selectedTargetIconPath}
						<img src={selectedTargetIconPath} alt="" loading="lazy" />
					{:else}
						<span aria-hidden="true">⬢</span>
					{/if}
				</button>
				{#if iconPopoverOpen}
					<IconPickerPopover
						currentIconKey={selectedTargetIconKey || undefined}
						on:select={(event) => setSelectedTargetIconKey(event.detail)}
						on:close={() => (iconPopoverOpen = false)}
					/>
				{/if}
			</div>
			<div class="entity-id">
				{#if selectedMachine}
					<div class="entity-name-row">
						<span class="entity-name">{selectedMachine.machineName}</span>
						{#if selectedMachine.role}<span class="chip-role">{selectedMachine.role}</span>{/if}
					</div>
					<span class="entity-meta">
						{selectedMachine.ipAddress}{selectedMachine.operatingSystem
							? ` · ${selectedMachine.operatingSystem}`
							: ''}{selectedMachine.rack
							? ` · ${selectedMachine.rack.name} U${selectedMachine.rack.unit}`
							: ''}
					</span>
				{:else if selectedDevice}
					<div class="entity-name-row">
						<span class="entity-name">{selectedDevice.name}</span>
						{#if selectedDevice.type}<span class="chip-role">{selectedDevice.type}</span>{/if}
					</div>
					<span class="entity-meta">
						{selectedDevice.ipAddress}{selectedDevice.rack
							? ` · ${selectedDevice.rack.name} U${selectedDevice.rack.unit}`
							: ''}
					</span>
				{:else if selectedVm}
					<div class="entity-name-row">
						<span class="entity-name">{selectedVm.name}</span>
						{#if selectedVm.role}<span class="chip-role">{selectedVm.role}</span>{/if}
					</div>
					<span class="entity-meta">
						{selectedVm.ipAddress} · VM on {networkData.machines[selectedVmMachineIndex]
							?.machineName ?? '?'}
					</span>
				{/if}
			</div>
		</div>
	</svelte:fragment>

	{#if selectedTarget?.type === 'machine' && selectedMachine}
		<div class="modal-sections">
			<div class="field-grid cols-3">
				<label>
					Name
					<input
						type="text"
						value={selectedMachine.machineName}
						on:change={(event) =>
							updateMachineName(
								selectedMachineIndex,
								(event.currentTarget as HTMLInputElement).value
							)}
					/>
				</label>
				<label>
					IP address
					<input
						type="text"
						class="mono"
						value={selectedMachine.ipAddress}
						on:input={(event) =>
							mutateDraft(
								(draft) => {
									draft.machines[selectedMachineIndex].ipAddress = (
										event.currentTarget as HTMLInputElement
									).value;
								},
								{ autosave: true }
							)}
					/>
					{#if selectedMachineIpConflicts.length > 0}
						<span class="ip-conflict-hint"
							>Also used by {selectedMachineIpConflicts.join(', ')}</span
						>
					{/if}
				</label>
				<label>
					Role
					<input
						type="text"
						value={selectedMachine.role}
						on:input={(event) =>
							mutateDraft(
								(draft) => {
									draft.machines[selectedMachineIndex].role = (
										event.currentTarget as HTMLInputElement
									).value;
								},
								{ autosave: true }
							)}
					/>
				</label>
			</div>
			<div class="field-grid cols-1-2">
				<label>
					Operating system
					<input
						type="text"
						value={selectedMachine.operatingSystem}
						on:input={(event) =>
							mutateDraft(
								(draft) => {
									draft.machines[selectedMachineIndex].operatingSystem = (
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
						rows="1"
						value={selectedMachine.notes ?? ''}
						on:input={(event) =>
							mutateDraft(
								(draft) => {
									draft.machines[selectedMachineIndex].notes = (
										event.currentTarget as HTMLTextAreaElement
									).value;
								},
								{ autosave: true }
							)}></textarea>
				</label>
			</div>

			<section class="modal-section">
				<div class="section-head">
					<span class="section-title">Hardware &amp; rack</span>
					<span class="rule"></span>
				</div>
				<div class="field-grid cols-3">
					<label>
						CPU
						<input
							type="text"
							value={selectedMachine.hardware.cpu}
							on:input={(event) =>
								mutateDraft(
									(draft) => {
										draft.machines[selectedMachineIndex].hardware.cpu = (
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
										draft.machines[selectedMachineIndex].hardware.ram = (
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
										draft.machines[selectedMachineIndex].hardware.networkPorts = Number.isFinite(
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
				<div class="field-grid cols-3">
					<label>
						Rack
						<select
							value={rackNewNameTarget?.kind === 'machine' &&
							rackNewNameTarget?.index === selectedMachineIndex
								? '__new__'
								: (selectedMachine.rack?.name ?? '')}
							on:change={(event) =>
								onRackSelectChange(
									'machine',
									selectedMachineIndex,
									(event.currentTarget as HTMLSelectElement).value
								)}
						>
							<option value="">Not racked</option>
							{#each rackNames as rackName (rackName)}
								<option value={rackName}>{rackName}</option>
							{/each}
							<option value="__new__">New rack…</option>
						</select>
					</label>
					{#if rackNewNameTarget?.kind === 'machine' && rackNewNameTarget?.index === selectedMachineIndex}
						<label>
							New rack name
							<input
								type="text"
								placeholder="e.g. Lab Rack"
								on:change={(event) =>
									submitNewRackName((event.currentTarget as HTMLInputElement).value)}
							/>
						</label>
					{/if}
					<label>
						Bottom U
						<input
							type="number"
							min="1"
							disabled={!selectedMachine.rack}
							value={selectedMachine.rack?.unit ?? ''}
							on:change={(event) =>
								updateRackField(
									'machine',
									selectedMachineIndex,
									'unit',
									(event.currentTarget as HTMLInputElement).value
								)}
						/>
					</label>
					<label>
						Height (U)
						<input
							type="number"
							min="1"
							placeholder="1"
							disabled={!selectedMachine.rack}
							value={selectedMachine.rack?.heightU ?? ''}
							on:change={(event) =>
								updateRackField(
									'machine',
									selectedMachineIndex,
									'heightU',
									(event.currentTarget as HTMLInputElement).value
								)}
						/>
					</label>
				</div>
			</section>

			<section class="modal-section">
				<div class="section-head">
					<span class="section-title">Virtual machines</span>
					<span class="count-chip">{selectedMachine.software.vms.length}</span>
					<span class="rule"></span>
					{#if selectedMachineHostId && selectedMachineVmCount > 0}
						<label class="mini-toggle" title="Show this machine's VMs on the diagram">
							<span>Show on diagram</span>
							<input
								class="toggle-input"
								type="checkbox"
								checked={!isHostCollapsed(selectedMachineHostId)}
								on:change={toggleSelectedMachineVmVisibility}
							/>
							<span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span
							>
						</label>
					{/if}
					<button
						type="button"
						class="btn-small"
						on:click={() =>
							mutateDraft((draft) => {
								draft.machines[selectedMachineIndex].software.vms.push({
									...createEmptyVm(),
									name: nextUniqueName(
										'New VM',
										draft.machines[selectedMachineIndex].software.vms.map((vm) => vm.name)
									),
									ipAddress: suggestNextFreeIp(draft) ?? createEmptyVm().ipAddress
								});
							})}
					>
						+ Add VM
					</button>
				</div>
				{#if selectedMachine.software.vms.length > 0}
					<div class="data-table">
						<div class="table-head vm-grid">
							<span></span><span>Name</span><span>Role</span><span>IP</span><span>MAC</span><span
							></span>
						</div>
						{#each selectedMachine.software.vms as vm, vmIndex (vmIndex)}
							<div
								class="table-row vm-grid"
								class:expanded={expandedVmIndex === vmIndex}
								role="button"
								tabindex="0"
								title="Click to edit"
								on:click={() => toggleExpandedVm(vmIndex)}
								on:keydown={(event) => rowKeydown(event, () => toggleExpandedVm(vmIndex))}
							>
								<span class="row-icon">
									{#if resolveIconPath(vm.iconKey)}
										<img src={resolveIconPath(vm.iconKey)} alt="" loading="lazy" />
									{:else}
										<span aria-hidden="true">◫</span>
									{/if}
								</span>
								<span class="row-name">{vm.name}</span>
								<span class="row-muted">{vm.role}</span>
								<span class="mono">{vm.ipAddress}</span>
								<span class="mono row-muted">{vm.macAddress || '—'}</span>
								<button
									type="button"
									class="row-trash"
									title="Delete VM"
									aria-label={`Delete VM ${vm.name}`}
									on:click|stopPropagation={() =>
										openDeleteConfirmation({
											type: 'vm',
											machineIndex: selectedMachineIndex,
											vmIndex
										})}
								>
									🗑
								</button>
							</div>
							{#if expandedVmIndex === vmIndex}
								<div class="row-expand">
									<div class="field-grid cols-4">
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
												class="mono"
												bind:value={vm.ipAddress}
												on:input={() => mutateDraft(() => undefined, { autosave: true })}
											/>
										</label>
										<label>
											MAC address
											<input
												type="text"
												class="mono"
												placeholder="aa:bb:cc:dd:ee:ff"
												bind:value={vm.macAddress}
												on:input={() => mutateDraft(() => undefined, { autosave: true })}
											/>
										</label>
									</div>
									<div class="icon-anchor row-icon-picker">
										<button
											type="button"
											class="btn-small"
											on:click={() =>
												(vmIconPopoverIndex = vmIconPopoverIndex === vmIndex ? null : vmIndex)}
										>
											{vm.iconKey ? 'Change icon' : 'Choose icon…'}
										</button>
										{#if vmIconPopoverIndex === vmIndex}
											<IconPickerPopover
												currentIconKey={vm.iconKey || undefined}
												on:select={(event) =>
													setVmIconKey(selectedMachineIndex, vmIndex, event.detail)}
												on:close={() => (vmIconPopoverIndex = null)}
											/>
										{/if}
									</div>
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			</section>

			<section class="modal-section">
				<div class="section-head">
					<span class="section-title">Ports &amp; cables</span>
					<span class="count-chip">{(selectedMachine.ports ?? []).length}</span>
					<span class="rule"></span>
					<button
						type="button"
						class="btn-small"
						on:click={() =>
							mutateDraft((draft) => {
								draft.machines[selectedMachineIndex].ports ??= [];
								draft.machines[selectedMachineIndex].ports.push({
									...createEmptyPort('eth'),
									portName: nextUniqueName(
										'eth0',
										draft.machines[selectedMachineIndex].ports.map((port) => port.portName)
									)
								});
							})}
					>
						+ Add port
					</button>
				</div>
				{#if (selectedMachine.ports ?? []).length > 0}
					<div class="data-table">
						{#each selectedMachine.ports ?? [] as port, portIndex (portIndex)}
							<div
								class="table-row port-grid"
								class:expanded={expandedPortIndex === portIndex}
								role="button"
								tabindex="0"
								title="Click to edit"
								on:click={() => toggleExpandedPort(portIndex)}
								on:keydown={(event) => rowKeydown(event, () => toggleExpandedPort(portIndex))}
							>
								<span class="mono row-name">{port.portName}</span>
								<span class="row-muted">{formatSpeed(port.speedGbps)}</span>
								<span class="row-connection">
									{#if port.connectedTo}
										<span class="row-muted" aria-hidden="true">→</span>
										{port.connectedTo.device}
										<span class="mono row-muted">{port.connectedTo.port}</span>
									{:else}
										<span class="row-muted">Not connected · click to connect…</span>
									{/if}
								</span>
								<span class="row-cable">
									{#if port.connectedTo?.cable?.type || port.connectedTo?.cable?.color || typeof port.connectedTo?.cable?.lengthM === 'number'}
										{#if port.connectedTo.cable?.color}
											<span
												class="cable-swatch"
												style={`background: ${port.connectedTo.cable.color};`}
											></span>
										{/if}
										{[
											port.connectedTo.cable?.type,
											typeof port.connectedTo.cable?.lengthM === 'number'
												? `${port.connectedTo.cable.lengthM}m`
												: null
										]
											.filter(Boolean)
											.join(' · ') || '—'}
									{:else}
										<span class="row-muted">—</span>
									{/if}
								</span>
								<button
									type="button"
									class="row-trash"
									title="Delete port"
									aria-label={`Delete port ${port.portName}`}
									on:click|stopPropagation={() => {
										clearConnectionDraft('machine', selectedMachine.machineName, port.portName);
										applyDraft(
											deletePort(networkData, 'machine', selectedMachine.machineName, port.portName)
										);
									}}
								>
									🗑
								</button>
							</div>
							{#if expandedPortIndex === portIndex}
								<div class="row-expand">
									<div class="field-grid cols-3">
										<label>
											Port name
											<input
												type="text"
												class="mono"
												value={port.portName}
												on:change={(event) =>
													updateMachinePortName(
														selectedMachineIndex,
														portIndex,
														(event.currentTarget as HTMLInputElement).value
													)}
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
											MAC address
											<input
												type="text"
												class="mono"
												placeholder="aa:bb:cc:dd:ee:ff"
												bind:value={port.macAddress}
												on:input={() => mutateDraft(() => undefined, { autosave: true })}
											/>
										</label>
									</div>
									<div class="field-grid cols-2">
										<label>
											Connect to device
											<input
												type="text"
												list="machine-connectable-owner-options"
												value={resolveConnectionDraft('machine', selectedMachine.machineName, port)
													.device}
												on:change={(event) =>
													onMachinePortConnectionFieldChange(
														selectedMachineIndex,
														portIndex,
														'device',
														(event.currentTarget as HTMLInputElement).value
													)}
											/>
										</label>
										<label>
											Target port
											<input
												type="text"
												class="mono"
												value={resolveConnectionDraft('machine', selectedMachine.machineName, port)
													.port}
												on:change={(event) =>
													onMachinePortConnectionFieldChange(
														selectedMachineIndex,
														portIndex,
														'port',
														(event.currentTarget as HTMLInputElement).value
													)}
											/>
										</label>
									</div>
									{#if port.connectedTo}
										<div class="field-grid cols-3">
											<label>
												Cable type
												<input
													type="text"
													list="cable-type-options"
													value={port.connectedTo.cable?.type ?? ''}
													on:change={(event) =>
														updatePortCableField(
															'machine',
															selectedMachine.machineName,
															port,
															'type',
															(event.currentTarget as HTMLInputElement).value
														)}
												/>
											</label>
											<label>
												Cable colour
												<input
													type="text"
													list="cable-color-options"
													value={port.connectedTo.cable?.color ?? ''}
													on:change={(event) =>
														updatePortCableField(
															'machine',
															selectedMachine.machineName,
															port,
															'color',
															(event.currentTarget as HTMLInputElement).value
														)}
												/>
											</label>
											<label>
												Cable length (m)
												<input
													type="number"
													min="0"
													step="0.5"
													value={port.connectedTo.cable?.lengthM ?? ''}
													on:change={(event) =>
														updatePortCableField(
															'machine',
															selectedMachine.machineName,
															port,
															'lengthM',
															(event.currentTarget as HTMLInputElement).value
														)}
												/>
											</label>
										</div>
										<div class="row-expand-actions">
											<button
												type="button"
												class="btn-small"
												on:click={() => {
													clearConnectionDraft(
														'machine',
														selectedMachine.machineName,
														port.portName
													);
													updateMachinePortConnection(selectedMachineIndex, portIndex, undefined);
												}}
											>
												Disconnect
											</button>
										</div>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			</section>
		</div>
	{:else if selectedTarget?.type === 'device' && selectedDevice}
		<div class="modal-sections">
			<div class="field-grid cols-3">
				<label>
					Name
					<input
						type="text"
						value={selectedDevice.name}
						on:change={(event) =>
							updateDeviceName(
								selectedDeviceIndex,
								(event.currentTarget as HTMLInputElement).value
							)}
					/>
				</label>
				<label>
					IP address
					<input
						type="text"
						class="mono"
						value={selectedDevice.ipAddress}
						on:input={(event) =>
							mutateDraft(
								(draft) => {
									draft.devices[selectedDeviceIndex].ipAddress = (
										event.currentTarget as HTMLInputElement
									).value;
								},
								{ autosave: true }
							)}
					/>
					{#if selectedDeviceIpConflicts.length > 0}
						<span class="ip-conflict-hint">Also used by {selectedDeviceIpConflicts.join(', ')}</span
						>
					{/if}
				</label>
				<label>
					Type
					<input
						type="text"
						value={selectedDevice.type}
						on:input={(event) =>
							mutateDraft(
								(draft) => {
									draft.devices[selectedDeviceIndex].type = (
										event.currentTarget as HTMLInputElement
									).value;
								},
								{ autosave: true }
							)}
					/>
				</label>
			</div>
			<div class="field-grid cols-1">
				<label>
					Notes
					<textarea
						rows="1"
						value={selectedDevice.notes ?? ''}
						on:input={(event) =>
							mutateDraft(
								(draft) => {
									draft.devices[selectedDeviceIndex].notes = (
										event.currentTarget as HTMLTextAreaElement
									).value;
								},
								{ autosave: true }
							)}></textarea>
				</label>
			</div>

			<section class="modal-section">
				<div class="section-head">
					<span class="section-title">Rack</span>
					<span class="rule"></span>
				</div>
				<div class="field-grid cols-3">
					<label>
						Rack
						<select
							value={rackNewNameTarget?.kind === 'device' &&
							rackNewNameTarget?.index === selectedDeviceIndex
								? '__new__'
								: (selectedDevice.rack?.name ?? '')}
							on:change={(event) =>
								onRackSelectChange(
									'device',
									selectedDeviceIndex,
									(event.currentTarget as HTMLSelectElement).value
								)}
						>
							<option value="">Not racked</option>
							{#each rackNames as rackName (rackName)}
								<option value={rackName}>{rackName}</option>
							{/each}
							<option value="__new__">New rack…</option>
						</select>
					</label>
					{#if rackNewNameTarget?.kind === 'device' && rackNewNameTarget?.index === selectedDeviceIndex}
						<label>
							New rack name
							<input
								type="text"
								placeholder="e.g. Lab Rack"
								on:change={(event) =>
									submitNewRackName((event.currentTarget as HTMLInputElement).value)}
							/>
						</label>
					{/if}
					<label>
						Bottom U
						<input
							type="number"
							min="1"
							disabled={!selectedDevice.rack}
							value={selectedDevice.rack?.unit ?? ''}
							on:change={(event) =>
								updateRackField(
									'device',
									selectedDeviceIndex,
									'unit',
									(event.currentTarget as HTMLInputElement).value
								)}
						/>
					</label>
					<label>
						Height (U)
						<input
							type="number"
							min="1"
							placeholder="1"
							disabled={!selectedDevice.rack}
							value={selectedDevice.rack?.heightU ?? ''}
							on:change={(event) =>
								updateRackField(
									'device',
									selectedDeviceIndex,
									'heightU',
									(event.currentTarget as HTMLInputElement).value
								)}
						/>
					</label>
				</div>
			</section>

			<section class="modal-section">
				<div class="section-head">
					<span class="section-title">Ports &amp; cables</span>
					<span class="count-chip">{(selectedDevice.ports ?? []).length}</span>
					<span class="rule"></span>
					<button
						type="button"
						class="btn-small"
						on:click={() =>
							mutateDraft((draft) => {
								draft.devices[selectedDeviceIndex].ports ??= [];
								draft.devices[selectedDeviceIndex].ports.push({
									...createEmptyPort('port'),
									portName: nextUniqueName(
										'port0',
										draft.devices[selectedDeviceIndex].ports.map((port) => port.portName)
									)
								});
							})}
					>
						+ Add port
					</button>
				</div>
				{#if (selectedDevice.ports ?? []).length > 0}
					<div class="data-table">
						{#each selectedDevice.ports ?? [] as port, portIndex (portIndex)}
							<div
								class="table-row port-grid"
								class:expanded={expandedPortIndex === portIndex}
								role="button"
								tabindex="0"
								title="Click to edit"
								on:click={() => toggleExpandedPort(portIndex)}
								on:keydown={(event) => rowKeydown(event, () => toggleExpandedPort(portIndex))}
							>
								<span class="mono row-name">{port.portName}</span>
								<span class="row-muted">{formatSpeed(port.speedGbps)}</span>
								<span class="row-connection">
									{#if port.connectedTo}
										<span class="row-muted" aria-hidden="true">→</span>
										{port.connectedTo.device}
										<span class="mono row-muted">{port.connectedTo.port}</span>
									{:else}
										<span class="row-muted">Not connected · click to connect…</span>
									{/if}
								</span>
								<span class="row-cable">
									{#if port.connectedTo?.cable?.type || port.connectedTo?.cable?.color || typeof port.connectedTo?.cable?.lengthM === 'number'}
										{#if port.connectedTo.cable?.color}
											<span
												class="cable-swatch"
												style={`background: ${port.connectedTo.cable.color};`}
											></span>
										{/if}
										{[
											port.connectedTo.cable?.type,
											typeof port.connectedTo.cable?.lengthM === 'number'
												? `${port.connectedTo.cable.lengthM}m`
												: null
										]
											.filter(Boolean)
											.join(' · ') || '—'}
									{:else}
										<span class="row-muted">—</span>
									{/if}
								</span>
								<button
									type="button"
									class="row-trash"
									title="Delete port"
									aria-label={`Delete port ${port.portName}`}
									on:click|stopPropagation={() => {
										clearConnectionDraft('device', selectedDevice.name, port.portName);
										applyDraft(
											deletePort(networkData, 'device', selectedDevice.name, port.portName)
										);
									}}
								>
									🗑
								</button>
							</div>
							{#if expandedPortIndex === portIndex}
								<div class="row-expand">
									<div class="field-grid cols-3">
										<label>
											Port name
											<input
												type="text"
												class="mono"
												value={port.portName}
												on:change={(event) =>
													updateDevicePortName(
														selectedDeviceIndex,
														portIndex,
														(event.currentTarget as HTMLInputElement).value
													)}
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
											MAC address
											<input
												type="text"
												class="mono"
												placeholder="aa:bb:cc:dd:ee:ff"
												bind:value={port.macAddress}
												on:input={() => mutateDraft(() => undefined, { autosave: true })}
											/>
										</label>
									</div>
									<div class="field-grid cols-2">
										<label>
											Connect to device
											<input
												type="text"
												list="device-connectable-owner-options"
												value={resolveConnectionDraft('device', selectedDevice.name, port).device}
												on:change={(event) =>
													onDevicePortConnectionFieldChange(
														selectedDeviceIndex,
														portIndex,
														'device',
														(event.currentTarget as HTMLInputElement).value
													)}
											/>
										</label>
										<label>
											Target port
											<input
												type="text"
												class="mono"
												value={resolveConnectionDraft('device', selectedDevice.name, port).port}
												on:change={(event) =>
													onDevicePortConnectionFieldChange(
														selectedDeviceIndex,
														portIndex,
														'port',
														(event.currentTarget as HTMLInputElement).value
													)}
											/>
										</label>
									</div>
									{#if port.connectedTo}
										<div class="field-grid cols-3">
											<label>
												Cable type
												<input
													type="text"
													list="cable-type-options"
													value={port.connectedTo.cable?.type ?? ''}
													on:change={(event) =>
														updatePortCableField(
															'device',
															selectedDevice.name,
															port,
															'type',
															(event.currentTarget as HTMLInputElement).value
														)}
												/>
											</label>
											<label>
												Cable colour
												<input
													type="text"
													list="cable-color-options"
													value={port.connectedTo.cable?.color ?? ''}
													on:change={(event) =>
														updatePortCableField(
															'device',
															selectedDevice.name,
															port,
															'color',
															(event.currentTarget as HTMLInputElement).value
														)}
												/>
											</label>
											<label>
												Cable length (m)
												<input
													type="number"
													min="0"
													step="0.5"
													value={port.connectedTo.cable?.lengthM ?? ''}
													on:change={(event) =>
														updatePortCableField(
															'device',
															selectedDevice.name,
															port,
															'lengthM',
															(event.currentTarget as HTMLInputElement).value
														)}
												/>
											</label>
										</div>
										<div class="row-expand-actions">
											<button
												type="button"
												class="btn-small"
												on:click={() => {
													clearConnectionDraft('device', selectedDevice.name, port.portName);
													updateDevicePortConnection(selectedDeviceIndex, portIndex, undefined);
												}}
											>
												Disconnect
											</button>
										</div>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			</section>
		</div>
	{:else if selectedTarget?.type === 'vm' && selectedVm}
		<div class="modal-sections">
			<div class="field-grid cols-2">
				<label>
					Name
					<input
						type="text"
						value={selectedVm.name}
						on:input={(event) =>
							mutateDraft(
								(draft) => {
									draft.machines[selectedVmMachineIndex].software.vms[selectedVmIndex].name = (
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
						value={selectedVm.role}
						on:input={(event) =>
							mutateDraft(
								(draft) => {
									draft.machines[selectedVmMachineIndex].software.vms[selectedVmIndex].role = (
										event.currentTarget as HTMLInputElement
									).value;
								},
								{ autosave: true }
							)}
					/>
				</label>
			</div>
			<div class="field-grid cols-2">
				<label>
					IP address
					<input
						type="text"
						class="mono"
						value={selectedVm.ipAddress}
						on:input={(event) =>
							mutateDraft(
								(draft) => {
									draft.machines[selectedVmMachineIndex].software.vms[selectedVmIndex].ipAddress = (
										event.currentTarget as HTMLInputElement
									).value;
								},
								{ autosave: true }
							)}
					/>
					{#if selectedVmIpConflicts.length > 0}
						<span class="ip-conflict-hint">Also used by {selectedVmIpConflicts.join(', ')}</span>
					{/if}
				</label>
				<label>
					MAC address
					<input
						type="text"
						class="mono"
						placeholder="aa:bb:cc:dd:ee:ff"
						value={selectedVm.macAddress ?? ''}
						on:input={(event) =>
							mutateDraft(
								(draft) => {
									draft.machines[selectedVmMachineIndex].software.vms[selectedVmIndex].macAddress =
										(event.currentTarget as HTMLInputElement).value;
								},
								{ autosave: true }
							)}
					/>
				</label>
			</div>
		</div>
	{/if}

	<svelte:fragment slot="footer">
		{#if selectedTarget?.type === 'machine'}
			<button
				type="button"
				class="btn-danger-quiet"
				on:click={() => openDeleteConfirmation({ type: 'machine', index: selectedMachineIndex })}
			>
				Delete machine…
			</button>
		{:else if selectedTarget?.type === 'device'}
			<button
				type="button"
				class="btn-danger-quiet"
				on:click={() => openDeleteConfirmation({ type: 'device', index: selectedDeviceIndex })}
			>
				Delete device…
			</button>
		{:else if selectedTarget?.type === 'vm'}
			<button
				type="button"
				class="btn-danger-quiet"
				on:click={() =>
					openDeleteConfirmation({
						type: 'vm',
						machineIndex: selectedVmMachineIndex,
						vmIndex: selectedVmIndex
					})}
			>
				Delete VM…
			</button>
		{/if}
		<span class="footer-spacer"></span>
		<span class="footer-hint">
			{writable ? 'Changes save automatically' : 'Read-only — changes are not saved'}
		</span>
		<button type="button" class="btn-primary-modal" on:click={closeSelectedTargetModal}>
			Done
		</button>
	</svelte:fragment>
</Modal>

<Modal isOpen={addModalKind !== null} maxWidth="560px" on:close={closeAddEntityModal}>
	<svelte:fragment slot="header">
		<div class="entity-header">
			<div class="icon-anchor">
				<button
					type="button"
					class="icon-btn"
					title="Choose icon"
					aria-label="Choose icon"
					on:click={() => (iconPopoverOpen = !iconPopoverOpen)}
				>
					{#if addModalIconPath}
						<img src={addModalIconPath} alt="" loading="lazy" />
					{:else}
						<span aria-hidden="true">⬢</span>
					{/if}
				</button>
				{#if iconPopoverOpen}
					<IconPickerPopover
						currentIconKey={addModalIconKey || undefined}
						on:select={(event) => setAddModalIconKey(event.detail)}
						on:close={() => (iconPopoverOpen = false)}
					/>
				{/if}
			</div>
			<div class="entity-id">
				<div class="entity-name-row">
					<span class="entity-name">
						{addModalKind === 'machine' ? 'Add machine' : 'Add device'}
					</span>
				</div>
				<span class="entity-meta">Pick an icon, name it, give it an IP</span>
			</div>
		</div>
	</svelte:fragment>

	{#if addModalKind === 'machine'}
		<div class="modal-sections">
			<div class="field-grid cols-2">
				<label>
					Name
					<input type="text" bind:value={newMachineDraft.machineName} />
				</label>
				<label>
					IP address
					<span class="ip-suggest-row">
						<input type="text" class="mono" bind:value={newMachineDraft.ipAddress} />
						<button type="button" class="btn-small" on:click={suggestIpForAddModal}>Suggest</button>
					</span>
				</label>
			</div>
			<div class="field-grid cols-2">
				<label>
					Role
					<input type="text" bind:value={newMachineDraft.role} />
				</label>
				<label>
					Operating system
					<input type="text" bind:value={newMachineDraft.operatingSystem} />
				</label>
			</div>
			<div class="field-grid cols-1">
				<label>
					Notes
					<textarea rows="1" bind:value={newMachineDraft.notes}></textarea>
				</label>
			</div>
		</div>
	{:else if addModalKind === 'device'}
		<div class="modal-sections">
			<div class="field-grid cols-2">
				<label>
					Name
					<input type="text" bind:value={newDeviceDraft.name} />
				</label>
				<label>
					IP address
					<span class="ip-suggest-row">
						<input type="text" class="mono" bind:value={newDeviceDraft.ipAddress} />
						<button type="button" class="btn-small" on:click={suggestIpForAddModal}>Suggest</button>
					</span>
				</label>
			</div>
			<div class="field-grid cols-2">
				<label>
					Type
					<input type="text" bind:value={newDeviceDraft.type} />
				</label>
				<label>
					Notes
					<textarea rows="1" bind:value={newDeviceDraft.notes}></textarea>
				</label>
			</div>
		</div>
	{/if}

	<svelte:fragment slot="footer">
		<span class="footer-spacer"></span>
		<button type="button" class="btn-primary-modal" on:click={submitAddEntity}>
			{addModalKind === 'machine' ? 'Add machine' : 'Add device'}
		</button>
	</svelte:fragment>
</Modal>

<Modal
	isOpen={deleteTarget !== null}
	title="Confirm delete"
	maxWidth="440px"
	on:close={() => (deleteTarget = null)}
>
	<p class="confirm-copy">
		This will remove the selected item and clean up related links. Continue?
	</p>
	<svelte:fragment slot="footer">
		<span class="footer-spacer"></span>
		<button type="button" class="btn-small" on:click={() => (deleteTarget = null)}>Cancel</button>
		<button type="button" class="btn-danger-fill" on:click={confirmDelete}>Delete</button>
	</svelte:fragment>
</Modal>

<Modal
	isOpen={showExportModal}
	title="Export PNG"
	maxWidth="440px"
	on:close={() => (showExportModal = false)}
>
	<div class="modal-sections">
		<div class="field-grid cols-1">
			<label>
				File name
				<input type="text" bind:value={exportFileName} />
			</label>
		</div>
		<div class="field-grid cols-2">
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
					<option value="theme">Match theme</option>
					<option value="transparent">Transparent</option>
				</select>
			</label>
		</div>
	</div>
	<svelte:fragment slot="footer">
		<span class="footer-spacer"></span>
		<button type="button" class="btn-primary-modal" disabled={isExportingPng} on:click={exportPng}>
			{isExportingPng ? 'Exporting…' : 'Download PNG'}
		</button>
	</svelte:fragment>
</Modal>

<style>
	.diagram-shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}

	.diagram-stage {
		position: relative;
		flex: 1;
		min-height: 0;
		background: var(--bg-canvas);
		overflow: hidden;
	}

	.diagram-canvas {
		position: absolute;
		inset: 0;
	}

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

	.racks-manager {
		position: absolute;
		right: 0.75rem;
		top: 0.75rem;
		z-index: 14;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		box-shadow: var(--shadow-panel);
		padding: 0.55rem 0.7rem;
		max-width: min(88vw, 340px);
	}

	.racks-manager-toggle {
		margin-bottom: 0;
	}

	.racks-manager-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 4.4rem auto;
		gap: 0.35rem;
		align-items: end;
	}

	.racks-manager-row label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.66rem;
		font-weight: 600;
		color: var(--muted-text);
	}

	.racks-manager-row input {
		border: 1px solid var(--panel-border);
		background: var(--panel-bg);
		color: var(--panel-contrast);
		border-radius: 6px;
		padding: 0.25rem 0.35rem;
		font-size: 0.76rem;
		min-width: 0;
	}

	.racks-manager-row button {
		border: 1px solid var(--panel-border);
		background: var(--panel-bg);
		color: var(--panel-contrast);
		border-radius: 6px;
		padding: 0.25rem 0.4rem;
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
	}

	.racks-manager .inline-actions button {
		border: 1px solid var(--panel-border);
		background: var(--panel-bg);
		color: var(--panel-contrast);
		border-radius: 7px;
		padding: 0.3rem 0.5rem;
		font-size: 0.76rem;
		font-weight: 600;
		cursor: pointer;
	}

	.graph-viewport {
		position: absolute;
		inset: 0;
	}

	.map-legend {
		position: absolute;
		left: 0.75rem;
		bottom: 0.75rem;
		z-index: 14;
		display: flex;
		flex-direction: column;
		width: 260px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		box-shadow: var(--shadow-panel);
		padding: 8px;
	}

	.legend-title {
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-2);
		padding: 5px 9px 3px;
	}

	.legend-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 9px;
		border: none;
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--text);
		font-family: inherit;
		cursor: pointer;
		text-align: left;
	}

	.legend-row:hover {
		background: var(--surface-2);
	}

	.legend-row.selected {
		background: var(--surface-2);
	}

	.legend-row.filtered-out {
		opacity: 0.45;
	}

	.legend-row.filtered-out .legend-name {
		text-decoration: line-through;
	}

	.legend-name {
		font-size: 12.5px;
		font-weight: 600;
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.legend-cidr {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--text-2);
	}

	.legend-count {
		font-size: 10.5px;
		font-weight: 600;
		color: var(--text-2);
		background: var(--surface);
		border: 1px solid var(--border);
		padding: 0 5px;
		border-radius: 999px;
	}

	.legend-rule {
		height: 1px;
		background: var(--surface-2);
		margin: 5px 4px;
	}

	.vlan-swatch {
		width: 11px;
		height: 11px;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.shape-key {
		display: flex;
		gap: 12px;
		padding: 5px 9px 4px;
		font-size: 10.5px;
		color: var(--text-2);
		align-items: center;
	}

	.shape-item {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.shape-swatch {
		width: 14px;
		height: 9px;
		border-radius: 2px;
	}

	.shape-swatch.host {
		border: 1.5px solid var(--graph-edge);
		background: var(--surface);
	}

	.shape-swatch.infra {
		background: var(--graph-infra-fill);
	}

	.shape-swatch.device {
		border: 1.5px dashed var(--graph-dumb-border);
		border-radius: 999px;
		background: var(--surface);
	}

	.ipam-panel {
		position: absolute;
		right: 0.75rem;
		bottom: 0.75rem;
		z-index: 15;
		width: min(88vw, 340px);
		max-height: min(72%, 620px);
		overflow-y: auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		padding: 0.7rem 0.8rem;
		color: var(--text);
		box-shadow: var(--shadow-panel);
	}

	.ipam-panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.4rem;
	}

	.ipam-panel-head h3 {
		margin: 0;
		font-size: 0.92rem;
	}

	.ipam-close {
		border: none;
		background: transparent;
		color: var(--panel-contrast);
		font-size: 1.2rem;
		font-weight: 700;
		line-height: 1;
		cursor: pointer;
		padding: 0 0.2rem;
	}

	.ipam-section {
		margin-top: 0.7rem;
	}

	.ipam-section h4 {
		margin: 0 0 0.4rem;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted-text);
	}

	.ipam-subnet {
		margin-bottom: 0.6rem;
	}

	.ipam-subnet-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.82rem;
		flex-wrap: wrap;
	}

	.ipam-subnet-name {
		color: var(--muted-text);
		font-size: 0.78rem;
		font-weight: 600;
	}

	.ipam-cidr {
		font-family: var(--font-mono);
		font-size: 0.74rem;
		color: var(--text-2);
	}

	.ipam-badge {
		font-size: 0.66rem;
		font-weight: 700;
		border: 1px solid var(--accent);
		color: var(--accent);
		border-radius: 999px;
		padding: 0.05rem 0.4rem;
	}

	.ipam-badge.inferred {
		border-color: var(--panel-border);
		color: var(--muted-text);
	}

	.ipam-bar {
		height: 8px;
		border-radius: 999px;
		background: var(--surface-2);
		margin: 0.35rem 0;
		overflow: hidden;
	}

	.ipam-bar-fill {
		height: 100%;
		border-radius: 999px;
		background: var(--accent);
		min-width: 2px;
	}

	.ipam-bar-fill.hot {
		background: var(--danger);
	}

	.ipam-subnet-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.74rem;
		color: var(--text-2);
	}

	.ipam-copy-ip {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text);
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		cursor: pointer;
		white-space: nowrap;
	}

	.ipam-copy-ip:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.ipam-conflicts code,
	.ipam-unparsed code {
		font-family: var(--font-mono);
		font-size: 0.74rem;
	}

	.ipam-conflicts,
	.ipam-unparsed {
		margin: 0;
		padding-left: 1.1rem;
		font-size: 0.78rem;
	}

	.ipam-conflicts li {
		color: var(--danger);
		margin-bottom: 0.2rem;
	}

	.ipam-unparsed li {
		margin-bottom: 0.2rem;
	}

	.ipam-empty {
		margin: 0 0 0.4rem;
		font-size: 0.76rem;
		color: var(--muted-text);
	}

	.ipam-subnet-editor {
		display: grid;
		grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) 3.6rem auto;
		gap: 0.35rem;
		align-items: end;
		margin-bottom: 0.45rem;
	}

	.ipam-subnet-editor label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--muted-text);
	}

	.ipam-subnet-editor input {
		border: 1px solid var(--panel-border);
		background: var(--panel-bg);
		color: var(--panel-contrast);
		border-radius: 6px;
		padding: 0.25rem 0.35rem;
		font-size: 0.76rem;
		min-width: 0;
	}

	.ipam-disclosure {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		border: none;
		background: transparent;
		color: var(--text-2);
		font-size: 0.78rem;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		padding: 0.2rem 0;
		margin-bottom: 0.35rem;
	}

	.ipam-disclosure:hover {
		color: var(--text);
	}

	.disclosure-chevron {
		display: inline-block;
		transition: transform 120ms ease;
	}

	.disclosure-chevron.open {
		transform: rotate(90deg);
	}

	.ipam-manage {
		border-top: 1px solid var(--surface-2);
		padding-top: 0.5rem;
	}

	.subnet-remove {
		height: auto;
		padding: 0.25rem 0.5rem;
		font-size: 0.72rem;
	}

	.subnet-remove.confirming {
		background: color-mix(in srgb, var(--danger) 12%, transparent);
		font-weight: 700;
	}

	.ip-conflict-hint {
		display: block;
		margin-top: 0.2rem;
		font-size: 0.74rem;
		font-weight: 600;
		color: var(--danger);
	}

	.ip-suggest-row {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}

	.ip-suggest-row input {
		flex: 1;
		min-width: 0;
	}

	.ip-suggest-row button {
		border: 1px solid var(--panel-border);
		background: var(--panel-bg);
		color: var(--panel-contrast);
		border-radius: 7px;
		padding: 0.35rem 0.55rem;
		font-size: 0.76rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}

	.stage-toasts {
		position: absolute;
		top: 0.75rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-width: min(90vw, 480px);
	}

	.stage-toast {
		background: var(--surface);
		border: 1px solid var(--danger);
		color: var(--danger);
		border-radius: var(--radius-panel);
		box-shadow: var(--shadow-panel);
		padding: 0.45rem 0.7rem;
		font-size: 12px;
		font-weight: 500;
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
		margin: 0.75rem;
		color: var(--panel-contrast);
		font-size: 0.92rem;
	}

	.validation-panel {
		border-color: var(--status-warn);
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

	/* ---- Editor modal ---- */

	.entity-header {
		display: flex;
		align-items: center;
		gap: 14px;
		flex: 1;
		min-width: 0;
	}

	.icon-anchor {
		position: relative;
		flex-shrink: 0;
	}

	.icon-btn {
		width: 44px;
		height: 44px;
		border-radius: var(--radius-panel);
		background: var(--surface-2);
		border: 1px solid var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 20px;
		color: var(--text-2);
		cursor: pointer;
	}

	.icon-btn:hover {
		border-color: var(--accent);
	}

	.icon-btn img {
		width: 30px;
		height: 30px;
		object-fit: contain;
	}

	.entity-id {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}

	.entity-name-row {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.entity-name {
		font-size: 18px;
		font-weight: 700;
		line-height: 1;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chip-role {
		font-size: 11px;
		font-weight: 600;
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, var(--surface));
		padding: 2px 8px;
		border-radius: 999px;
		white-space: nowrap;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.entity-meta {
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.modal-sections {
		display: flex;
		flex-direction: column;
		gap: 22px;
	}

	.modal-section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.section-head {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.section-title {
		font-size: 15px;
		font-weight: 650;
		color: var(--text);
		white-space: nowrap;
	}

	.count-chip {
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-2);
		background: var(--surface-2);
		padding: 1px 7px;
		border-radius: 999px;
	}

	.rule {
		flex: 1;
		height: 1px;
		background: color-mix(in srgb, var(--border) 60%, var(--surface));
	}

	.field-grid {
		display: grid;
		gap: 12px;
	}

	.field-grid.cols-1 {
		grid-template-columns: 1fr;
	}

	.field-grid.cols-2 {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.field-grid.cols-3 {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.field-grid.cols-4 {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}

	.field-grid.cols-1-2 {
		grid-template-columns: 1fr 2fr;
	}

	@media (max-width: 640px) {
		.field-grid.cols-2,
		.field-grid.cols-3,
		.field-grid.cols-4,
		.field-grid.cols-1-2 {
			grid-template-columns: 1fr;
		}
	}

	.field-grid label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
		min-width: 0;
	}

	.field-grid input,
	.field-grid textarea,
	.field-grid select {
		height: var(--control-h);
		padding: 0 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		background: var(--surface);
		color: var(--text);
		font-size: 13.5px;
		font-family: inherit;
		box-sizing: border-box;
		width: 100%;
	}

	.field-grid input.mono {
		font-family: var(--font-mono);
		font-size: 12px;
	}

	.field-grid textarea {
		min-height: var(--control-h);
		padding-top: 6px;
		resize: vertical;
	}

	.field-grid input:focus,
	.field-grid textarea:focus,
	.field-grid select:focus {
		outline: none;
		border-color: var(--accent);
	}

	.field-grid input:disabled {
		opacity: 0.5;
	}

	.mini-toggle {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		font-weight: 500;
		color: var(--text-2);
		cursor: pointer;
		white-space: nowrap;
	}

	.toggle-input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.toggle-track {
		display: inline-flex;
		width: 30px;
		height: 18px;
		background: color-mix(in oklab, var(--text-2) 40%, var(--surface-2));
		border-radius: 999px;
		position: relative;
		transition: background 120ms ease;
		flex-shrink: 0;
	}

	.toggle-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		background: var(--surface);
		border-radius: 50%;
		transition: transform 120ms ease;
	}

	.toggle-input:checked + .toggle-track {
		background: var(--accent);
	}

	.toggle-input:checked + .toggle-track .toggle-thumb {
		transform: translateX(12px);
	}

	.toggle-input:focus-visible + .toggle-track {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	.btn-small {
		height: 28px;
		padding: 0 11px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		color: var(--text);
		font-size: 12.5px;
		font-weight: 550;
		font-family: inherit;
		cursor: pointer;
		white-space: nowrap;
	}

	.btn-small:hover {
		border-color: var(--accent);
	}

	.data-table {
		border: 1px solid color-mix(in srgb, var(--border) 70%, var(--surface));
		border-radius: 8px;
		overflow: hidden;
	}

	.vm-grid {
		display: grid;
		grid-template-columns: 28px 1.2fr 1.6fr 1fr 1.3fr 30px;
		gap: 10px;
		align-items: center;
	}

	.port-grid {
		display: grid;
		grid-template-columns: 0.8fr 0.7fr 1.9fr 1.1fr 30px;
		gap: 10px;
		align-items: center;
	}

	.table-head {
		padding: 6px 12px;
		background: var(--surface-2);
		border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, var(--surface));
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-2);
	}

	.table-row {
		padding: 8px 12px;
		background: var(--surface);
		font-size: 13px;
		color: var(--text);
		cursor: pointer;
		text-align: left;
		width: 100%;
		border: none;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, var(--surface));
		font-family: inherit;
	}

	.table-row:last-child {
		border-bottom: none;
	}

	.table-row:hover,
	.table-row.expanded {
		background: color-mix(in srgb, var(--surface-2) 55%, var(--surface));
	}

	.table-row:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	.table-row .mono {
		font-family: var(--font-mono);
		font-size: 11.5px;
	}

	.row-icon {
		width: 22px;
		height: 22px;
		border-radius: 5px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		color: var(--text-2);
		overflow: hidden;
	}

	.row-icon img {
		width: 16px;
		height: 16px;
		object-fit: contain;
	}

	.row-name {
		font-weight: 550;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.row-muted {
		color: var(--text-2);
		font-size: 12.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.row-connection {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.row-cable {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--text);
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
	}

	.cable-swatch {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		border: 1px solid var(--border);
		flex-shrink: 0;
	}

	.row-trash {
		width: 26px;
		height: 26px;
		border: none;
		background: transparent;
		color: var(--text-2);
		font-size: 13px;
		cursor: pointer;
		border-radius: 5px;
		line-height: 1;
	}

	.row-trash:hover {
		color: var(--danger);
		background: color-mix(in srgb, var(--danger) 12%, var(--surface));
	}

	.row-expand {
		padding: 12px;
		background: color-mix(in srgb, var(--surface-2) 40%, var(--surface));
		border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, var(--surface));
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.row-expand:last-child {
		border-bottom: none;
	}

	.row-expand-actions {
		display: flex;
		justify-content: flex-end;
	}

	.row-icon-picker {
		align-self: flex-start;
	}

	.footer-spacer {
		flex: 1;
	}

	.footer-hint {
		font-size: 12px;
		color: var(--text-2);
	}

	.btn-primary-modal {
		height: var(--control-h);
		padding: 0 16px;
		background: var(--accent);
		color: var(--surface);
		border: none;
		border-radius: var(--radius-control);
		font-size: 13.5px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
	}

	.btn-primary-modal:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.btn-danger-quiet {
		height: var(--control-h);
		padding: 0 12px;
		background: transparent;
		color: var(--danger);
		border: none;
		border-radius: var(--radius-control);
		font-size: 13px;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
	}

	.btn-danger-quiet:hover {
		background: color-mix(in srgb, var(--danger) 10%, transparent);
	}

	.btn-danger-fill {
		height: var(--control-h);
		padding: 0 16px;
		background: var(--danger);
		color: #fff;
		border: none;
		border-radius: var(--radius-control);
		font-size: 13.5px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
	}

	.confirm-copy {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.55;
		color: var(--text);
	}

	@media (max-width: 900px) {
		.diagram-stage {
			min-height: 560px;
		}
	}
</style>
