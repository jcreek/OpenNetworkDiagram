<script lang="ts">
	import type { VMInfo } from '../../stores/networkStore';
	export let vm: VMInfo;
</script>

<div class="vm-card">
	<p><strong>{vm.name}</strong></p>
	<p>Role: {vm.role}</p>
	<p>IP: {vm.ipAddress}</p>
</div>

<style>
	.vm-card {
		padding: 0.5rem;
		background-color: #eaeaea;
		border: 1px solid #ccc;
		border-radius: 5px;
	}
</style>
