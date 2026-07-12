import type { NetworkData, Subnet } from '../types';

export type IpOwnerKind = 'machine' | 'device' | 'vm';

export interface IpAssignment {
	ip: string;
	ownerLabel: string;
	ownerKind: IpOwnerKind;
}

export interface SubnetReport {
	cidr: string;
	name?: string;
	vlanId?: number;
	declared: boolean;
	used: number;
	capacity: number;
	members: IpAssignment[];
}

export interface IpamReport {
	subnets: SubnetReport[];
	duplicates: Array<{ ip: string; owners: string[] }>;
	unparsed: IpAssignment[];
}

/** Parses a dotted-quad IPv4 address into a 32-bit number; null for anything else ("DHCP", empty, IPv6). */
export function parseIpv4(text: string): number | null {
	const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text.trim());
	if (!match) {
		return null;
	}
	const octets = match.slice(1).map(Number);
	if (octets.some((octet) => octet > 255)) {
		return null;
	}
	return octets[0] * 2 ** 24 + octets[1] * 2 ** 16 + octets[2] * 256 + octets[3];
}

function formatIpv4(value: number): string {
	return [
		Math.floor(value / 2 ** 24) % 256,
		Math.floor(value / 2 ** 16) % 256,
		Math.floor(value / 256) % 256,
		value % 256
	].join('.');
}

export function parseCidr(cidr: string): { base: number; prefix: number } | null {
	const slash = cidr.indexOf('/');
	if (slash < 0) {
		return null;
	}
	const base = parseIpv4(cidr.slice(0, slash));
	const prefix = Number(cidr.slice(slash + 1));
	if (base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
		return null;
	}
	const hostBlock = 2 ** (32 - prefix);
	return { base: Math.floor(base / hostBlock) * hostBlock, prefix };
}

export function cidrContains(cidr: string, ip: string): boolean {
	const parsed = parseCidr(cidr);
	const value = parseIpv4(ip);
	if (!parsed || value === null) {
		return false;
	}
	const hostBlock = 2 ** (32 - parsed.prefix);
	return Math.floor(value / hostBlock) * hostBlock === parsed.base;
}

export function inferSlash24(ip: string): string | null {
	const value = parseIpv4(ip);
	if (value === null) {
		return null;
	}
	return `${formatIpv4(Math.floor(value / 256) * 256)}/24`;
}

export function collectIpAssignments(data: NetworkData): IpAssignment[] {
	const assignments: IpAssignment[] = [];
	for (const machine of data.machines) {
		assignments.push({
			ip: machine.ipAddress,
			ownerLabel: machine.machineName,
			ownerKind: 'machine'
		});
		for (const vm of machine.software?.vms ?? []) {
			assignments.push({
				ip: vm.ipAddress,
				ownerLabel: `${vm.name} (VM on ${machine.machineName})`,
				ownerKind: 'vm'
			});
		}
	}
	for (const device of data.devices) {
		assignments.push({ ip: device.ipAddress, ownerLabel: device.name, ownerKind: 'device' });
	}
	return assignments;
}

function hostCapacity(prefix: number): number {
	if (prefix >= 31) {
		return prefix === 31 ? 2 : 1;
	}
	return 2 ** (32 - prefix) - 2;
}

