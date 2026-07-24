import { json } from '@sveltejs/kit';

import { validateNetworkData } from '$lib/data/networkSchema';
import {
	getWritableState,
	readOrInitializeNetworkFile,
	writeNetworkFile
} from '$lib/server/networkPersistence';
import type { RequestHandler } from './$types';

const staticDemoMode = import.meta.env.OND_STATIC_DEMO;
const staticDemoReason = 'Static demo deployment; changes are not persisted.';

function serializeValidationErrors(errors: Array<{ path: string; message: string }>) {
	return errors.map((issue) => ({
		path: issue.path,
		message: issue.message
	}));
}

function resolveReadOnlyErrorMessage(reason: string | null): string {
	if (!reason) {
		return 'Write API unavailable in current deployment.';
	}
	return `Write API unavailable: ${reason}`;
}

async function resolveFailedReadPayload(error: unknown) {
	const writableState = await getWritableState().catch(() => ({
		writable: false,
		reason: null
	}));
	const message =
		error instanceof Error && error.message ? error.message : 'Failed to read network data file';
	return {
		error: message,
		writable: false,
		writableReason: writableState.reason
	};
}

export const GET: RequestHandler = async () => {
	if (staticDemoMode) {
		return json(
			{
				error: staticDemoReason,
				writable: false,
				writableReason: staticDemoReason
			},
			{ status: 503 }
		);
	}

	try {
		const [{ data, source, updatedAt }, writableState] = await Promise.all([
			readOrInitializeNetworkFile(),
			getWritableState()
		]);
		const validation = validateNetworkData(data);
		if (!validation.valid || !validation.data) {
			return json(
				{
					error: 'Stored network data is invalid',
					details: serializeValidationErrors(validation.errors),
					writable: false,
					writableReason: writableState.reason
				},
				{ status: 500 }
			);
		}

		return json({
			data: validation.data,
			writable: writableState.writable,
			writableReason: writableState.reason,
			source,
			updatedAt
		});
	} catch (error) {
		return json(await resolveFailedReadPayload(error), { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ request }) => {
	if (staticDemoMode) {
		return json(
			{
				error: resolveReadOnlyErrorMessage(staticDemoReason),
				writable: false,
				writableReason: staticDemoReason
			},
			{ status: 403 }
		);
	}

	const writableStateBeforeWrite = await getWritableState();
	if (!writableStateBeforeWrite.writable) {
		return json(
			{
				error: resolveReadOnlyErrorMessage(writableStateBeforeWrite.reason),
				writable: false,
				writableReason: writableStateBeforeWrite.reason
			},
			{ status: 403 }
		);
	}

	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return json({ error: 'Request body must be valid JSON' }, { status: 400 });
	}

	const validation = validateNetworkData(payload);
	if (!validation.valid || !validation.data) {
		return json(
			{
				error: 'Network data validation failed',
				details: serializeValidationErrors(validation.errors)
			},
			{ status: 400 }
		);
	}

	try {
		const metadata = await writeNetworkFile(validation.data);
		const writableStateAfterWrite = await getWritableState();
		return json({
			data: validation.data,
			writable: writableStateAfterWrite.writable,
			writableReason: writableStateAfterWrite.reason,
			source: metadata.source,
			updatedAt: metadata.updatedAt
		});
	} catch (error) {
		const message =
			error instanceof Error && error.message ? error.message : 'Failed to persist network data';
		return json({ error: message }, { status: 500 });
	}
};
