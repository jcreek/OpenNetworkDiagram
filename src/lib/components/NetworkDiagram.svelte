<script lang="ts">
	import { onMount } from 'svelte';
	import cytoscape from 'cytoscape';
	import dagre from 'cytoscape-dagre';
	import loadNetworkData from '../data/loadNetworkData';
	import { transformNetworkDataToGraph } from '../graph/transformNetworkData';
	import Modal from './Modal.svelte';
	import type { NetworkData } from '../types';
	import type {
		GraphEdgeElement,
		GraphNodeData,
		GraphNodeDetails,
		GraphNodeElement,
		GraphTransformResult
	} from '../graph/types';

	cytoscape.use(dagre);

	export let jsonPath = '/data/network.json';

	type CameraMode = 'readable' | 'overview';
	type Position = { x: number; y: number };

	let container: HTMLDivElement;
	let cy: cytoscape.Core | null = null;
	let warnings: string[] = [];
	let selectedDetails: GraphNodeDetails | null = null;
	let selectedNodeId: string | null = null;
	let cameraMode: CameraMode = 'readable';
	let showEthernetLabels = false;

	let allNodes: GraphNodeElement[] = [];
	let allEdges: GraphEdgeElement[] = [];
	let machineBaseLabels: Record<string, string> = {};
	let machineVmIndex: GraphTransformResult['machineVmIndex'] = {};
	let collapsedHosts: Record<string, boolean> = {};
	let hasAnyVmHosts = false;
	let dataSourceLabel = jsonPath;
	let loadError: string | null = null;
	let isLoadingData = false;

	let tooltip = {
		visible: false,
		text: '',
		x: 0,
		y: 0
	};

	function closeDetails() {
		selectedDetails = null;
		selectedNodeId = null;
	}

	function formatConnection(connection?: { device: string; port: string }): string {
		if (!connection) {
			return 'Not connected';
		}
		return `${connection.device}:${connection.port}`;
	}

	function isHostCollapsed(hostId: string): boolean {
		return collapsedHosts[hostId] === true;
	}

	function initializeCollapsedHosts(index: GraphTransformResult['machineVmIndex']) {
		const next: Record<string, boolean> = {};
		for (const hostId of Object.keys(index)) {
			if ((index[hostId]?.vmCount ?? 0) > 0) {
				next[hostId] = true;
			}
		}
		collapsedHosts = next;
	}

	function applyLoadedData(networkData: NetworkData) {
		const transformed = transformNetworkDataToGraph(networkData);
		warnings = transformed.warnings;
		allNodes = transformed.nodes;
		allEdges = transformed.edges;
		machineVmIndex = transformed.machineVmIndex;
		hasAnyVmHosts = Object.values(machineVmIndex).some((entry) => (entry?.vmCount ?? 0) > 0);

		const labels: Record<string, string> = {};
		for (const node of allNodes) {
			if (node.data.kind === 'machine') {
				labels[node.data.id] = node.data.label;
			}
		}
		machineBaseLabels = labels;
		initializeCollapsedHosts(machineVmIndex);
		closeDetails();

		for (const warning of warnings) {
			console.warn(`[OpenNetworkDiagram] ${warning}`);
		}

		refreshVisibleGraph();
	}

	function resolveErrorMessage(error: unknown): string {
		if (error instanceof Error && error.message) {
			return error.message;
		}
		return 'Failed to load network JSON data';
	}

	async function reloadDataFromJsonPath() {
		isLoadingData = true;
		loadError = null;

		try {
			const networkData = await loadNetworkData(jsonPath);
			dataSourceLabel = jsonPath;
			applyLoadedData(networkData);
		} catch (error) {
			loadError = resolveErrorMessage(error);
		} finally {
			isLoadingData = false;
		}
	}

	function buildVisibleElements() {
		const nodes: GraphNodeElement[] = [];
		const edges: GraphEdgeElement[] = [];

		for (const node of allNodes) {
			if (node.data.kind === 'vm') {
				const hostId = node.data.hostMachineId;
				if (!hostId || isHostCollapsed(hostId)) {
					continue;
				}
			}

			if (node.data.kind === 'machine') {
				const vmCount = machineVmIndex[node.data.id]?.vmCount ?? 0;
				const baseLabel = machineBaseLabels[node.data.id] ?? node.data.label;
				const label =
					vmCount > 0 && isHostCollapsed(node.data.id)
						? `${baseLabel} (+${vmCount} VMs)`
						: baseLabel;
				nodes.push({
					data: {
						...node.data,
						label
					}
				});
				continue;
			}

			nodes.push({ data: { ...node.data } });
		}

		for (const edge of allEdges) {
			if (edge.data.kind === 'physical') {
				edges.push({ data: { ...edge.data } });
				continue;
			}

			const hostId = edge.data.source;
			if (!isHostCollapsed(hostId)) {
				edges.push({ data: { ...edge.data } });
			}
		}

		return { nodes, edges };
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
		const rawComponents = collectComponents(core);
		const components = rawComponents
			.map((nodes) => {
				const bounds = componentBounds(nodes);
				return {
					nodes,
					...bounds
				};
			})
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

	function runAdaptiveLayout(core: cytoscape.Core, mode: CameraMode) {
		runDagreLayout(core);
		resolveRankCollisions(core);
		const basePositions = capturePositions(core);

		const stageWidth = Math.max(container?.clientWidth ?? 1200, 420);

		if (mode === 'overview') {
			restorePositions(core, basePositions);
			packConnectedComponents(core, Math.max(stageWidth * 1.8, 1600));
			core.fit(undefined, 14);
			return;
		}

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
		if (physicalEdges.length === 0) {
			return;
		}

		const laneGap = 10;
		const endpointOffsetBase = 30;
		const switchEndpointOffsetBase = 24;
		const switchSideInset = 16;
		const switchTopBottomInset = 9;
		const switchEndpointOffsetTopBottom = 14;
		const switchSlotGap = 14;
		const switchAxisGap = 4;
		const switchMarginClamp = 46;
		const midpointClusterRadius = 24;
		type SwitchSide = 'left' | 'right' | 'top' | 'bottom';
		const laneByEdgeId: Record<
			string,
			{
				sourceLane: number;
				targetLane: number;
				centerLane: number;
				sourceIsSwitch: boolean;
				targetIsSwitch: boolean;
				sourceSwitchSide: SwitchSide | null;
				targetSwitchSide: SwitchSide | null;
				sourceSwitchMarginX: number;
				sourceSwitchMarginY: number;
				targetSwitchMarginX: number;
				targetSwitchMarginY: number;
			}
		> = {};
		const endpointsByNodeId: Record<
			string,
			Array<{ edgeId: string; side: 'source' | 'target'; angle: number }>
		> = {};
		const isSwitchNode = (node: cytoscape.NodeSingular) => {
			const details = node.data('details') as GraphNodeDetails | undefined;
			if (!details || details.type !== 'device') {
				return false;
			}
			return details.deviceType.toLowerCase().includes('switch');
		};
		const endpointSide = (angle: number): SwitchSide => {
			const x = Math.cos(angle);
			const y = Math.sin(angle);
			if (Math.abs(x) >= Math.abs(y)) {
				return x >= 0 ? 'right' : 'left';
			}
			return y >= 0 ? 'bottom' : 'top';
		};
		const assignLane = (
			entry: {
				sourceLane: number;
				targetLane: number;
				centerLane: number;
				sourceIsSwitch: boolean;
				targetIsSwitch: boolean;
				sourceSwitchSide: SwitchSide | null;
				targetSwitchSide: SwitchSide | null;
				sourceSwitchMarginX: number;
				sourceSwitchMarginY: number;
				targetSwitchMarginX: number;
				targetSwitchMarginY: number;
			},
			endpoint: { edgeId: string; side: 'source' | 'target' },
			lane: number,
			onSwitch: boolean,
			side: SwitchSide | null
		) => {
			if (endpoint.side === 'source') {
				entry.sourceLane = lane;
				entry.sourceIsSwitch = onSwitch;
				entry.sourceSwitchSide = onSwitch ? side : null;
				return;
			}
			entry.targetLane = lane;
			entry.targetIsSwitch = onSwitch;
			entry.targetSwitchSide = onSwitch ? side : null;
		};

		const estimateLabelWidth = (text: string) => Math.max(18, text.length * 7 + 10);
		const distributeAxis = (desired: number[], sizes: number[], gap: number) => {
			if (desired.length <= 1) {
				return [...desired];
			}
			const placed = [...desired];
			for (let index = 1; index < placed.length; index += 1) {
				const minCenter = placed[index - 1] + (sizes[index - 1] + sizes[index]) / 2 + gap;
				if (placed[index] < minCenter) {
					placed[index] = minCenter;
				}
			}
			for (let index = placed.length - 2; index >= 0; index -= 1) {
				const maxCenter = placed[index + 1] - (sizes[index + 1] + sizes[index]) / 2 - gap;
				if (placed[index] > maxCenter) {
					placed[index] = maxCenter;
				}
			}
			const desiredCenter = desired.reduce((sum, value) => sum + value, 0) / desired.length;
			const placedCenter = placed.reduce((sum, value) => sum + value, 0) / placed.length;
			const shift = desiredCenter - placedCenter;
			for (let index = 0; index < placed.length; index += 1) {
				placed[index] += shift;
			}
			for (let index = 1; index < placed.length; index += 1) {
				const minCenter = placed[index - 1] + (sizes[index - 1] + sizes[index]) / 2 + gap;
				if (placed[index] < minCenter) {
					placed[index] = minCenter;
				}
			}
			return placed;
		};
		const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

		for (const edge of physicalEdges) {
			const edgeId = edge.id();
			laneByEdgeId[edgeId] = {
				sourceLane: 0,
				targetLane: 0,
				centerLane: 0,
				sourceIsSwitch: false,
				targetIsSwitch: false,
				sourceSwitchSide: null,
				targetSwitchSide: null,
				sourceSwitchMarginX: 0,
				sourceSwitchMarginY: 0,
				targetSwitchMarginX: 0,
				targetSwitchMarginY: 0
			};

			const sourcePos = edge.source().position();
			const targetPos = edge.target().position();
			const sourceAngle = Math.atan2(targetPos.y - sourcePos.y, targetPos.x - sourcePos.x);
			const targetAngle = Math.atan2(sourcePos.y - targetPos.y, sourcePos.x - targetPos.x);

			const sourceBucket = endpointsByNodeId[edge.source().id()] ?? [];
			sourceBucket.push({ edgeId, side: 'source', angle: sourceAngle });
			endpointsByNodeId[edge.source().id()] = sourceBucket;

			const targetBucket = endpointsByNodeId[edge.target().id()] ?? [];
			targetBucket.push({ edgeId, side: 'target', angle: targetAngle });
			endpointsByNodeId[edge.target().id()] = targetBucket;
		}

		for (const nodeId of Object.keys(endpointsByNodeId)) {
			const endpoints = endpointsByNodeId[nodeId] ?? [];
			const node = core.getElementById(nodeId);
			const onSwitch =
				!node.empty() && node.isNode() && isSwitchNode(node as cytoscape.NodeSingular);

			if (!onSwitch) {
				const sorted = [...endpoints].sort((a, b) => {
					if (a.angle !== b.angle) {
						return a.angle - b.angle;
					}
					if (a.edgeId !== b.edgeId) {
						return a.edgeId.localeCompare(b.edgeId);
					}
					return a.side.localeCompare(b.side);
				});
				const midpoint = (sorted.length - 1) / 2;
				for (const [index, endpoint] of sorted.entries()) {
					const lane = index - midpoint;
					const laneEntry = laneByEdgeId[endpoint.edgeId];
					if (!laneEntry) {
						continue;
					}
					assignLane(laneEntry, endpoint, lane, false, null);
				}
				continue;
			}

			const buckets: Record<SwitchSide, typeof endpoints> = {
				left: [],
				right: [],
				top: [],
				bottom: []
			};
			for (const endpoint of endpoints) {
				buckets[endpointSide(endpoint.angle)].push(endpoint);
			}

			for (const side of ['left', 'right', 'top', 'bottom'] as const) {
				const sideEndpoints = buckets[side].sort((a, b) => {
					const aOrder =
						side === 'left' || side === 'right' ? Math.sin(a.angle) : Math.cos(a.angle);
					const bOrder =
						side === 'left' || side === 'right' ? Math.sin(b.angle) : Math.cos(b.angle);
					if (aOrder !== bOrder) {
						return aOrder - bOrder;
					}
					if (a.edgeId !== b.edgeId) {
						return a.edgeId.localeCompare(b.edgeId);
					}
					return a.side.localeCompare(b.side);
				});
				const midpoint = (sideEndpoints.length - 1) / 2;
				const desiredAxisPositions: number[] = [];
				const axisSizes: number[] = [];
				for (const [index, endpoint] of sideEndpoints.entries()) {
					const lane = index - midpoint;
					const laneEntry = laneByEdgeId[endpoint.edgeId];
					if (!laneEntry) {
						continue;
					}
					assignLane(laneEntry, endpoint, lane, true, side);

					const edge = core.getElementById(endpoint.edgeId);
					const labelText =
						endpoint.side === 'source'
							? String(edge.data('sourcePort') ?? '')
							: String(edge.data('targetPort') ?? '');
					const axisSize = side === 'left' || side === 'right' ? 14 : estimateLabelWidth(labelText);
					desiredAxisPositions.push(lane * switchSlotGap);
					axisSizes.push(axisSize);
				}

				const placedAxisPositions = distributeAxis(desiredAxisPositions, axisSizes, switchAxisGap);
				for (const [index, endpoint] of sideEndpoints.entries()) {
					const laneEntry = laneByEdgeId[endpoint.edgeId];
					if (!laneEntry) {
						continue;
					}
					const axisPosition = clamp(
						placedAxisPositions[index] ?? 0,
						-switchMarginClamp,
						switchMarginClamp
					);

					let marginX = 0;
					let marginY = 0;
					if (side === 'left') {
						marginX = -switchSideInset;
						marginY = axisPosition;
					} else if (side === 'right') {
						marginX = switchSideInset;
						marginY = axisPosition;
					} else if (side === 'top') {
						marginX = axisPosition;
						marginY = -switchTopBottomInset;
					} else {
						marginX = axisPosition;
						marginY = switchTopBottomInset;
					}

					if (endpoint.side === 'source') {
						laneEntry.sourceSwitchMarginX = marginX;
						laneEntry.sourceSwitchMarginY = marginY;
					} else {
						laneEntry.targetSwitchMarginX = marginX;
						laneEntry.targetSwitchMarginY = marginY;
					}
				}
			}
		}

		type Midpoint = { edgeId: string; x: number; y: number };
		type Cluster = { points: Midpoint[]; cx: number; cy: number };
		const midpoints: Midpoint[] = physicalEdges
			.map((edge) => {
				const sourcePos = edge.source().position();
				const targetPos = edge.target().position();
				return {
					edgeId: edge.id(),
					x: (sourcePos.x + targetPos.x) / 2,
					y: (sourcePos.y + targetPos.y) / 2
				};
			})
			.sort((a, b) => {
				if (a.x !== b.x) {
					return a.x - b.x;
				}
				if (a.y !== b.y) {
					return a.y - b.y;
				}
				return a.edgeId.localeCompare(b.edgeId);
			});

		const clusters: Cluster[] = [];
		for (const point of midpoints) {
			let closest: Cluster | null = null;
			let bestDistance = Number.POSITIVE_INFINITY;
			for (const cluster of clusters) {
				const distance = Math.hypot(point.x - cluster.cx, point.y - cluster.cy);
				if (distance <= midpointClusterRadius && distance < bestDistance) {
					bestDistance = distance;
					closest = cluster;
				}
			}

			if (!closest) {
				clusters.push({ points: [point], cx: point.x, cy: point.y });
				continue;
			}

			closest.points.push(point);
			const count = closest.points.length;
			closest.cx = (closest.cx * (count - 1) + point.x) / count;
			closest.cy = (closest.cy * (count - 1) + point.y) / count;
		}

		for (const cluster of clusters) {
			const sorted = [...cluster.points].sort((a, b) => a.edgeId.localeCompare(b.edgeId));
			const midpoint = (sorted.length - 1) / 2;
			for (const [index, point] of sorted.entries()) {
				if (!laneByEdgeId[point.edgeId]) {
					continue;
				}
				laneByEdgeId[point.edgeId].centerLane = index - midpoint;
			}
		}

		core.batch(() => {
			for (const edge of physicalEdges) {
				const edgeId = edge.id();
				const lanes = laneByEdgeId[edgeId] ?? {
					sourceLane: 0,
					targetLane: 0,
					centerLane: 0,
					sourceIsSwitch: false,
					targetIsSwitch: false,
					sourceSwitchSide: null,
					targetSwitchSide: null,
					sourceSwitchMarginX: 0,
					sourceSwitchMarginY: 0,
					targetSwitchMarginX: 0,
					targetSwitchMarginY: 0
				};
				const { sourceLane } = lanes;
				const { targetLane } = lanes;
				const { centerLane } = lanes;
				const laneAverage = (sourceLane + targetLane) / 2;
				const sourceIsTopBottomSwitch =
					lanes.sourceIsSwitch &&
					(lanes.sourceSwitchSide === 'top' || lanes.sourceSwitchSide === 'bottom');
				const targetIsTopBottomSwitch =
					lanes.targetIsSwitch &&
					(lanes.targetSwitchSide === 'top' || lanes.targetSwitchSide === 'bottom');
				const controlPointDistance = Math.max(-54, Math.min(54, laneAverage * 18));
				const sourceOffset = lanes.sourceIsSwitch
					? sourceIsTopBottomSwitch
						? switchEndpointOffsetTopBottom
						: switchEndpointOffsetBase
					: endpointOffsetBase + Math.min(24, Math.abs(sourceLane) * 4);
				const targetOffset = lanes.targetIsSwitch
					? targetIsTopBottomSwitch
						? switchEndpointOffsetTopBottom
						: switchEndpointOffsetBase
					: endpointOffsetBase + Math.min(24, Math.abs(targetLane) * 4);
				const sourceMarginY = lanes.sourceIsSwitch
					? lanes.sourceSwitchMarginY
					: sourceLane * laneGap;
				const targetMarginY = lanes.targetIsSwitch
					? lanes.targetSwitchMarginY
					: targetLane * laneGap;
				const sourceMarginX = lanes.sourceIsSwitch ? lanes.sourceSwitchMarginX : 0;
				const targetMarginX = lanes.targetIsSwitch ? lanes.targetSwitchMarginX : 0;
				const sourcePos = edge.source().position();
				const targetPos = edge.target().position();
				const dx = targetPos.x - sourcePos.x;
				const dy = targetPos.y - sourcePos.y;
				const hasVerticalSwitchEndpoint = sourceIsTopBottomSwitch || targetIsTopBottomSwitch;
				const centerMarginX =
					hasVerticalSwitchEndpoint && Math.abs(dy) > Math.abs(dx) && Math.abs(centerLane) < 0.5
						? dx >= 0
							? 14
							: -14
						: 0;
				const sourceRotation = lanes.sourceIsSwitch ? 'none' : 'autorotate';
				const targetRotation = lanes.targetIsSwitch ? 'none' : 'autorotate';

				edge.style('curve-style', 'unbundled-bezier');
				edge.style('control-point-distances', `${controlPointDistance}`);
				edge.style('control-point-weights', '0.5');
				edge.style('source-text-offset', sourceOffset);
				edge.style('target-text-offset', targetOffset);
				edge.style('source-text-margin-x', sourceMarginX);
				edge.style('target-text-margin-x', targetMarginX);
				edge.style('source-text-margin-y', sourceMarginY);
				edge.style('target-text-margin-y', targetMarginY);
				edge.style('text-margin-x', centerMarginX);
				edge.style('text-margin-y', -14 + centerLane * 10);
				edge.style('source-text-rotation', sourceRotation);
				edge.style('target-text-rotation', targetRotation);
			}
		});
	}

	function applyEthernetLabelVisibility(core: cytoscape.Core, visible: boolean) {
		const physicalEdges = core.edges('[kind = "physical"]').toArray();
		core.batch(() => {
			for (const edge of physicalEdges) {
				edge.style('label', visible ? String(edge.data('label') ?? '') : '');
				edge.style('source-label', visible ? String(edge.data('sourcePort') ?? '') : '');
				edge.style('target-label', visible ? String(edge.data('targetPort') ?? '') : '');
			}
		});
	}

	function refreshVisibleGraph() {
		if (!cy) {
			return;
		}

		const visible = buildVisibleElements();
		cy.batch(() => {
			cy?.elements().remove();
			cy?.add([...visible.nodes, ...visible.edges]);
		});

		runAdaptiveLayout(cy, cameraMode);
		applyPhysicalEdgeDeconfliction(cy);
		applyEthernetLabelVisibility(cy, showEthernetLabels);
		tooltip.visible = false;

		if (selectedNodeId) {
			const selectedNode = cy.getElementById(selectedNodeId);
			if (selectedNode.empty()) {
				closeDetails();
			}
		}
	}

	function applyCameraMode(mode: CameraMode) {
		cameraMode = mode;
		if (!cy) {
			return;
		}
		runAdaptiveLayout(cy, mode);
		applyPhysicalEdgeDeconfliction(cy);
		applyEthernetLabelVisibility(cy, showEthernetLabels);
	}

	function toggleEthernetLabels() {
		showEthernetLabels = !showEthernetLabels;
		if (!cy) {
			return;
		}
		applyEthernetLabelVisibility(cy, showEthernetLabels);
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
		refreshVisibleGraph();
	}

	function toggleHostVmVisibility(hostId: string) {
		collapsedHosts = {
			...collapsedHosts,
			[hostId]: !isHostCollapsed(hostId)
		};
		refreshVisibleGraph();
	}

	function toggleSelectedMachineVmVisibility() {
		if (!selectedNodeId) {
			return;
		}
		toggleHostVmVisibility(selectedNodeId);
	}

	onMount(() => {
		let resizeHandler: (() => void) | null = null;

		const initialize = async () => {
			cy = cytoscape({
				container,
				elements: [],
				layout: { name: 'preset' },
				autoungrabify: true,
				minZoom: 0.2,
				maxZoom: 2.5,
				style: [
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
							color: '#1e293b',
							'text-outline-color': '#f8fafc',
							'text-outline-width': 1,
							width: 'data(nodeWidth)',
							height: 'data(nodeHeight)',
							'border-width': 2,
							'border-color': '#64748b',
							'background-color': '#f1f5f9'
						}
					},
					{
						selector: 'node[kind = "machine"]',
						style: {
							shape: 'round-rectangle',
							'background-color': '#bfdbfe',
							'border-color': '#3b82f6'
						}
					},
					{
						selector: 'node[kind = "vm"]',
						style: {
							shape: 'ellipse',
							'background-color': '#bbf7d0',
							'border-color': '#16a34a',
							'font-size': 10,
							'text-max-width': '120px'
						}
					},
					{
						selector: 'node[kind = "device"]',
						style: {
							shape: 'hexagon',
							'background-color': '#fde68a',
							'border-color': '#d97706'
						}
					},
					{
						selector: 'edge',
						style: {
							width: 2.2,
							'curve-style': 'bezier',
							'z-index-compare': 'manual',
							'z-index': 10,
							'target-arrow-shape': 'triangle',
							'target-arrow-color': '#64748b',
							'line-color': '#64748b',
							label: 'data(label)',
							'font-size': 9,
							'text-rotation': 'autorotate',
							color: '#0f172a',
							'text-outline-color': '#f8fafc',
							'text-outline-width': 3
						}
					},
					{
						selector: 'edge[kind = "physical"]',
						style: {
							'z-index': 30,
							'line-style': 'solid',
							'line-color': '#475569',
							'target-arrow-color': '#475569',
							'source-arrow-shape': 'none',
							'target-arrow-shape': 'none',
							label: '',
							'text-margin-y': -14,
							'source-label': '',
							'target-label': '',
							'source-text-offset': 32,
							'target-text-offset': 32,
							'source-text-margin-y': -9,
							'target-text-margin-y': 9,
							'source-text-rotation': 'autorotate',
							'target-text-rotation': 'autorotate',
							'text-background-color': '#f8fafc',
							'text-background-opacity': 1,
							'text-background-padding': '4px'
						}
					},
					{
						selector: 'edge[kind = "hosting"]',
						style: {
							'z-index': 5,
							'line-style': 'dashed',
							'line-dash-pattern': [7, 5],
							'line-color': '#94a3b8',
							'target-arrow-color': '#94a3b8',
							'font-size': 8,
							color: '#64748b'
						}
					}
				]
			});
			await reloadDataFromJsonPath();

			cy.on('tap', 'node', (event) => {
				const data = event.target.data() as GraphNodeData;
				selectedNodeId = data.id;
				selectedDetails = data.details ?? null;
			});

			cy.on('tap', (event) => {
				if (event.target === cy) {
					closeDetails();
				}
			});

			cy.on('mouseover', 'node', (event) => {
				const node = event.target;
				const renderedPosition = node.renderedPosition();
				const data = node.data() as GraphNodeData;
				tooltip = {
					visible: true,
					text: data.rawName ?? data.label,
					x: renderedPosition.x + 44,
					y: renderedPosition.y - 8
				};
			});

			cy.on('mouseout', 'node', () => {
				tooltip.visible = false;
			});

			cy.on('pan zoom', () => {
				tooltip.visible = false;
			});

			resizeHandler = () => {
				if (!cy) {
					return;
				}
				runAdaptiveLayout(cy, cameraMode);
				applyPhysicalEdgeDeconfliction(cy);
				applyEthernetLabelVisibility(cy, showEthernetLabels);
			};
			window.addEventListener('resize', resizeHandler);
		};

		void initialize();

		return () => {
			if (resizeHandler) {
				window.removeEventListener('resize', resizeHandler);
			}
			if (cy) {
				cy.destroy();
				cy = null;
			}
		};
	});
