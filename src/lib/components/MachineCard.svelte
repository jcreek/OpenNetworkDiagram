<script lang="ts">
	import type { Machine } from '../../lib/types';
	import VMCard from './VMCard.svelte';

	export let machine: Machine;
</script>

<div class="machine-card">
	<h2>{machine.machineName}</h2>
	<p><strong>Role:</strong> {machine.role}</p>
	<p><strong>IP Address:</strong> {machine.ipAddress}</p>
	<p><strong>OS:</strong> {machine.operatingSystem}</p>

	{#if machine.ports && machine.ports.length}
		<h4>Ports:</h4>
		<div class="ports-container">
			{#each machine.ports as port}
				<div class="port-item" data-port-key="{machine.machineName}-{port.portName}">
					<p>{port.portName} ({port.speedGbps ?? 1}GbE)</p>
					{#if port.connectedTo}
						<p>Connected to: {port.connectedTo}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- VMs -->
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
	.ports-container {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.port-item {
		background-color: #e7f1f9;
		padding: 0.5rem;
		border-radius: 4px;
	}
</style>
