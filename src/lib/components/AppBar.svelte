<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import clickOutside from '$lib/actions/clickOutside';

	type DiagramViewMode = 'network' | 'device' | 'rack';
	type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

	export let dataSourceLabel = '';
	export let saveState: SaveState = 'saved';
	export let writable = false;
	export let hasLoadedInitialData = false;
	export let readOnlyNotice = '';
	export let saveError: string | null = null;
	export let isLoadingData = false;

	export let viewMode: DiagramViewMode = 'network';
	export let searchQuery = '';
	export let searchCountLabel = '';

	export let showEthernetLabels = false;
	export let showCableSpeeds = true;
	export let showVms = true;
	export let hasAnyVmHosts = false;
	export let ipamOpen = false;
	export let theme: 'light' | 'dark' = 'light';

	const dispatch = createEventDispatcher<{
		viewchange: DiagramViewMode;
		search: void;
		searchcycle: { direction: 1 | -1 };
		clearsearch: void;
		addmachine: void;
		adddevice: void;
		toggleipam: void;
		ethernetlabels: boolean;
		cablespeeds: boolean;
		showvms: boolean;
		exportpng: void;
		reload: void;
		toggletheme: void;
	}>();

	let addMenuOpen = false;
	let displayMenuOpen = false;
	let searchInput: HTMLInputElement;

	export function focusSearch() {
		searchInput?.focus();
	}

	$: fileName = dataSourceLabel.split('/').pop() || dataSourceLabel;
	$: status = (() => {
		if (isLoadingData) {
			return { text: 'Loading…', kind: 'muted', title: undefined as string | undefined };
		}
		if (hasLoadedInitialData && !writable) {
			return { text: '⬦ Read-only', kind: 'warn', title: readOnlyNotice };
		}
		if (saveState === 'saving') {
			return { text: 'Saving…', kind: 'muted', title: undefined };
		}
		if (saveState === 'error') {
			return { text: '⚠ Save failed', kind: 'danger', title: saveError ?? undefined };
		}
		if (saveState === 'unsaved') {
			return { text: 'Unsaved changes', kind: 'muted', title: undefined };
		}
		return { text: '✓ Saved', kind: 'ok', title: undefined };
	})();

	const views: Array<{ id: DiagramViewMode; label: string }> = [
		{ id: 'network', label: 'Network' },
		{ id: 'device', label: 'Hosts & VMs' },
		{ id: 'rack', label: 'Rack' }
	];

	function selectView(mode: DiagramViewMode) {
		if (mode !== viewMode) {
			dispatch('viewchange', mode);
		}
	}

	function onViewSelectChange(event: Event) {
		selectView((event.currentTarget as HTMLSelectElement).value as DiagramViewMode);
	}

	function onSearchKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			dispatch('searchcycle', { direction: event.shiftKey ? -1 : 1 });
		} else if (event.key === 'Escape') {
			event.preventDefault();
			dispatch('clearsearch');
			searchInput?.blur();
		}
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && (addMenuOpen || displayMenuOpen)) {
			addMenuOpen = false;
			displayMenuOpen = false;
		}
	}
</script>

<svelte:window on:keydown={onWindowKeydown} />

