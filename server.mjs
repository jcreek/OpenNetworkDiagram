import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNetworkData } from './src/lib/shared/networkSchemaCore.mjs';
import {
	checkWritableState,
	isWriteEnabled,
	readNetworkFile,
	writeNetworkFile
} from './src/lib/shared/networkPersistenceCore.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const buildDir = path.resolve(currentDirPath, 'build');

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 3000);

const contentTypeByExtension = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.svg': 'image/svg+xml; charset=utf-8',
	'.ico': 'image/x-icon',
	'.webp': 'image/webp',
	'.txt': 'text/plain; charset=utf-8'
};

function sendJson(response, status, payload) {
	const body = JSON.stringify(payload);
	response.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': Buffer.byteLength(body),
		'Cache-Control': 'no-store'
	});
	response.end(body);
}

function badRequest(response, message, details) {
	sendJson(response, 400, {
		error: message,
		...(details ? { details } : {})
	});
}

async function serveApi(request, response) {
	if (request.method === 'GET') {
		try {
			const payload = await readNetworkFile();
			const validation = validateNetworkData(payload.data);
			if (!validation.valid) {
				sendJson(response, 500, {
					error: 'Stored network data is invalid',
					details: validation.errors
				});
				return;
			}

			const canWrite = await checkWritableState();

			sendJson(response, 200, {
				data: validation.data,
				writable: canWrite,
				source: payload.source,
				updatedAt: payload.updatedAt
			});
		} catch (error) {
			sendJson(response, 500, {
				error: error instanceof Error ? error.message : 'Failed to read network data'
			});
		}
		return;
	}

	if (request.method === 'PUT') {
		if (!isWriteEnabled()) {
			sendJson(response, 403, {
				error: 'Write API disabled. Unset NETWORK_READ_ONLY to enable persistence.'
			});
			return;
		}

		let raw = '';
		for await (const chunk of request) {
			raw += chunk;
		}

		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch {
			badRequest(response, 'Request body must be valid JSON');
			return;
		}

		const validation = validateNetworkData(parsed);
		if (!validation.valid) {
			badRequest(response, 'Network data validation failed', validation.errors);
			return;
		}

		try {
			const metadata = await writeNetworkFile(validation.data);
			sendJson(response, 200, {
				data: validation.data,
				writable: true,
				source: metadata.source,
				updatedAt: metadata.updatedAt
			});
		} catch (error) {
			sendJson(response, 500, {
				error: error instanceof Error ? error.message : 'Failed to persist network data'
			});
		}
		return;
	}

	sendJson(response, 405, { error: 'Method not allowed' });
}

function safeRelativePath(requestPath) {
	const decoded = decodeURIComponent(requestPath);
	const normalized = path.posix.normalize(decoded);
	if (normalized.startsWith('..')) {
		return null;
	}
	return normalized;
}

async function serveStatic(requestPath, response) {
	const relativePath = safeRelativePath(requestPath);
	if (relativePath === null) {
		response.writeHead(400);
		response.end('Bad request');
		return;
	}

	const requestedFilePath = path.join(
		buildDir,
		relativePath === '/' ? 'index.html' : relativePath.slice(1)
	);

	const sendFile = async (filePath) => {
		const ext = path.extname(filePath).toLowerCase();
		const contentType = contentTypeByExtension[ext] ?? 'application/octet-stream';
		const content = await readFile(filePath);
		response.writeHead(200, {
			'Content-Type': contentType,
			'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable'
		});
		response.end(content);
	};

	try {
		const fileInfo = await stat(requestedFilePath);
		if (fileInfo.isDirectory()) {
			await sendFile(path.join(requestedFilePath, 'index.html'));
			return;
		}
		await sendFile(requestedFilePath);
		return;
	} catch {
		// continue with SPA fallback
	}

	try {
		await sendFile(path.join(buildDir, 'index.html'));
	} catch {
		response.writeHead(404);
		response.end('Not found');
	}
}

const server = createServer(async (request, response) => {
	const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
	if (requestUrl.pathname === '/api/network-data') {
		await serveApi(request, response);
		return;
	}
	await serveStatic(requestUrl.pathname, response);
});

server.listen(PORT, HOST, () => {
	// eslint-disable-next-line no-console
	console.log(`[OpenNetworkDiagram] listening on http://${HOST}:${PORT}`);
});
