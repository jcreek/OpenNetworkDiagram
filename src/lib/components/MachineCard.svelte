<script lang="ts">
	import type { Machine } from '../../stores/networkStore';
	import VMCard from './VMCard.svelte';

	export let machine: Machine;
</script>

<div class="machine-card">
	<h2>{machine.machineName}</h2>
	<p><strong>Role:</strong> {machine.role}</p>
	<p><strong>IP Address:</strong> {machine.ipAddress}</p>
	<p><strong>OS:</strong> {machine.operatingSystem}</p>

	{#if machine.software?.vms?.length}
		<details>
			<summary>Show VMs (Total: {machine.software.vms.length})</summary>
			<div class="vm-list">
				{#each machine.software.vms as vm}
					<VMCard {vm} />
				{/each}
			</div>
		</details>
	{/if}
</div>

<style>
	.machine-card {
		border: 2px solid #ddd;
		padding: 1rem;
		border-radius: 8px;
		max-width: 300px;
		background-color: #f9f9f9;
	}
	.machine-card h2 {
		margin: 0 0 0.5rem;
	}
	.vm-list {
		margin-top: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
</style>
