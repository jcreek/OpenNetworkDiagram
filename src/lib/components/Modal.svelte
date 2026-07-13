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
				<slot name="header">
					{#if title}
						<h2>{title}</h2>
					{/if}
				</slot>
				<button type="button" class="close-button" on:click={closeModal} aria-label="Close"
					>×</button
				>
			</header>
			<div class="modal-body">
				<slot />
			</div>
			{#if $$slots.footer}
				<footer class="modal-footer-bar">
					<slot name="footer" />
				</footer>
			{/if}
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
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-modal);
		box-shadow: 0 24px 64px rgb(15 18 24 / 0.35);
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 16px 20px;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}

	.modal-header h2 {
		margin: 0;
		flex: 1;
		font-size: 20px;
		font-weight: 600;
		color: var(--text);
	}

	.close-button {
		border: none;
		background: transparent;
		color: var(--text-2);
		font-size: 1.5rem;
		line-height: 1;
		width: 30px;
		height: 30px;
		border-radius: var(--radius-control);
		cursor: pointer;
		flex-shrink: 0;
		margin-left: auto;
	}

	.close-button:hover {
		background: var(--surface-2);
		color: var(--text);
	}

	.modal-body {
		padding: 20px;
		overflow: auto;
	}

	.modal-footer-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 20px;
		border-top: 1px solid var(--border);
		background: var(--surface-2);
		flex-shrink: 0;
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
