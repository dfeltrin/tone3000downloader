#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ApiClient, createSessionLogger, enabledCategories, readManifest, synchronize } from './lib.js';

const root = process.cwd();
const args = process.argv.slice(2);
const command = args[0] ?? 'sync';
let sessionLogger;

function usage() {
  console.log('Uso: node src/cli.js <sync|status> [--user USER] [--dry-run]');
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`File mancante: ${file}`);
    throw new Error(`JSON non valido in ${file}: ${error.message}`);
  }
}

async function main() {
  if (command === '--help' || command === '-h') return usage();
  const dataDirectory = path.join(root, 'data');
  if (command === 'status') {
    const manifest = await readManifest(path.join(dataDirectory, '.tone3000-sync.json'));
    const entries = Object.values(manifest.models);
    console.log(`Modelli registrati: ${entries.length}`);
    for (const entry of entries) console.log(entry.path);
    return;
  }
  if (command !== 'sync') throw new Error(`Comando sconosciuto: ${command}`);

  const config = await readJson(path.join(root, 'config.json'));
  if (!Array.isArray(config.users) || config.users.some((user) => typeof user !== 'string' || !user.trim())) {
    throw new Error('config.json deve contenere un array non vuoto di username in "users"');
  }
  const categories = enabledCategories(config.categories);
  const userIndex = args.indexOf('--user');
  if (userIndex !== -1 && !args[userIndex + 1]) throw new Error('--user richiede uno username');
  const users = userIndex === -1 ? config.users : [args[userIndex + 1]];
  const dryRun = args.includes('--dry-run');
  sessionLogger = await createSessionLogger(dataDirectory);
  await sessionLogger.log(`Sessione avviata${dryRun ? ' (dry-run)' : ''}; utenti: ${users.join(', ')}; categorie: ${categories.join(', ')}`);
  const secret = process.env.TONE3000_API_KEY ? {} : await readJson(path.join(root, 'secret.json'));
  const apiKey = process.env.TONE3000_API_KEY ?? secret.apiKey ?? secret.api_key;
  const client = new ApiClient({ apiKey });
  await client.validateCredentials();
  await sessionLogger.log('Autenticazione API riuscita.');
  const summary = await synchronize({ client, users, categories, dataDirectory, dryRun, log: sessionLogger.log });
  await sessionLogger.log(`Riepilogo: scaricati ${summary.downloaded}, aggiornati ${summary.updated}, saltati ${summary.skipped}, modificati localmente ${summary.localModified}, conflitti ${summary.conflicts}, errori ${summary.errors}.`);
  if (summary.errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  const message = `Errore: ${error.message}`;
  if (sessionLogger) {
    sessionLogger.log(message).catch(() => console.error(message));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
});
