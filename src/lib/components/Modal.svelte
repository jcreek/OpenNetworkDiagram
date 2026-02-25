<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let isOpen = false;
	export let title = '';
	export let maxWidth = '680px';

	const dispatch = createEventDispatcher<{ close: void }>();

	function closeModal() {
		dispatch('close');
	}

	function onBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			closeModal();
		}
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && isOpen) {
			closeModal();
		}
	}
</script>

<svelte:window on:keydown={onWindowKeydown} />

{#if isOpen}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div class="modal-backdrop" on:click={onBackdropClick}>
		<div class="modal-container" style={`max-width: ${maxWidth}`}>
			<header class="modal-header">
				{#if title}
					<h2>{title}</h2>
				{/if}
				<button type="button" class="close-button" on:click={closeModal} aria-label="Close">×</button>
			</header>
			<div class="modal-body">
				<slot />
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: var(--modal-overlay);
		z-index: 1000;
	}

	.modal-container {
		width: 100%;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		background: var(--panel-bg);
		border: 1px solid var(--panel-border);
		border-radius: 12px;
		box-shadow: 0 24px 48px rgba(15, 23, 42, 0.24);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.9rem 1rem;
		border-bottom: 1px solid var(--panel-border);
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.05rem;
		color: var(--panel-contrast);
	}

	.close-button {
		border: 1px solid transparent;
		background: transparent;
		color: var(--muted-text);
		font-size: 1.7rem;
		line-height: 1;
		width: 2rem;
		height: 2rem;
		border-radius: 8px;
		cursor: pointer;
	}

	.close-button:hover {
		background: var(--chip-bg);
		color: var(--panel-contrast);
	}

	.modal-body {
		padding: 1rem;
		overflow: auto;
	}

	@media (max-width: 720px) {
		.modal-backdrop {
			padding: 0;
		}

		.modal-container {
			height: 100vh;
			max-height: 100vh;
			border-radius: 0;
			border-left: 0;
			border-right: 0;
		}
	}
</style>
