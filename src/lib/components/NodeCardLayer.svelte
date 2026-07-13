<script lang="ts">
	import { onDestroy } from 'svelte';
	import type cytoscape from 'cytoscape';
	import { vlanPaletteColor } from '$lib/graph/vlanPalette';
	import type { GraphNodeElement } from '$lib/graph/types';

	// HTML card overlay for graph nodes. Cytoscape keeps invisible hit-target
	// nodes (interaction, layout, edge anchoring); this layer draws the actual
	// cards at the same model coordinates and mirrors pan/zoom with a single
	// container transform. pointer-events stay off so Cytoscape owns input.
	export let cy: cytoscape.Core | null = null;
	export let nodes: GraphNodeElement[] = [];
	export let dimmedIds: ReadonlySet<string> = new Set();
	export let matchedIds: ReadonlySet<string> = new Set();
	export let activeId: string | null = null;

	let viewport = { panX: 0, panY: 0, zoom: 1 };
	let positionById: Record<string, { x: number; y: number }> = {};
	let attachedCy: cytoscape.Core | null = null;
	let rafId: number | null = null;

	function syncFromCy() {
		rafId = null;
		if (!attachedCy || attachedCy.destroyed()) {
			return;
		}
		const pan = attachedCy.pan();
		viewport = { panX: pan.x, panY: pan.y, zoom: attachedCy.zoom() };
		const next: Record<string, { x: number; y: number }> = {};
		for (const node of attachedCy.nodes().toArray()) {
			const position = node.position();
			next[node.id()] = { x: position.x, y: position.y };
		}
		positionById = next;
	}

	function scheduleSync() {
		if (rafId === null) {
			rafId = requestAnimationFrame(syncFromCy);
		}
	}

	function attach(core: cytoscape.Core | null) {
		if (core === attachedCy) {
			return;
		}
		if (attachedCy && !attachedCy.destroyed()) {
			attachedCy.off('render', scheduleSync);
		}
		attachedCy = core;
		if (attachedCy) {
			// 'render' fires on pan, zoom, layout, add/remove and position
			// changes, so one rAF-throttled listener keeps cards in lockstep.
			attachedCy.on('render', scheduleSync);
			scheduleSync();
		}
	}

	$: attach(cy);
	// Re-read positions whenever the visible node set changes (refreshGraph
	// re-adds elements and re-runs layout synchronously).
	$: if (nodes && attachedCy) {
		scheduleSync();
	}

	onDestroy(() => {
		attach(null);
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
		}
	});

	function fallbackGlyph(kind: string, deviceClass: string | undefined): string {
		if (kind === 'device') {
			return deviceClass === 'infrastructure' ? '⇄' : '○';
		}
		if (kind === 'vm') {
			return '◫';
		}
		return '🖥';
	}

	// position is passed in from the template (rather than read from
	// positionById here) so Svelte's legacy-mode invalidation sees the
	// dependency and re-renders cards when positions change.
	function cardStyle(
		node: GraphNodeElement,
		position: { x: number; y: number } | undefined
	): string {
		const { data } = node;
		if (!position) {
			return 'display: none;';
		}
		const parts = [
			`left: ${position.x}px`,
			`top: ${position.y}px`,
			`width: ${data.nodeWidth}px`,
			`height: ${data.nodeHeight}px`
		];
		if (typeof data.vlanIndex === 'number') {
			parts.push(`--card-vlan: ${vlanPaletteColor(data.vlanIndex)}`);
		}
		return `${parts.join('; ')};`;
	}
</script>

