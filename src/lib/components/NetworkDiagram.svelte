<script lang="ts">
	import { onMount } from 'svelte';
	import { networkStore, loadNetworkData } from '../../stores/networkStore';
	import { get } from 'svelte/store';

	import MachineCard from './MachineCard.svelte';
	import DeviceCard from './DeviceCard.svelte';

	// Optionally pass in a JSON path as a prop
	export let jsonPath: string = '/data/network.json';

	// Local state
	let data: any;

	onMount(async () => {
		// Load data into the store
		await loadNetworkData(jsonPath);

		// Subscribe once or use the $ syntax in markup
		data = get(networkStore);
	});
</script>

<main>
	{#if data}
		<div class="diagram-container">
			<!-- Render Machines -->
			{#each data.machines as machine}
				<MachineCard {machine} />
			{/each}

			<!-- Render Other Devices -->
			{#each data.devices as device}
				<DeviceCard {device} />
			{/each}
		</div>
	{/if}
</main>

<style>
	.diagram-container {
		/* Example layout style - customize as needed */
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		padding: 1rem;
	}
</style>
