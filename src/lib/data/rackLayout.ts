import type { NetworkData } from '../types';

export interface RackSlot {
	kind: 'machine' | 'device';
	name: string;
	index: number;
	unit: number;
	heightU: number;
	iconKey?: string;
	subtitle: string;
	/** Horizontal lane when several items share the same U (e.g. on a shelf). */
	laneIndex: number;
	laneCount: number;
}

export interface RackColumn {
	name: string;
	heightU: number;
	declared: boolean;
	declaredHeightU?: number;
	slots: RackSlot[];
}

export interface UnrackedEntity {
	kind: 'machine' | 'device';
	name: string;
	iconKey?: string;
	subtitle: string;
}

export interface RackLayout {
	racks: RackColumn[];
	warnings: string[];
	unrackedCount: number;
	unracked: UnrackedEntity[];
}

const minimumRackHeightU = 12;

function slotsOverlap(a: RackSlot, b: RackSlot): boolean {
	const aTop = a.unit + a.heightU - 1;
	const bTop = b.unit + b.heightU - 1;
	return a.unit <= bTop && b.unit <= aTop;
}

function sameRange(a: RackSlot, b: RackSlot): boolean {
	return a.unit === b.unit && a.heightU === b.heightU;
}

/**
 * Assigns horizontal lanes so overlapping items render side by side.
 * Items occupying the exact same U range are treated as sharing a shelf and
 * do not warn; partially overlapping ranges are reported as conflicts.
 */
function assignLanes(slots: RackSlot[], rackName: string, warnings: string[]) {
	// connected components of the overlap graph
	const componentOf = new Map<RackSlot, number>();
	let componentCount = 0;
	for (const slot of slots) {
		const touching = slots.filter((other) => componentOf.has(other) && slotsOverlap(slot, other));
		const componentIds = new Set(touching.map((other) => componentOf.get(other) ?? 0));
		if (componentIds.size === 0) {
			componentOf.set(slot, componentCount);
			componentCount += 1;
			continue;
		}
		const [target] = [...componentIds].sort((a, b) => a - b);
		componentOf.set(slot, target);
		for (const [other, id] of componentOf.entries()) {
			if (componentIds.has(id)) {
				componentOf.set(other, target);
			}
		}
	}

	const componentSlots = new Map<number, RackSlot[]>();
	for (const slot of slots) {
		const id = componentOf.get(slot) ?? 0;
		const members = componentSlots.get(id) ?? [];
		members.push(slot);
		componentSlots.set(id, members);
	}

	for (const members of componentSlots.values()) {
		const ordered = [...members].sort((a, b) => a.unit - b.unit || a.name.localeCompare(b.name));
		const lanes: RackSlot[][] = [];
		for (const slot of ordered) {
			let placed = false;
			for (const [laneIndex, lane] of lanes.entries()) {
				if (!lane.some((other) => slotsOverlap(slot, other))) {
					lane.push(slot);
					slot.laneIndex = laneIndex;
					placed = true;
					break;
				}
			}
			if (!placed) {
				slot.laneIndex = lanes.length;
				lanes.push([slot]);
			}
		}
		for (const slot of members) {
			slot.laneCount = lanes.length;
		}

		for (let i = 0; i < ordered.length; i += 1) {
			for (let j = i + 1; j < ordered.length; j += 1) {
				const a = ordered[i];
				const b = ordered[j];
				if (slotsOverlap(a, b) && !sameRange(a, b)) {
					warnings.push(
						`Rack "${rackName}": "${a.name}" (U${a.unit}–U${a.unit + a.heightU - 1}) partially overlaps "${b.name}" (U${b.unit}–U${b.unit + b.heightU - 1}).`
					);
				}
			}
		}
	}
}

