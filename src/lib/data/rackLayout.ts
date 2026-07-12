import type { NetworkData } from '../types';

export interface RackSlot {
	kind: 'machine' | 'device';
	name: string;
	index: number;
	unit: number;
	heightU: number;
	iconKey?: string;
	subtitle: string;
}

export interface RackColumn {
	name: string;
	heightU: number;
	slots: RackSlot[];
}

export interface RackLayout {
	racks: RackColumn[];
	overlaps: string[];
	unrackedCount: number;
}

const minimumRackHeightU = 12;

export function buildRackLayout(data: NetworkData): RackLayout {
	const slotsByRack = new Map<string, RackSlot[]>();
	let unrackedCount = 0;

	const place = (slot: Omit<RackSlot, 'heightU'> & { heightU?: number }, rackName: string) => {
		const key = rackName.trim();
		const slots = slotsByRack.get(key) ?? [];
		slots.push({ ...slot, heightU: Math.max(1, Math.round(slot.heightU ?? 1)) });
		slotsByRack.set(key, slots);
	};

	for (const [index, machine] of data.machines.entries()) {
		if (!machine.rack?.name) {
			unrackedCount += 1;
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
			unrackedCount += 1;
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

	const overlaps: string[] = [];
	const racks: RackColumn[] = [...slotsByRack.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, slots]) => {
			const sorted = [...slots].sort((a, b) => b.unit - a.unit || a.name.localeCompare(b.name));
			const topUnit = Math.max(...sorted.map((slot) => slot.unit + slot.heightU - 1));
			for (let i = 0; i < sorted.length; i += 1) {
				for (let j = i + 1; j < sorted.length; j += 1) {
					const a = sorted[i];
					const b = sorted[j];
					const aTop = a.unit + a.heightU - 1;
					const bTop = b.unit + b.heightU - 1;
					if (a.unit <= bTop && b.unit <= aTop) {
						overlaps.push(
							`Rack "${name}": "${a.name}" (U${a.unit}–U${aTop}) overlaps "${b.name}" (U${b.unit}–U${bTop}).`
						);
					}
				}
			}
			return {
				name,
				heightU: Math.max(minimumRackHeightU, topUnit),
				slots: sorted
			};
		});

	return { racks, overlaps, unrackedCount };
}

export function knownRackNames(data: NetworkData): string[] {
	const names = new Set<string>();
	for (const machine of data.machines) {
		if (machine.rack?.name) {
			names.add(machine.rack.name);
		}
	}
	for (const device of data.devices) {
		if (device.rack?.name) {
			names.add(device.rack.name);
		}
	}
	return [...names].sort((a, b) => a.localeCompare(b));
}