</script>

<div class="diagram-shell">
	<div class="diagram-stage">
		<div class="diagram-canvas" bind:this={container}></div>

		<div class="map-controls">
			<button type="button" on:click={reloadDataFromJsonPath} disabled={isLoadingData}>
				Reload Default JSON
			</button>
			<button
				type="button"
				class:active={cameraMode === 'readable'}
				on:click={() => applyCameraMode('readable')}
			>
				Readable Fit
			</button>
			<button
				type="button"
				class:active={cameraMode === 'overview'}
				on:click={() => applyCameraMode('overview')}
			>
				Overview
			</button>
			<button type="button" on:click={toggleEthernetLabels}>
				{showEthernetLabels ? 'Hide Ethernet Labels' : 'Show Ethernet Labels'}
			</button>
			<button
				type="button"
				on:click={() => setCollapsedStateForAll(true)}
				disabled={!hasAnyVmHosts}
			>
				Collapse All VMs
			</button>
			<button
				type="button"
				on:click={() => setCollapsedStateForAll(false)}
				disabled={!hasAnyVmHosts}
			>
				Expand All VMs
			</button>
		</div>
		<div class="data-source">Source: {dataSourceLabel}</div>
		{#if isLoadingData}
			<div class="status-chip loading">Loading JSON...</div>
		{/if}
		{#if loadError}
			<div class="status-chip error">{loadError}</div>
		{/if}

		{#if tooltip.visible}
			<div class="tooltip" style={`left: ${tooltip.x}px; top: ${tooltip.y}px;`}>
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
</div>

<Modal
	isOpen={selectedDetails !== null}
	title={selectedDetails?.name ?? ''}
	maxWidth="760px"
	on:close={closeDetails}
>
	{#if selectedDetails?.type === 'machine'}
		<div class="modal-actions">
			{#if selectedNodeId && (machineVmIndex[selectedNodeId]?.vmCount ?? 0) > 0}
				<button type="button" on:click={toggleSelectedMachineVmVisibility}>
					{collapsedHosts[selectedNodeId] ? 'Show VMs on map' : 'Hide VMs on map'}
				</button>
			{/if}
		</div>

		<div class="details-grid">
			<p><strong>IP:</strong> {selectedDetails.ip}</p>
			<p><strong>Role:</strong> {selectedDetails.role}</p>
			<p><strong>OS:</strong> {selectedDetails.os}</p>
			<p><strong>CPU:</strong> {selectedDetails.cpu}</p>
			<p><strong>RAM:</strong> {selectedDetails.ram}</p>
			{#if selectedDetails.gpu}
				<p><strong>GPU:</strong> {selectedDetails.gpu}</p>
			{/if}
		</div>

		<h4>Ports</h4>
		<ul class="details-list">
			{#if selectedDetails.ports.length === 0}
				<li>None</li>
			{:else}
				{#each selectedDetails.ports as port (port.portName)}
					<li>
						<strong>{port.portName}</strong> ({port.speedGbps ?? 1}GbE): {formatConnection(
							port.connectedTo
						)}
					</li>
				{/each}
			{/if}
		</ul>

		<h4>Virtual Machines ({selectedDetails.vmCount})</h4>
		<ul class="details-list">
			{#if selectedDetails.vms.length === 0}
				<li>None</li>
			{:else}
				{#each selectedDetails.vms as vm (`${vm.name}:${vm.ip}`)}
					<li>
						<strong>{vm.name}</strong> ({vm.role}) - {vm.ip}
					</li>
				{/each}
			{/if}
		</ul>
	{:else if selectedDetails?.type === 'device'}
		<div class="details-grid">
			<p><strong>Type:</strong> {selectedDetails.deviceType}</p>
			<p><strong>IP:</strong> {selectedDetails.ip}</p>
			{#if selectedDetails.notes}
				<p><strong>Notes:</strong> {selectedDetails.notes}</p>
			{/if}
		</div>

		<h4>Ports</h4>
		<ul class="details-list">
			{#if selectedDetails.ports.length === 0}
				<li>None</li>
			{:else}
				{#each selectedDetails.ports as port (port.portName)}
					<li>
						<strong>{port.portName}</strong> ({port.speedGbps ?? 1}GbE): {formatConnection(
							port.connectedTo
						)}
					</li>
				{/each}
			{/if}
		</ul>
	{:else if selectedDetails?.type === 'vm'}
		<div class="details-grid">
			<p><strong>Role:</strong> {selectedDetails.role}</p>
			<p><strong>IP:</strong> {selectedDetails.ip}</p>
			<p><strong>Host:</strong> {selectedDetails.hostName}</p>
		</div>
	{/if}
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
		border: 1px solid #cbd5e1;
		border-radius: 10px;
		background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
		overflow: hidden;
	}

	.diagram-canvas {
		position: absolute;
		inset: 0;
	}

	.map-controls {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		display: flex;
		gap: 0.4rem;
		z-index: 14;
		background: rgba(248, 250, 252, 0.94);
		border: 1px solid #cbd5e1;
		border-radius: 10px;
		padding: 0.4rem;
		backdrop-filter: blur(2px);
	}

	.map-controls button {
		border: 1px solid #cbd5e1;
		background: #ffffff;
		color: #0f172a;
		padding: 0.35rem 0.55rem;
		border-radius: 7px;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}

	.map-controls button.active {
		background: #0f172a;
		color: #f8fafc;
		border-color: #0f172a;
	}

	.map-controls button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.data-source {
		position: absolute;
		top: 0.75rem;
		left: 0.75rem;
		z-index: 14;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		background: rgba(248, 250, 252, 0.94);
		color: #334155;
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
		z-index: 14;
		border-radius: 8px;
		padding: 0.35rem 0.5rem;
		font-size: 0.73rem;
		font-weight: 600;
	}

	.status-chip.loading {
		top: 2.75rem;
		border: 1px solid #93c5fd;
		background: #dbeafe;
		color: #1e3a8a;
	}

	.status-chip.error {
		top: 2.75rem;
		border: 1px solid #fca5a5;
		background: #fee2e2;
		color: #7f1d1d;
		max-width: min(65vw, 560px);
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

	.warnings-panel {
		border: 1px solid #facc15;
		border-radius: 8px;
		background: #fef9c3;
		padding: 0.65rem 0.8rem;
		color: #713f12;
		font-size: 0.92rem;
	}

	.warnings-panel summary {
		cursor: pointer;
		font-weight: 600;
	}

	.warnings-panel ul {
		margin: 0.6rem 0 0;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.28rem;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 0.6rem;
	}

	.modal-actions button {
		border: 1px solid #cbd5e1;
		background: #f8fafc;
		padding: 0.4rem 0.65rem;
		border-radius: 8px;
		cursor: pointer;
		font-weight: 600;
	}

	.details-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 0.35rem 0.8rem;
		margin-bottom: 0.7rem;
	}

	.details-grid p {
		margin: 0;
	}

	h4 {
		margin: 0.8rem 0 0.35rem;
		font-size: 0.98rem;
	}

	.details-list {
		margin: 0;
		padding-left: 1.15rem;
		display: grid;
		gap: 0.3rem;
	}

	@media (max-width: 900px) {
		.map-controls {
			flex-wrap: wrap;
			max-width: min(90vw, 560px);
		}
	}
</style>