export function buildIpamReport(data: NetworkData): IpamReport {
	const assignments = collectIpAssignments(data);
	const declared = data.subnets ?? [];

	const parsed: Array<IpAssignment & { value: number }> = [];
	const unparsed: IpAssignment[] = [];
	for (const assignment of assignments) {
		const value = parseIpv4(assignment.ip);
		if (value === null) {
			unparsed.push(assignment);
		} else {
			parsed.push({ ...assignment, value });
		}
	}

	const byIp = new Map<string, IpAssignment[]>();
	for (const assignment of parsed) {
		const normalizedIp = formatIpv4(assignment.value);
		const owners = byIp.get(normalizedIp) ?? [];
		owners.push(assignment);
		byIp.set(normalizedIp, owners);
	}
	const duplicates = [...byIp.entries()]
		.filter(([, owners]) => owners.length > 1)
		.map(([ip, owners]) => ({ ip, owners: owners.map((owner) => owner.ownerLabel) }))
		.sort((a, b) => (parseIpv4(a.ip) ?? 0) - (parseIpv4(b.ip) ?? 0));

	const subnets: SubnetReport[] = [];
	const claimed = new Set<IpAssignment>();

	const declaredSorted = [...declared].sort(
		(a, b) => (parseCidr(b.cidr)?.prefix ?? 0) - (parseCidr(a.cidr)?.prefix ?? 0)
	);
	const reportBySubnet = new Map<Subnet, IpAssignment[]>();
	for (const subnet of declaredSorted) {
		reportBySubnet.set(subnet, []);
	}
	for (const assignment of parsed) {
		// most-specific declared subnet wins; each IP is counted once
		const home = declaredSorted.find((subnet) => cidrContains(subnet.cidr, assignment.ip));
		if (home) {
			reportBySubnet.get(home)?.push(assignment);
			claimed.add(assignment);
		}
	}
	for (const subnet of declared) {
		const members = (reportBySubnet.get(subnet) ?? []).sort(
			(a, b) => (parseIpv4(a.ip) ?? 0) - (parseIpv4(b.ip) ?? 0)
		);
		const prefix = parseCidr(subnet.cidr)?.prefix ?? 24;
		subnets.push({
			cidr: subnet.cidr,
			name: subnet.name,
			vlanId: subnet.vlanId,
			declared: true,
			used: new Set(members.map((member) => member.ip)).size,
			capacity: hostCapacity(prefix),
			members
		});
	}

	const inferredGroups = new Map<string, IpAssignment[]>();
	for (const assignment of parsed) {
		if (claimed.has(assignment)) {
			continue;
		}
		const inferred = inferSlash24(assignment.ip);
		if (!inferred) {
			continue;
		}
		const members = inferredGroups.get(inferred) ?? [];
		members.push(assignment);
		inferredGroups.set(inferred, members);
	}
	const inferredSorted = [...inferredGroups.entries()].sort(
		(a, b) => (parseCidr(a[0])?.base ?? 0) - (parseCidr(b[0])?.base ?? 0)
	);
	for (const [cidr, members] of inferredSorted) {
		members.sort((a, b) => (parseIpv4(a.ip) ?? 0) - (parseIpv4(b.ip) ?? 0));
		subnets.push({
			cidr,
			declared: false,
			used: new Set(members.map((member) => member.ip)).size,
			capacity: hostCapacity(24),
			members
		});
	}

	return { subnets, duplicates, unparsed };
}

/**
 * Lowest unused host address in the subnet, skipping the network address,
 * broadcast address and .1 (conventionally the gateway). Defaults to the
 * most-populated subnet when no CIDR is given.
 */
export function suggestNextFreeIp(data: NetworkData, cidr?: string): string | null {
	const report = buildIpamReport(data);
	const target = cidr
		? (report.subnets.find((subnet) => subnet.cidr === cidr) ??
			(parseCidr(cidr) ? { cidr, members: [] as IpAssignment[] } : undefined))
		: [...report.subnets].sort((a, b) => b.used - a.used)[0];
	if (!target) {
		return null;
	}
	const parsed = parseCidr(target.cidr);
	if (!parsed || parsed.prefix > 30) {
		return null;
	}

	const used = new Set<number>();
	for (const assignment of collectIpAssignments(data)) {
		const value = parseIpv4(assignment.ip);
		if (value !== null) {
			used.add(value);
		}
	}

	const size = 2 ** (32 - parsed.prefix);
	const first = parsed.base + 1;
	const last = parsed.base + size - 2;
	for (let candidate = first; candidate <= last; candidate += 1) {
		if (candidate % 256 === 1) {
			continue;
		}
		if (!used.has(candidate)) {
			return formatIpv4(candidate);
		}
	}
	return null;
}
