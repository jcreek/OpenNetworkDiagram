<script lang="ts">
	import type { NetworkDevice } from '../../lib/types';
	export let device: NetworkDevice;
</script>

<div class="device-card">
	<h3>{device.name}</h3>
	<p><strong>Type:</strong> {device.type}</p>
	<p><strong>IP:</strong> {device.ipAddress}</p>
	{#if device.notes}
		<p><em>{device.notes}</em></p>
	{/if}

	{#if device.ports && device.ports.length}
		<h4>Ports:</h4>
		<div class="ports-container">
			{#each device.ports as port}
				<div class="port-item" data-port-key={device.name + '-' + port.portName}>
					<p>{port.portName} ({port.speedGbps ?? 1}GbE)</p>
					{#if port.connectedTo}
						<p>Connected to: {port.connectedTo}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.device-card {
		border: 1px dashed #aaa;
		padding: 1rem;
		border-radius: 5px;
		max-width: 300px;
	}
	.ports-container {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.port-item {
		background-color: #ffe7d6;
		padding: 0.5rem;
		border-radius: 4px;
	}
</style>
