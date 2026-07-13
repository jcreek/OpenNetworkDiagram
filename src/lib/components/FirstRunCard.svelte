<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let isSampleData = false;
	export let writable = false;
	export let hasMachines = false;

	const dispatch = createEventDispatcher<{
		addmachine: void;
		connectport: void;
		openipam: void;
		dismiss: void;
	}>();
</script>

<div class="first-run">
	<h2>Map your network</h2>
	{#if isSampleData}
		<p class="sample-note">This is sample data — replace it with your own machines.</p>
	{/if}
	<div class="actions">
		{#if writable}
			<button type="button" on:click={() => dispatch('addmachine')}>
				<span class="action-glyph" aria-hidden="true">+</span>
				<span class="action-text">
					<strong>Add a machine</strong>
					<span>Servers, NAS boxes, mini PCs — anything with an IP.</span>
				</span>
			</button>
		{/if}
		<button type="button" disabled={!hasMachines} on:click={() => dispatch('connectport')}>
			<span class="action-glyph" aria-hidden="true">⇄</span>
			<span class="action-text">
				<strong>Connect a port</strong>
				<span>
					{hasMachines
						? 'Open a machine and add a port to draw your first cable.'
						: 'Add a machine first, then wire up its ports.'}
				</span>
			</span>
		</button>
		<button type="button" on:click={() => dispatch('openipam')}>
			<span class="action-glyph" aria-hidden="true">⌗</span>
			<span class="action-text">
				<strong>Open IPAM</strong>
				<span>See subnet utilisation and grab the next free IP.</span>
			</span>
		</button>
	</div>
	<button type="button" class="dismiss" on:click={() => dispatch('dismiss')}>Dismiss</button>
</div>

<style>
	.first-run {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 20;
		width: min(92vw, 440px);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		box-shadow: var(--shadow-popover);
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		color: var(--text);
	}

	.sample-note {
		margin: 0;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--status-warn);
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.actions > button {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 10px 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-panel);
		cursor: pointer;
		text-align: left;
		font-family: inherit;
	}

	.actions > button:hover:not(:disabled) {
		border-color: var(--accent);
	}

	.actions > button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.action-glyph {
		width: 28px;
		height: 28px;
		border-radius: var(--radius-control);
		background: var(--surface-2);
		color: var(--accent);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 15px;
		font-weight: 700;
		flex-shrink: 0;
	}

	.action-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.action-text strong {
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text);
	}

	.action-text span {
		font-size: 12px;
		color: var(--text-2);
		line-height: 1.45;
	}

	.dismiss {
		align-self: flex-end;
		border: none;
		background: transparent;
		color: var(--text-2);
		font-size: 12.5px;
		font-family: inherit;
		cursor: pointer;
		padding: 4px 8px;
		border-radius: var(--radius-control);
	}

	.dismiss:hover {
		background: var(--surface-2);
		color: var(--text);
	}
</style>
