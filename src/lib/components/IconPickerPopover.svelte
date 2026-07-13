<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { listIconDefinitions } from '$lib/config/iconRegistry';
	import clickOutside from '$lib/actions/clickOutside';

	// Anchored popover for choosing an icon. The parent positions it (the
	// wrapper just needs position: relative); selection is reported via the
	// `select` event and the popover closes itself on outside click/Escape.
	export let currentIconKey: string | undefined = undefined;

	const dispatch = createEventDispatcher<{ select: string; close: void }>();

	const iconDefinitions = listIconDefinitions();
	const iconResultLimit = 100;

	let iconSearch = '';

	function focusInput(node: HTMLInputElement) {
		node.focus();
	}

	function normalize(value: string): string {
		return value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.trim();
	}

	$: searchTokens = normalize(iconSearch).split(' ').filter(Boolean);
	$: filteredIcons = iconDefinitions.filter((icon) => {
		if (searchTokens.length === 0) {
			return true;
		}
		const searchable = normalize(`${icon.label} ${icon.key}`);
		return searchTokens.every((token) => searchable.includes(token));
	});
	$: visibleIcons = filteredIcons.slice(0, iconResultLimit);

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			dispatch('close');
		}
	}
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="icon-popover" use:clickOutside={() => dispatch('close')} on:keydown={onKeydown}>
	<input
		type="text"
		placeholder="Search icons…"
		aria-label="Search icons"
		bind:value={iconSearch}
		use:focusInput
	/>
	<div class="results-meta">
		Showing {visibleIcons.length} of {filteredIcons.length} icons
	</div>
	{#if visibleIcons.length > 0}
		<div class="results-grid" role="listbox" aria-label="Icon results">
			{#each visibleIcons as icon (icon.key)}
				<button
					type="button"
					role="option"
					aria-selected={icon.key === currentIconKey}
					class:selected={icon.key === currentIconKey}
					title={icon.label}
					on:click={() => dispatch('select', icon.key)}
				>
					<img src={icon.path} alt="" loading="lazy" />
					<span>{icon.label}</span>
				</button>
			{/each}
		</div>
	{:else}
		<div class="no-results">No icons match your search.</div>
	{/if}
	{#if currentIconKey}
		<div class="popover-footer">
			<button type="button" class="clear-icon" on:click={() => dispatch('select', '')}>
				Remove icon
			</button>
		</div>
	{/if}
</div>

<style>
	.icon-popover {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 30;
		width: min(420px, 80vw);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		box-shadow: var(--shadow-popover);
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	input {
		height: var(--control-h);
		padding: 0 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		background: var(--surface);
		color: var(--text);
		font-size: 13.5px;
		font-family: inherit;
		box-sizing: border-box;
	}

	input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.results-meta {
		font-size: 11px;
		color: var(--text-2);
	}

	.results-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
		gap: 6px;
		max-height: 260px;
		overflow: auto;
	}

	.results-grid button {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 5px;
		padding: 8px 4px;
		border: 1px solid transparent;
		border-radius: var(--radius-control);
		background: transparent;
		cursor: pointer;
		font-family: inherit;
	}

	.results-grid button:hover {
		background: var(--surface-2);
	}

	.results-grid button.selected {
		border-color: var(--accent);
	}

	.results-grid img {
		width: 28px;
		height: 28px;
		object-fit: contain;
	}

	.results-grid span {
		font-size: 10.5px;
		color: var(--text-2);
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.no-results {
		font-size: 12.5px;
		color: var(--text-2);
		padding: 12px 4px;
	}

	.popover-footer {
		border-top: 1px solid var(--surface-2);
		padding-top: 8px;
	}

	.clear-icon {
		border: none;
		background: transparent;
		color: var(--text-2);
		font-size: 12.5px;
		font-family: inherit;
		cursor: pointer;
		padding: 4px 6px;
		border-radius: var(--radius-control);
	}

	.clear-icon:hover {
		background: var(--surface-2);
		color: var(--danger);
	}
</style>
