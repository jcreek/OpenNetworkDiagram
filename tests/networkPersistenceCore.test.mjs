import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

let moduleSequence = 0;

function restoreEnvironment(name, value) {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

async function withPersistenceEnvironment(run, options = {}) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'ond-persistence-'));
	const source = path.join(root, 'data', 'network.json');
	const backupDirectory = path.join(root, 'backups');
	const previousDataFile = process.env.NETWORK_DATA_FILE;
	const previousBackupDirectory = process.env.NETWORK_BACKUP_DIR;
	const previousReadOnly = process.env.NETWORK_READ_ONLY;

	process.env.NETWORK_DATA_FILE = source;
	process.env.NETWORK_BACKUP_DIR = backupDirectory;
	process.env.NETWORK_READ_ONLY = options.readOnly ? 'true' : 'false';
	moduleSequence += 1;

	try {
		const persistence = await import(
			`../src/lib/shared/networkPersistenceCore.mjs?test=${moduleSequence}`
		);
		await run({ persistence, root, source, backupDirectory });
	} finally {
		restoreEnvironment('NETWORK_DATA_FILE', previousDataFile);
		restoreEnvironment('NETWORK_BACKUP_DIR', previousBackupDirectory);
		restoreEnvironment('NETWORK_READ_ONLY', previousReadOnly);
		await rm(root, { recursive: true, force: true });
	}
}

test('initializes a missing writable data file with a blank network', async () => {
	await withPersistenceEnvironment(async ({ persistence, source, backupDirectory }) => {
		const result = await persistence.readOrInitializeNetworkFile();

		assert.equal(result.initialized, true);
		assert.deepEqual(result.data, { machines: [], devices: [] });
		assert.equal(result.source, source);
		assert.deepEqual(JSON.parse(await readFile(source, 'utf8')), {
			machines: [],
			devices: []
		});
		assert.deepEqual(await readdir(backupDirectory), []);
	});
});

async function assertInitializesBlankFile(contents) {
	await withPersistenceEnvironment(async ({ persistence, source }) => {
		await persistence.writeNetworkFile({ machines: [], devices: [] }, { createBackup: false });
		await writeFile(source, contents, 'utf8');

		const result = await persistence.readOrInitializeNetworkFile();

		assert.equal(result.initialized, true);
		assert.deepEqual(JSON.parse(await readFile(source, 'utf8')), {
			machines: [],
			devices: []
		});
	});
}

test('initializes zero-byte and whitespace-only writable data files', async () => {
	await assertInitializesBlankFile('');
	await assertInitializesBlankFile(' \n\t');
});

test('does not rewrite an existing valid empty network', async () => {
	await withPersistenceEnvironment(async ({ persistence, source }) => {
		await persistence.writeNetworkFile({ machines: [], devices: [] }, { createBackup: false });
		const before = await stat(source);

		const result = await persistence.readOrInitializeNetworkFile();
		const after = await stat(source);

		assert.equal(result.initialized, false);
		assert.deepEqual(result.data, { machines: [], devices: [] });
		assert.equal(after.mtimeMs, before.mtimeMs);
	});
});

test('does not overwrite real data written while a missing file is being initialized', async () => {
	await withPersistenceEnvironment(async ({ persistence, source }) => {
		const realData = {
			machines: [{ machineName: 'Router' }],
			devices: []
		};

		const bootstrap = persistence.readOrInitializeNetworkFile();
		const write = persistence.writeNetworkFile(realData, { createBackup: false });
		const [bootstrapResult] = await Promise.all([bootstrap, write]);

		assert.equal(bootstrapResult.initialized, false);
		assert.deepEqual(bootstrapResult.data, realData);
		assert.deepEqual(JSON.parse(await readFile(source, 'utf8')), realData);
	});
});

test('does not replace malformed or schema-invalid non-empty JSON', async () => {
	await withPersistenceEnvironment(async ({ persistence, source }) => {
		await persistence.writeNetworkFile({ machines: [], devices: [] }, { createBackup: false });
		await writeFile(source, '{not json', 'utf8');

		await assert.rejects(persistence.readOrInitializeNetworkFile(), SyntaxError);
		assert.equal(await readFile(source, 'utf8'), '{not json');
	});

	await withPersistenceEnvironment(async ({ persistence, source }) => {
		await persistence.writeNetworkFile({ machines: [], devices: [] }, { createBackup: false });
		await writeFile(source, '{}\n', 'utf8');

		const result = await persistence.readOrInitializeNetworkFile();

		assert.equal(result.initialized, false);
		assert.deepEqual(result.data, {});
		assert.equal(await readFile(source, 'utf8'), '{}\n');
	});
});

test('never initializes missing or blank files in explicit read-only mode', async () => {
	await withPersistenceEnvironment(
		async ({ persistence, source }) => {
			await assert.rejects(
				persistence.readOrInitializeNetworkFile(),
				/Writes disabled by NETWORK_READ_ONLY=true/
			);
			await assert.rejects(stat(source), { code: 'ENOENT' });
		},
		{ readOnly: true }
	);

	await withPersistenceEnvironment(
		async ({ persistence, source }) => {
			await mkdir(path.dirname(source), { recursive: true });
			await writeFile(source, ' \n', 'utf8');

			await assert.rejects(
				persistence.readOrInitializeNetworkFile(),
				/Writes disabled by NETWORK_READ_ONLY=true/
			);
			assert.equal(await readFile(source, 'utf8'), ' \n');
		},
		{ readOnly: true }
	);
});

test(
	'unwritable blank files remain untouched and report the permission failure',
	{ skip: process.platform === 'win32' },
	async () => {
		await withPersistenceEnvironment(async ({ persistence, source }) => {
			await persistence.writeNetworkFile({ machines: [], devices: [] }, { createBackup: false });
			await writeFile(source, '', 'utf8');
			await chmod(source, 0o400);

			try {
				const writableState = await persistence.getWritableState();
				assert.equal(writableState.writable, false);
				assert.match(writableState.reason, /not readable and writable/);
				await assert.rejects(
					persistence.readOrInitializeNetworkFile(),
					/not readable and writable/
				);
				assert.equal(await readFile(source, 'utf8'), '');
			} finally {
				await chmod(source, 0o600);
			}
		});
	}
);
