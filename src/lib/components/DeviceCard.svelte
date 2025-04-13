<script lang="ts">
	import type { Device } from '../../stores/networkStore';
	export let device: Device;
</script>

<div class="device-card">
	<h3>{device.name}</h3>
	<p><strong>Type:</strong> {device.type}</p>
	<p><strong>IP:</strong> {device.ipAddress}</p>
	{#if device.notes}
		<p><em>{device.notes}</em></p>
	{/if}
</div>

<style>
	.device-card {
		border: 1px dashed #aaa;
		padding: 1rem;
		border-radius: 5px;
	}
</style>