<header class="app-bar">
	<div class="identity" title={dataSourceLabel}>
		<div class="glyph" aria-hidden="true">◆</div>
		<div class="identity-text">
			<span class="file-name">{fileName}</span>
			<span class="status status-{status.kind}" title={status.title}>{status.text}</span>
		</div>
	</div>

	<div class="views">
		<div class="seg" role="radiogroup" aria-label="Diagram view">
			{#each views as view (view.id)}
				<label class="seg-option" class:checked={viewMode === view.id}>
					<input
						type="radio"
						name="diagram-view"
						value={view.id}
						checked={viewMode === view.id}
						on:change={() => selectView(view.id)}
					/>
					{view.label}
				</label>
			{/each}
		</div>
		<select
			class="seg-select"
			value={viewMode}
			aria-label="Select diagram view"
			on:change={onViewSelectChange}
		>
			{#each views as view (view.id)}
				<option value={view.id}>{view.label}</option>
			{/each}
		</select>
	</div>

	<div class="actions">
		<div class="search" class:has-query={searchQuery.trim()}>
			<span class="search-glyph" aria-hidden="true">⌕</span>
			<input
				type="text"
				placeholder="Find name, IP, VM…"
				aria-label="Search diagram nodes"
				bind:this={searchInput}
				bind:value={searchQuery}
				on:input={() => dispatch('search')}
				on:keydown={onSearchKeydown}
			/>
			{#if searchQuery.trim()}
				<span class="search-count">{searchCountLabel}</span>
				<button
					type="button"
					class="search-clear"
					aria-label="Clear search"
					title="Clear search"
					on:click={() => dispatch('clearsearch')}
				>
					×
				</button>
			{:else}
				<kbd class="search-kbd" aria-hidden="true">/</kbd>
			{/if}
		</div>

		<div class="menu-anchor" use:clickOutside={() => (addMenuOpen = false)}>
			<button
				type="button"
				class="btn-primary"
				disabled={!writable}
				title={!writable ? readOnlyNotice : undefined}
				aria-haspopup="menu"
				aria-expanded={addMenuOpen}
				on:click={() => (addMenuOpen = !addMenuOpen)}
			>
				+ <span class="btn-text">Add</span> <span class="caret" aria-hidden="true">▾</span>
			</button>
			{#if addMenuOpen}
				<div class="menu" role="menu">
					<button
						type="button"
						role="menuitem"
						on:click={() => {
							addMenuOpen = false;
							dispatch('addmachine');
						}}
					>
						Machine
					</button>
					<button
						type="button"
						role="menuitem"
						on:click={() => {
							addMenuOpen = false;
							dispatch('adddevice');
						}}
					>
						Device
					</button>
				</div>
			{/if}
		</div>

		<button
			type="button"
			class="btn-secondary"
			class:active={ipamOpen}
			on:click={() => dispatch('toggleipam')}
		>
			IPAM
		</button>

		<div class="divider" aria-hidden="true"></div>

		<div class="menu-anchor" use:clickOutside={() => (displayMenuOpen = false)}>
			<button
				type="button"
				class="btn-quiet"
				aria-haspopup="menu"
				aria-expanded={displayMenuOpen}
				on:click={() => (displayMenuOpen = !displayMenuOpen)}
			>
				<span class="btn-text">Display</span><span class="btn-text-narrow" aria-hidden="true"
					>⚙</span
				>
				<span class="caret" aria-hidden="true">▾</span>
			</button>
			{#if displayMenuOpen}
				<div class="menu display-menu">
					<div class="menu-title">Display</div>
					<label
						class="menu-toggle"
						class:disabled={viewMode !== 'network'}
						title={viewMode !== 'network'
							? 'Ethernet labels are available in Network view.'
							: undefined}
					>
						<span>Ethernet labels</span>
						<input
							class="toggle-input"
							type="checkbox"
							checked={showEthernetLabels}
							disabled={viewMode !== 'network'}
							on:change={(event) => dispatch('ethernetlabels', event.currentTarget.checked)}
						/>
						<span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
					</label>
					<label
						class="menu-toggle"
						class:disabled={viewMode !== 'network' || !showEthernetLabels}
						title={viewMode !== 'network' || !showEthernetLabels
							? 'Cable speeds show inside ethernet labels.'
							: undefined}
					>
						<span>Cable speeds</span>
						<input
							class="toggle-input"
							type="checkbox"
							checked={showCableSpeeds}
							disabled={viewMode !== 'network' || !showEthernetLabels}
							on:change={(event) => dispatch('cablespeeds', event.currentTarget.checked)}
						/>
						<span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
					</label>
					<label class="menu-toggle" class:disabled={!hasAnyVmHosts}>
						<span>Show VMs</span>
						<input
							class="toggle-input"
							type="checkbox"
							checked={showVms}
							disabled={!hasAnyVmHosts}
							on:change={(event) => dispatch('showvms', event.currentTarget.checked)}
						/>
						<span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
					</label>
					<div class="menu-rule" aria-hidden="true"></div>
					<button
						type="button"
						role="menuitem"
						disabled={viewMode === 'rack'}
						title={viewMode === 'rack' ? 'PNG export is available in the graph views.' : undefined}
						on:click={() => {
							displayMenuOpen = false;
							dispatch('exportpng');
						}}
					>
						Export PNG…
					</button>
					<button
						type="button"
						role="menuitem"
						disabled={isLoadingData}
						on:click={() => {
							displayMenuOpen = false;
							dispatch('reload');
						}}
					>
						Reload from disk
					</button>
				</div>
			{/if}
		</div>

		<button
			type="button"
			class="btn-icon"
			aria-label="Toggle dark mode"
			title="Toggle dark mode"
			on:click={() => dispatch('toggletheme')}
		>
			{theme === 'dark' ? '☀' : '☾'}
		</button>
	</div>
</header>

<style>
	.app-bar {
		display: flex;
		align-items: center;
		gap: 16px;
		height: 48px;
		padding: 0 14px;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}

	/* Left: identity + status */
	.identity {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
	}

	.glyph {
		width: 24px;
		height: 24px;
		border-radius: var(--radius-control);
		background: var(--accent);
		color: var(--surface);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		font-weight: 700;
		flex-shrink: 0;
	}

	.identity-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.file-name {
		font-size: 13px;
		font-weight: 650;
		line-height: 1;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.status {
		font-size: 10.5px;
		line-height: 1;
		white-space: nowrap;
	}

	.status-ok {
		color: var(--status-ok);
	}

	.status-warn {
		color: var(--status-warn);
	}

	.status-danger {
		color: var(--danger);
	}

	.status-muted {
		color: var(--text-2);
	}

	/* Centre: segmented view control */
	.views {
		margin: 0 auto 0 24px;
	}

	.seg {
		display: flex;
		background: var(--surface-2);
		border-radius: 7px;
		padding: 3px;
		gap: 2px;
	}

	.seg-option {
		padding: 5px 14px;
		border-radius: 5px;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-2);
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
	}

	.seg-option input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.seg-option.checked {
		background: var(--surface);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
		font-weight: 600;
		color: var(--text);
	}

	.seg-option:focus-within {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	.seg-select {
		display: none;
		height: var(--control-h);
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		background: var(--surface);
		color: var(--text);
		font-size: 13px;
		font-family: inherit;
	}

	/* Right cluster */
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.search {
		display: flex;
		align-items: center;
		gap: 7px;
		height: var(--control-h);
		width: 220px;
		padding: 0 10px;
		background: var(--surface-2);
		border: 1px solid transparent;
		border-radius: var(--radius-control);
		box-sizing: border-box;
	}

	.search:focus-within {
		border-color: var(--accent);
		background: var(--surface);
	}

	.search-glyph {
		color: var(--text-2);
		font-size: 13px;
		flex-shrink: 0;
	}

	.search input {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		color: var(--text);
		font-size: 13px;
		font-family: inherit;
		outline: none;
	}

	.search input::placeholder {
		color: var(--text-2);
		opacity: 0.75;
	}

	.search-kbd {
		font-size: 10px;
		color: var(--text-2);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 1px 5px;
		background: var(--surface);
		font-family: var(--font-mono);
	}

	.search-count {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-2);
		white-space: nowrap;
	}

	.search-clear {
		border: none;
		background: transparent;
		color: var(--text-2);
		font-size: 14px;
		cursor: pointer;
		padding: 0 2px;
		line-height: 1;
	}

	.search-clear:hover {
		color: var(--text);
	}

	/* Buttons */
	.btn-primary,
	.btn-secondary,
	.btn-quiet,
	.btn-icon {
		height: var(--control-h);
		border-radius: var(--radius-control);
		font-size: 13px;
		font-family: inherit;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		white-space: nowrap;
	}

	.btn-primary {
		padding: 0 13px;
		background: var(--accent);
		color: var(--surface);
		border: none;
		font-weight: 600;
	}

	.btn-primary:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.btn-secondary {
		padding: 0 12px;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		font-weight: 500;
	}

	.btn-secondary.active {
		border-color: var(--accent);
		color: var(--accent);
	}

	.btn-quiet {
		padding: 0 12px;
		background: transparent;
		color: var(--text-2);
		border: none;
		font-weight: 500;
	}

	.btn-quiet:hover,
	.btn-icon:hover {
		background: var(--surface-2);
	}

	.btn-icon {
		width: var(--control-h);
		justify-content: center;
		background: transparent;
		color: var(--text-2);
		border: none;
		font-size: 15px;
	}

	.caret {
		font-size: 9px;
		opacity: 0.8;
	}

	.btn-text-narrow {
		display: none;
	}

	.divider {
		width: 1px;
		height: 20px;
		background: var(--border);
	}

	/* Menus */
	.menu-anchor {
		position: relative;
	}

	.menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		min-width: 170px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		box-shadow: var(--shadow-popover);
		padding: 6px;
		display: flex;
		flex-direction: column;
		z-index: 40;
	}

	.display-menu {
		width: 250px;
	}

	.menu-title {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-2);
		padding: 6px 10px 4px;
	}

	.menu > button {
		display: flex;
		align-items: center;
		padding: 7px 10px;
		border: none;
		background: transparent;
		color: var(--text);
		font-size: 13px;
		font-family: inherit;
		text-align: left;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.menu > button:hover:not(:disabled) {
		background: var(--surface-2);
	}

	.menu > button:disabled {
		color: var(--text-2);
		opacity: 0.6;
		cursor: not-allowed;
	}

	.menu-rule {
		height: 1px;
		background: var(--border);
		margin: 6px 4px;
	}

	.menu-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 7px 10px;
		border-radius: var(--radius-control);
		font-size: 13px;
		color: var(--text);
		cursor: pointer;
	}

	.menu-toggle.disabled {
		color: var(--text-2);
		opacity: 0.6;
		cursor: not-allowed;
	}

	.toggle-input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.toggle-track {
		display: inline-flex;
		width: 32px;
		height: 19px;
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
		width: 15px;
		height: 15px;
		background: var(--surface);
		border-radius: 50%;
		transition: transform 120ms ease;
	}

	.toggle-input:checked + .toggle-track {
		background: var(--accent);
	}

	.toggle-input:checked + .toggle-track .toggle-thumb {
		transform: translateX(13px);
	}

	.toggle-input:focus-visible + .toggle-track {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	/* Responsive */
	@media (max-width: 800px) {
		.app-bar {
			gap: 10px;
			padding: 0 10px;
		}

		.views {
			margin-left: 10px;
		}

		.seg {
			display: none;
		}

		.seg-select {
			display: block;
		}

		.search {
			width: 36px;
			padding: 0 9px;
			transition: width 140ms ease;
		}

		.search:focus-within,
		.search.has-query {
			width: 180px;
		}

		.search-kbd {
			display: none;
		}

		.btn-text {
			display: none;
		}

		.btn-text-narrow {
			display: inline;
		}

		.identity-text {
			display: none;
		}
	}

	/* Phone widths: shed the divider and tighten spacing so the single row
	   never overflows the viewport. */
	@media (max-width: 480px) {
		.app-bar {
			gap: 6px;
			padding: 0 8px;
		}

		.views {
			margin-left: 2px;
			min-width: 0;
		}

		.seg-select {
			max-width: 108px;
		}

		.actions {
			gap: 4px;
		}

		.divider {
			display: none;
		}

		.btn-primary,
		.btn-secondary,
		.btn-quiet {
			padding: 0 9px;
		}

		.caret {
			display: none;
		}

		.search:focus-within,
		.search.has-query {
			width: 140px;
		}
	}
</style>
