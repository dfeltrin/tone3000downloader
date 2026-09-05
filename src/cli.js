#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ApiClient, createSessionLogger, readManifest, synchronize, TONE3000_CATEGORIES } from './lib.js';

const root = process.cwd();
const args = process.argv.slice(2);
const command = args[0] ?? 'sync';
let sessionLogger;

function usage() {
  console.log('Usage: node src/cli.js <sync|status> [--user USER] [--dry-run]');
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Missing file: ${file}`);
    throw new Error(`Invalid JSON in ${file}: ${error.message}`);
  }
}

function usersFromEnvironment(value) {
  if (value === undefined) return null;
  return value.split(',').map((user) => user.trim()).filter(Boolean);
}

async function main() {
  if (command === '--help' || command === '-h') return usage();
  const dataDirectory = path.join(root, 'data');
  if (command === 'status') {
    const manifest = await readManifest(path.join(dataDirectory, '.tone3000-sync.json'));
    const entries = Object.values(manifest.models);
    console.log(`Registered models: ${entries.length}`);
    for (const entry of entries) console.log(entry.path);
    return;
  }
  if (command !== 'sync') throw new Error(`Unknown command: ${command}`);

  const configuredUsers = usersFromEnvironment(process.env.TONE3000_USERS);
  if (!Array.isArray(configuredUsers) || configuredUsers.length === 0 || configuredUsers.some((user) => typeof user !== 'string' || !user.trim())) {
    throw new Error('Configure at least one non-empty username in TONE3000_USERS');
  }
  const categories = TONE3000_CATEGORIES;
  const userIndex = args.indexOf('--user');
  if (userIndex !== -1 && !args[userIndex + 1]) throw new Error('--user requires a username');
  const archivedUsers = usersFromEnvironment(process.env.ARCHIVED) ?? [];
  const archivedUsernames = new Set(archivedUsers.map((user) => user.toLowerCase()));
  const requestedUsers = userIndex === -1 ? configuredUsers : [args[userIndex + 1]];
  const users = requestedUsers.filter((user) => !archivedUsernames.has(user.toLowerCase()));
  const dryRun = args.includes('--dry-run');
  sessionLogger = await createSessionLogger(dataDirectory);
  await sessionLogger.log(`Session started${dryRun ? ' (dry-run)' : ''}; users: ${users.join(', ') || 'none'}; archived users: ${archivedUsers.join(', ') || 'none'}; categories: ${categories.join(', ')}`);
  const secret = process.env.TONE3000_API_KEY ? {} : await readJson(path.join(root, 'secret.json'));
  const apiKey = process.env.TONE3000_API_KEY ?? secret.apiKey ?? secret.api_key;
  const client = new ApiClient({ apiKey });
  await client.validateCredentials();
  await sessionLogger.log('API authentication succeeded.');
  const summary = await synchronize({ client, users, archivedUsers, categories, dataDirectory, dryRun, log: sessionLogger.log });
  await sessionLogger.log(`Summary: downloaded ${summary.downloaded}, updated ${summary.updated}, skipped ${summary.skipped}, locally modified ${summary.localModified}, conflicts ${summary.conflicts}, errors ${summary.errors}; archive: moved ${summary.archive.moved}, deduplicated ${summary.archive.deduplicated}, conflicts ${summary.archive.conflicts}, manifest entries ${summary.archive.manifestUpdated}, errors ${summary.archive.errors}; layout migration: moved ${summary.layout.moved}, deduplicated ${summary.layout.deduplicated}, normalized paths ${summary.layout.normalized}, conflicts ${summary.layout.conflicts}, missing primary files ${summary.layout.missing}, errors ${summary.layout.errors}.`);
  if (summary.errors > 0 || summary.archive.errors > 0 || summary.layout.errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  const message = `Error: ${error.message}`;
  if (sessionLogger) {
    sessionLogger.log(message).catch(() => console.error(message));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
});
