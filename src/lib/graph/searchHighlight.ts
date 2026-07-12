import type { GraphNodeDetails, GraphNodeElement, GraphTransformResult } from './types';

function collectSearchableText(node: GraphNodeElement): string[] {
	const texts: string[] = [node.data.rawName ?? node.data.label];
	const details = node.data.details as GraphNodeDetails | undefined;
	if (!details) {
		return texts;
	}

	texts.push(details.ip);
	if (details.type === 'machine') {
		texts.push(details.role, details.os);
		for (const vm of details.vms) {
			texts.push(vm.name, vm.ip, vm.role);
		}
	} else if (details.type === 'device') {
		texts.push(details.deviceType);
	} else {
		texts.push(details.role);
	}
	return texts;
}

/**
 * Returns the IDs of nodes matching the query (case-insensitive substring on
 * name, IP, role, OS and device type). When a VM matches, its host machine ID
 * is included too so hits remain visible while the host's VMs are collapsed.
 */
export function computeSearchMatches(
	transformed: Pick<GraphTransformResult, 'nodes'>,
	query: string
): Set<string> {
	const matches = new Set<string>();
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return matches;
	}

	for (const node of transformed.nodes) {
		const isMatch = collectSearchableText(node).some((text) =>
			text.toLowerCase().includes(normalized)
		);
		if (!isMatch) {
			continue;
		}
		matches.add(node.data.id);
		if (node.data.kind === 'vm' && node.data.hostMachineId) {
			matches.add(node.data.hostMachineId);
		}
	}

	return matches;
}
