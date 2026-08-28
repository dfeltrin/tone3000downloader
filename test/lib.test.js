import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSessionLogger, enabledCategories, modelPath, safeName, sessionLogFilename, syncModel } from '../src/lib.js';

const tone = { id: 12, title: 'Clean / Lead', gear: 'amp-cab', updated_at: '2026-01-01', user: { username: '2dor' } };
const model = { id: 99, name: 'A2: Main', updated_at: '2026-01-01', architecture_version: '2', model_url: 'https://download.test/99.nam' };

test('safeName rende i nomi compatibili con il filesystem', () => {
  assert.equal(safeName(' A/B:* '), 'A-B--');
  assert.equal(modelPath('/tmp/data', tone, model), '/tmp/data/users/2dor/amp-cab/Clean - Lead [tone-12]/A2- Main [model-99].nam');
});

test('enabledCategories accetta solo flag booleani delle categorie supportate', () => {
  assert.deepEqual(enabledCategories({ amp: true, cab: false, pedal: true }), ['amp', 'pedal']);
  assert.throws(() => enabledCategories({ ir: true }), /Categoria non supportata/);
  assert.throws(() => enabledCategories({ amp: 'true' }), /true o false/);
});

test('il log di sessione usa il nome richiesto e registra le righe', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'tone3000-log-test-'));
  const now = new Date(2026, 7, 28, 14, 5);
  assert.equal(sessionLogFilename(now), '2026-08-28-14-05 tone3000downloader.log');
  const logger = await createSessionLogger(dataDirectory, now);
  await logger.log('Sessione di prova');
  assert.match(logger.path, /logs\/2026-08-28-14-05 tone3000downloader\.log$/);
  assert.match(await readFile(logger.path, 'utf8'), /Sessione di prova/);
});

test('syncModel scarica e poi rileva una modifica locale', async () => {
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
