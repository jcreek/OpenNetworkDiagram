<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	import { resolveIconPath } from '$lib/config/iconRegistry';
	import type { RackLayout, RackSlot } from '$lib/data/rackLayout';

	export let layout: RackLayout;

	const dispatch = createEventDispatcher<{
		select: { kind: RackSlot['kind']; name: string };
	}>();

	const unitHeightPx = 34;

	function slotStyle(slot: RackSlot, rackHeightU: number): string {
		const top = (rackHeightU - (slot.unit + slot.heightU - 1)) * unitHeightPx;
		const laneWidth = `(100% - 2.45rem) / ${slot.laneCount}`;
		const left = `calc(2.1rem + (${laneWidth}) * ${slot.laneIndex})`;
		const width = `calc(${laneWidth} - 4px)`;
		return `top: ${top}px; height: ${slot.heightU * unitHeightPx - 4}px; left: ${left}; width: ${width};`;
	}
</script>

<div class="rack-view">
	{#if layout.racks.length === 0}
		<div class="rack-empty">
			<h3>No rack placements yet</h3>
			<p>
				Open a machine or device and fill in the Rack section (rack name + U position) to see it
				here.
			</p>
		</div>
	{:else}
		<div class="rack-columns">
			{#each layout.racks as rack (rack.name)}
				<div class="rack-column">
					<h3>{rack.name} <span class="rack-height-tag">{rack.heightU}U</span></h3>
					<div class="rack-frame" style={`height: ${rack.heightU * unitHeightPx}px;`}>
						{#each Array.from({ length: rack.heightU }, (_, i) => rack.heightU - i) as unit (unit)}
							<div class="rack-unit-row" style={`height: ${unitHeightPx}px;`}>
								<span class="rack-unit-label">{unit}</span>
							</div>
						{/each}
						{#each rack.slots as slot (`${slot.kind}:${slot.name}`)}
							<button
								type="button"
								class="rack-slot"
								class:machine={slot.kind === 'machine'}
								class:device={slot.kind === 'device'}
								style={slotStyle(slot, rack.heightU)}
								title={`${slot.name} — U${slot.unit}${slot.heightU > 1 ? `–U${slot.unit + slot.heightU - 1}` : ''}`}
								on:click={() => dispatch('select', { kind: slot.kind, name: slot.name })}
							>
								{#if resolveIconPath(slot.iconKey)}
									<img src={resolveIconPath(slot.iconKey)} alt="" loading="lazy" />
								{/if}
								<span class="rack-slot-text">
									<span class="rack-slot-name">{slot.name}</span>
									<span class="rack-slot-subtitle">{slot.subtitle}</span>
								</span>
								<span class="rack-slot-units">{slot.heightU}U</span>
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
		{#if layout.unracked.length > 0}
			<details class="unracked">
				<summary>
					{layout.unracked.length}
					{layout.unracked.length === 1 ? 'entity is' : 'entities are'} not rack-mounted
				</summary>
				<div class="unracked-list">
					{#each layout.unracked as entity (`${entity.kind}:${entity.name}`)}
						<button
							type="button"
							class="unracked-item"
							title="Open the editor to place this in a rack"
							on:click={() => dispatch('select', { kind: entity.kind, name: entity.name })}
						>
							{#if resolveIconPath(entity.iconKey)}
								<img src={resolveIconPath(entity.iconKey)} alt="" loading="lazy" />
							{:else}
								<span class="unracked-glyph" aria-hidden="true">
									{entity.kind === 'machine' ? '🖥' : '○'}
								</span>
							{/if}
							<span class="unracked-name">{entity.name}</span>
							<span class="unracked-kind">{entity.subtitle || entity.kind}</span>
						</button>
					{/each}
				</div>
			</details>
		{/if}
	{/if}
</div>

<style>
	.rack-view {
		position: absolute;
		inset: 0;
		overflow: auto;
		padding: 1.25rem 1rem 1rem;
		background: var(--bg-canvas, transparent);
	}

	.rack-empty {
		max-width: 420px;
		margin: 4rem auto 0;
		text-align: center;
		color: var(--muted-text);
	}

	.rack-empty h3 {
		margin: 0 0 0.5rem;
		color: var(--panel-contrast);
	}

	.rack-columns {
		display: flex;
		gap: 2rem;
		align-items: flex-end;
		justify-content: center;
		flex-wrap: wrap;
	}

	.rack-column h3 {
		margin: 0 0 0.5rem;
		text-align: center;
		font-size: 0.95rem;
		color: var(--panel-contrast);
	}

	.rack-height-tag {
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--muted-text);
	}

	.rack-frame {
		position: relative;
		width: min(86vw, 340px);
		border: 2px solid var(--panel-border);
		border-radius: 8px;
		background: color-mix(in oklab, var(--panel-bg) 88%, transparent 12%);
		overflow: hidden;
	}

	.rack-unit-row {
		display: flex;
		align-items: center;
		border-bottom: 1px dashed color-mix(in oklab, var(--panel-border) 55%, transparent 45%);
		box-sizing: border-box;
	}

	.rack-unit-row:last-child {
		border-bottom: none;
	}

	.rack-unit-label {
		width: 1.9rem;
		text-align: center;
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--muted-text);
	}

	.rack-slot {
		position: absolute;
		margin-top: 2px;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid;
		border-radius: 6px;
		padding: 0.15rem 0.5rem;
		cursor: pointer;
		text-align: left;
		overflow: hidden;
		box-sizing: border-box;
	}

	.rack-slot.machine {
		background: var(--surface);
		border-color: var(--border);
	}

	.rack-slot.device {
		background: var(--surface-2);
		border-color: var(--border);
	}

	.rack-slot:hover {
		border-color: var(--accent);
	}

	.rack-slot img {
		width: 1.4rem;
		height: 1.4rem;
		object-fit: contain;
		flex-shrink: 0;
	}

	.rack-slot-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.rack-slot-name {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--panel-contrast);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.rack-slot-subtitle {
		font-size: 0.66rem;
		font-weight: 600;
		color: var(--muted-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.rack-slot-units {
		font-size: 0.64rem;
		font-weight: 700;
		color: var(--muted-text);
		flex-shrink: 0;
	}

	.unracked {
		max-width: 560px;
		margin: 1.25rem auto 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		padding: 0.5rem 0.8rem;
	}

	.unracked summary {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-2);
		cursor: pointer;
	}

	.unracked-list {
		display: flex;
		flex-direction: column;
		margin-top: 0.4rem;
	}

	.unracked-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border: none;
		background: transparent;
		padding: 0.35rem 0.4rem;
		border-radius: var(--radius-control);
		cursor: pointer;
		text-align: left;
		font-family: inherit;
	}

	.unracked-item:hover {
		background: var(--surface-2);
	}

	.unracked-item img {
		width: 1.1rem;
		height: 1.1rem;
		object-fit: contain;
	}

	.unracked-glyph {
		width: 1.1rem;
		text-align: center;
		font-size: 0.8rem;
		color: var(--text-2);
	}

	.unracked-name {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text);
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.unracked-kind {
		font-size: 0.7rem;
		color: var(--text-2);
		white-space: nowrap;
	}
</style>
