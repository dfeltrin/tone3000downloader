import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSessionLogger, fileExists, modelPath, migratePrimaryLibrary, normalizeUsername, primaryModelPath, remoteSignature, safeName, sessionLogFilename, syncModel } from '../src/lib.js';

const tone = { id: 12, title: 'Clean / Lead', gear: 'amp-cab', updated_at: '2026-01-01', user: { username: '2dor' } };
const model = { id: 99, name: 'A2: Main', updated_at: '2026-01-01', architecture_version: '2', model_url: 'https://download.test/99.nam' };

test('safeName makes names compatible with the filesystem', () => {
  assert.equal(safeName(' A/B:* '), 'A-B--');
  assert.equal(modelPath('/tmp/data', tone, model), '/tmp/data/User/amp-cab/2dor/A2- Main [model-99].nam');
});

test('normalizeUsername makes a username comparable with the API', () => {
  assert.equal(normalizeUsername(' AmalgamAudio '), 'amalgamaudio');
});

test('the session log uses the requested name and writes entries', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'tone3000-log-test-'));
  const now = new Date(2026, 7, 28, 14, 5);
  assert.equal(sessionLogFilename(now), '2026-08-28-14-05 tone3000downloader.log');
  const logger = await createSessionLogger(dataDirectory, now);
  await logger.log('Test session');
  assert.match(logger.path, /logs\/2026-08-28-14-05 tone3000downloader\.log$/);
  assert.match(await readFile(logger.path, 'utf8'), /Test session/);
});

test('syncModel downloads and then detects a local modification', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'tone3000-test-'));
  const manifest = { version: 1, models: {} };
  const client = { download: async () => Buffer.from('remote-content') };
  let saves = 0;
  const first = await syncModel({ client, dataDirectory, manifest, tone, model, dryRun: false, saveManifest: async () => { saves += 1; } });
  assert.equal(first.action, 'downloaded');
  assert.equal(saves, 1);
  assert.equal(await readFile(first.destination, 'utf8'), 'remote-content');
  await writeFile(first.destination, 'local-change');
  const second = await syncModel({ client, dataDirectory, manifest, tone, model, dryRun: false });
  assert.equal(second.action, 'local-modified');
});

test('syncModel skips a model when an old manifest has an absolute path and temporary download URL', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'tone3000-portable-manifest-test-'));
  const manifest = { version: 1, models: {} };
  let downloads = 0;
  const client = { download: async () => { downloads += 1; return Buffer.from('remote-content'); } };
  const first = await syncModel({ client, dataDirectory, manifest, tone, model, dryRun: false });
  const entry = manifest.models[String(model.id)];
  entry.path = path.join('/previous-machine/data', entry.path);
  entry.signature = JSON.stringify({ ...JSON.parse(entry.signature), url: 'https://temporary-download.test/old-url.nam' });

  const second = await syncModel({ client, dataDirectory, manifest, tone, model: { ...model, model_url: 'https://temporary-download.test/new-url.nam' }, dryRun: false });

  assert.equal(first.action, 'downloaded');
  assert.equal(second.action, 'skipped');
  assert.equal(downloads, 1);
  assert.equal(entry.path, path.relative(dataDirectory, first.destination));
  assert.equal(entry.signature, remoteSignature(tone, model));
});

test('migratePrimaryLibrary flattens the primary structure without redownloading', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'tone3000-layout-test-'));
  const legacyPath = path.join(dataDirectory, 'User', 'ExactAuthor', 'amp-cab', 'Tone [tone-1]', 'Model [model-2].nam');
  await mkdir(path.dirname(legacyPath), { recursive: true });
  await writeFile(legacyPath, 'primary-v1');
  const manifest = { version: 1, models: { 2: { path: legacyPath, author: 'ExactAuthor', gear: 'amp-cab', allPath: '/unused', allSha256: 'unused' } } };
  const result = await migratePrimaryLibrary({ dataDirectory, manifest });
  const migrated = primaryModelPath(dataDirectory, manifest.models[2]);
  assert.equal(result.moved, 1);
  assert.equal(await fileExists(legacyPath), false);
  assert.equal(await readFile(migrated, 'utf8'), 'primary-v1');
  assert.equal(manifest.models[2].allPath, undefined);
});