<div class="card-layer" aria-hidden="true">
	<div
		class="card-plane"
		style={`transform: translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom});`}
	>
		{#each nodes as node (node.data.id)}
			{@const data = node.data}
			{@const isDumb = data.kind === 'device' && data.deviceClass !== 'infrastructure'}
			<div
				class="node-card kind-{data.kind}"
				class:infra={data.kind === 'device' && data.deviceClass === 'infrastructure'}
				class:dumb={isDumb}
				class:has-vlan={typeof data.vlanIndex === 'number'}
				class:dimmed={dimmedIds.has(data.id)}
				class:match={matchedIds.has(data.id)}
				class:active={activeId === data.id}
				style={cardStyle(node, positionById[node.data.id])}
			>
				<div class="icon-tile" class:round={isDumb}>
					{#if data.iconUrl}
						<img src={data.iconUrl} alt="" loading="lazy" />
					{:else}
						<span class="icon-fallback">{fallbackGlyph(data.kind, data.deviceClass)}</span>
					{/if}
				</div>
				<div class="card-text">
					<span class="card-name">{data.rawName ?? data.label}</span>
					{#if !isDumb && (data.meta || data.vmCount)}
						<span class="card-meta">
							{#if data.meta}{data.meta}{/if}{#if data.kind === 'machine' && (data.vmCount ?? 0) > 0}{#if data.meta}&nbsp;·
								{/if}<span class="vm-count">{data.vmCount} {data.vmCount === 1 ? 'VM' : 'VMs'}</span
								>{/if}
						</span>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.card-layer {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		z-index: 5;
	}

	.card-plane {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: 0 0;
	}

	.node-card {
		position: absolute;
		transform: translate(-50%, -50%);
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 12px 0 10px;
		background: var(--surface);
		border: 1px solid var(--graph-node-border);
		border-radius: 9px;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.07);
		transition: opacity 120ms ease;
	}

	.node-card.has-vlan {
		border-left: 4px solid var(--card-vlan);
		padding-left: 7px;
	}

	.node-card.kind-vm {
		background: var(--surface-2);
		gap: 8px;
		border-radius: 8px;
	}

	.node-card.infra {
		background: var(--graph-infra-fill);
		border-color: var(--graph-infra-border);
	}

	.node-card.dumb {
		border: 1px dashed var(--graph-dumb-border);
		border-radius: 999px;
		padding: 0 14px 0 8px;
		gap: 8px;
	}

	.node-card.dumb.has-vlan {
		border-left: 4px solid var(--card-vlan);
	}

	.node-card.dimmed {
		opacity: 0.15;
	}

	.node-card.match {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}

	.node-card.active {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent);
	}

	.icon-tile {
		width: 34px;
		height: 34px;
		border-radius: 7px;
		background: var(--surface-2);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		overflow: hidden;
	}

	.icon-tile.round {
		width: 24px;
		height: 24px;
		border-radius: 50%;
	}

	.kind-vm .icon-tile {
		width: 26px;
		height: 26px;
		background: var(--surface);
	}

	.infra .icon-tile {
		background: rgb(255 255 255 / 0.12);
	}

	:global([data-theme='dark']) .infra .icon-tile {
		background: rgb(255 255 255 / 0.09);
	}

	.icon-tile img {
		width: 76%;
		height: 76%;
		object-fit: contain;
	}

	.icon-fallback {
		font-size: 15px;
		color: var(--text-2);
	}

	.infra .icon-fallback {
		color: #e7ebf2;
	}

	.card-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.card-name {
		font-size: 13px;
		font-weight: 650;
		line-height: 1.15;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.infra .card-name {
		color: #ffffff;
	}

	:global([data-theme='dark']) .infra .card-name {
		color: var(--text);
	}

	.dumb .card-name {
		font-size: 12.5px;
		font-weight: 550;
		color: var(--text);
	}

	.kind-vm .card-name {
		font-size: 12px;
	}

	.card-meta {
		font-family: var(--font-mono);
		font-size: 10.5px;
		line-height: 1;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.infra .card-meta {
		color: #b6bfcc;
	}

	.kind-vm .card-meta {
		font-size: 10px;
	}

	.vm-count {
		color: var(--accent);
		font-weight: 600;
	}
</style>
