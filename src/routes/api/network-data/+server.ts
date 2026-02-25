import { json } from '@sveltejs/kit';

import { validateNetworkData } from '$lib/data/networkSchema';
import {
	checkWritableState,
	isWriteEnabled,
	readNetworkFile,
	writeNetworkFile
} from '$lib/server/networkPersistence';
import type { RequestHandler } from './$types';

function serializeValidationErrors(errors: Array<{ path: string; message: string }>) {
	return errors.map((issue) => ({
		path: issue.path,
		message: issue.message
	}));
}

export const GET: RequestHandler = async () => {
	try {
		const [{ data, source, updatedAt }, writable] = await Promise.all([
			readNetworkFile(),
			checkWritableState()
		]);
		const validation = validateNetworkData(data);
		if (!validation.valid || !validation.data) {
			return json(
				{
					error: 'Stored network data is invalid',
					details: serializeValidationErrors(validation.errors)
				},
				{ status: 500 }
			);
		}

		return json({
			data: validation.data,
			writable,
			source,
			updatedAt
		});
	} catch (error) {
		const message =
			error instanceof Error && error.message ? error.message : 'Failed to read network data file';
		return json({ error: message }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ request }) => {
	if (!isWriteEnabled()) {
		return json(
			{
				error: 'Write API disabled. Unset NETWORK_READ_ONLY to enable persistence.'
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
		const writable = await checkWritableState();
		return json({
			data: validation.data,
			writable,
			source: metadata.source,
			updatedAt: metadata.updatedAt
		});
	} catch (error) {
		const message =
			error instanceof Error && error.message ? error.message : 'Failed to persist network data';
		return json({ error: message }, { status: 500 });
	}
};