export function buildRackLayout(data: NetworkData): RackLayout {
	const slotsByRack = new Map<string, RackSlot[]>();
	const canonicalNames = new Map<string, string>();
	const unracked: UnrackedEntity[] = [];

	const canonical = (rawName: string): string => {
		const trimmed = rawName.trim();
		const key = trimmed.toLowerCase();
		const existing = canonicalNames.get(key);
		if (existing) {
			return existing;
		}
		canonicalNames.set(key, trimmed);
		return trimmed;
	};

	for (const definition of data.racks ?? []) {
		const name = canonical(definition.name);
		if (!slotsByRack.has(name)) {
			slotsByRack.set(name, []);
		}
	}

	const place = (
		slot: Omit<RackSlot, 'heightU' | 'laneIndex' | 'laneCount'> & { heightU?: number },
		rackName: string
	) => {
		const name = canonical(rackName);
		const slots = slotsByRack.get(name) ?? [];
		slots.push({
			...slot,
			heightU: Math.max(1, Math.round(slot.heightU ?? 1)),
			laneIndex: 0,
			laneCount: 1
		});
		slotsByRack.set(name, slots);
	};

	for (const [index, machine] of data.machines.entries()) {
		if (!machine.rack?.name) {
			unracked.push({
				kind: 'machine',
				name: machine.machineName,
				iconKey: machine.iconKey,
				subtitle: machine.role
			});
			continue;
		}
		place(
			{
				kind: 'machine',
				name: machine.machineName,
				index,
				unit: machine.rack.unit,
				heightU: machine.rack.heightU,
				iconKey: machine.iconKey,
				subtitle: machine.role
			},
			machine.rack.name
		);
	}
	for (const [index, device] of data.devices.entries()) {
		if (!device.rack?.name) {
			unracked.push({
				kind: 'device',
				name: device.name,
				iconKey: device.iconKey,
				subtitle: device.type
			});
			continue;
		}
		place(
			{
				kind: 'device',
				name: device.name,
				index,
				unit: device.rack.unit,
				heightU: device.rack.heightU,
				iconKey: device.iconKey,
				subtitle: device.type
			},
			device.rack.name
		);
	}

	const declaredByName = new Map(
		(data.racks ?? []).map((definition) => [definition.name.trim().toLowerCase(), definition])
	);

	const warnings: string[] = [];
	const racks: RackColumn[] = [...slotsByRack.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, slots]) => {
			const sorted = [...slots].sort((a, b) => b.unit - a.unit || a.name.localeCompare(b.name));
			assignLanes(sorted, name, warnings);
			const topUnit =
				sorted.length > 0 ? Math.max(...sorted.map((slot) => slot.unit + slot.heightU - 1)) : 0;
			const definition = declaredByName.get(name.toLowerCase());
			const declaredHeightU = definition?.heightU;
			if (typeof declaredHeightU === 'number' && topUnit > declaredHeightU) {
				warnings.push(
					`Rack "${name}" is declared as ${declaredHeightU}U but items reach U${topUnit}.`
				);
			}
			const heightU =
				typeof declaredHeightU === 'number'
					? Math.max(declaredHeightU, topUnit)
					: Math.max(minimumRackHeightU, topUnit);
			return {
				name,
				heightU,
				declared: Boolean(definition),
				declaredHeightU,
				slots: sorted
			};
		});

	return { racks, warnings, unrackedCount: unracked.length, unracked };
}

export function knownRackNames(data: NetworkData): string[] {
	const names = new Map<string, string>();
	const add = (name: string | undefined) => {
		const trimmed = name?.trim();
		if (trimmed && !names.has(trimmed.toLowerCase())) {
			names.set(trimmed.toLowerCase(), trimmed);
		}
	};
	for (const definition of data.racks ?? []) {
		add(definition.name);
	}
	for (const machine of data.machines) {
		add(machine.rack?.name);
	}
	for (const device of data.devices) {
		add(device.rack?.name);
	}
	return [...names.values()].sort((a, b) => a.localeCompare(b));
}
