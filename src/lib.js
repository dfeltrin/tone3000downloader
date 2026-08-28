import { createHash } from 'node:crypto';
import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const API_BASE_URL = 'https://www.tone3000.com/api/v1';
export const TONE3000_CATEGORIES = ['amp', 'amp-cab', 'pedal', 'outboard', 'cab', 'space', 'experimental'];

export function enabledCategories(categories) {
  if (!categories || typeof categories !== 'object' || Array.isArray(categories)) {
    throw new Error('config.json deve contenere l’oggetto "categories" con flag true/false');
  }
  for (const [category, enabled] of Object.entries(categories)) {
    if (!TONE3000_CATEGORIES.includes(category)) throw new Error(`Categoria non supportata: ${category}`);
    if (typeof enabled !== 'boolean') throw new Error(`Il flag della categoria "${category}" deve essere true o false`);
  }
  const selected = TONE3000_CATEGORIES.filter((category) => categories[category] === true);
  if (selected.length === 0) throw new Error('Abilita almeno una categoria in config.json');
  return selected;
}

export function normalizeUsername(username) {
  return String(username).trim().toLowerCase();
}

function pad(number) {
  return String(number).padStart(2, '0');
}

export function sessionLogFilename(now = new Date()) {
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
  ].join('-');
  return `${stamp} tone3000downloader.log`;
}

export async function createSessionLogger(dataDirectory, now = new Date()) {
  const logsDirectory = path.join(dataDirectory, 'logs');
  await mkdir(logsDirectory, { recursive: true });
  const initialFilename = sessionLogFilename(now);
  let logPath = path.join(logsDirectory, initialFilename);
  let suffix = 2;
  for (;;) {
    try {
      const handle = await open(logPath, 'wx');
      await handle.close();
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      logPath = path.join(logsDirectory, initialFilename.replace(/\.log$/, `-${suffix}.log`));
      suffix += 1;
    }
  }
  return {
    path: logPath,
    async log(message) {
      const line = `[${new Date().toISOString()}] ${message}`;
      console.log(line);
      await appendFile(logPath, `${line}\n`, 'utf8');
    },
  };
}

export function safeName(value, fallback = 'untitled') {
  const clean = String(value ?? '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return (clean || fallback).slice(0, 160);
}

export function modelPath(dataDirectory, tone, model) {
  const author = safeName(tone.user?.username, 'unknown-author');
  const gear = safeName(tone.gear, 'unknown-gear');
  const toneDirectory = `${safeName(tone.title)} [tone-${tone.id}]`;
  const fileName = `${safeName(model.name, 'model')} [model-${model.id}].nam`;
  return path.join(dataDirectory, 'users', author, gear, toneDirectory, fileName);
}

export function remoteSignature(tone, model) {
  return JSON.stringify({
    toneId: tone.id,
    toneUpdatedAt: tone.updated_at ?? null,
    title: tone.title,
    gear: tone.gear,
    modelId: model.id,
    modelUpdatedAt: model.updated_at ?? null,
    name: model.name,
    architecture: model.architecture_version ?? null,
    url: model.model_url,
  });
}

export async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

export async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function readManifest(manifestPath) {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.version !== 1 || typeof manifest.models !== 'object') {
      throw new Error('versione o struttura non supportata');
    }
    return manifest;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, models: {} };
    throw new Error(`Manifest non valido (${error.message})`);
  }
}

export async function writeManifest(manifestPath, manifest) {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const temporaryPath = `${manifestPath}.part`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, manifestPath);
}

export class ApiClient {
  #apiKey;
  #fetch;
  #lastRequestAt = 0;
  #minimumIntervalMs;

  constructor({ apiKey, fetchImpl = fetch, minimumIntervalMs = 670 }) {
    if (!apiKey) throw new Error('API key TONE3000 mancante');
    this.#apiKey = apiKey;
    this.#fetch = fetchImpl;
    this.#minimumIntervalMs = minimumIntervalMs;
  }

  async request(url) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const wait = this.#minimumIntervalMs - (Date.now() - this.#lastRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.#lastRequestAt = Date.now();
      const response = await this.#fetch(url, { headers: { Authorization: `Bearer ${this.#apiKey}` } });
      if (response.ok) return response;
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw new Error(`Richiesta TONE3000 fallita (${response.status}) per ${new URL(url).pathname}`);
    }
  }

  async json(url) {
    return (await this.request(url)).json();
  }

  async validateCredentials() {
    await this.json(`${API_BASE_URL}/user`);
  }

  async findTones(username, categories) {
    const normalizedUsername = normalizeUsername(username);
    const tones = [];
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({ creators: normalizedUsername, format: 'nam', architecture: '2', gears: categories.join('_'), page: String(page), page_size: '25', sort: 'newest' });
      const result = await this.json(`${API_BASE_URL}/tones/search?${query}`);
      tones.push(...result.data.filter((tone) => normalizeUsername(tone.user?.username) === normalizedUsername && tone.format === 'nam' && categories.includes(tone.gear)));
      if (page >= result.total_pages) break;
    }
    return tones;
  }

  async listNam2Models(toneId) {
    const models = [];
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({ tone_id: String(toneId), architecture: '2', page: String(page), page_size: '300' });
      const result = await this.json(`${API_BASE_URL}/models?${query}`);
      models.push(...result.data.filter((model) => model.architecture_version === '2'));
      if (page >= result.total_pages) break;
    }
    return models;
  }

  async download(url) {
    const response = await this.request(url);
    return Buffer.from(await response.arrayBuffer());
  }
}

export async function syncModel({ client, dataDirectory, manifest, tone, model, dryRun, saveManifest }) {
  const destination = modelPath(dataDirectory, tone, model);
  const signature = remoteSignature(tone, model);
  const previous = manifest.models[String(model.id)];
  const exists = await fileExists(destination);
  let localHash = null;
  if (exists) localHash = await sha256File(destination);

  if (previous?.signature === signature && previous.path === destination && exists) {
    if (previous.sha256 === localHash) return { action: 'skipped', destination };
    return { action: 'local-modified', destination };
  }
  if (exists && (!previous || previous.sha256 !== localHash)) return { action: 'conflict', destination };
  if (dryRun) return { action: 'would-download', destination };

  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.part`;
  try {
    const content = await client.download(model.model_url);
    await writeFile(temporary, content);
    const sha256 = createHash('sha256').update(content).digest('hex');
    await rename(temporary, destination);
    manifest.models[String(model.id)] = { signature, path: destination, sha256, syncedAt: new Date().toISOString() };
    if (saveManifest) await saveManifest(manifest);
    return { action: previous ? 'updated' : 'downloaded', destination };
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function synchronize({ client, users, categories, dataDirectory, dryRun = false, log = () => {} }) {
  const manifestPath = path.join(dataDirectory, '.tone3000-sync.json');
  const manifest = await readManifest(manifestPath);
  const saveManifest = dryRun ? undefined : () => writeManifest(manifestPath, manifest);
  const summary = { downloaded: 0, updated: 0, skipped: 0, localModified: 0, conflicts: 0, errors: 0 };
  for (const username of users) {
    await log(`Autore: ${username}`);
    const tones = await client.findTones(username, categories);
    for (const tone of tones) {
      const models = await client.listNam2Models(tone.id);
      for (const model of models) {
        try {
          const result = await syncModel({ client, dataDirectory, manifest, tone, model, dryRun, saveManifest });
          if (result.action === 'local-modified') summary.localModified += 1;
          else if (result.action === 'conflict') summary.conflicts += 1;
          else if (result.action === 'would-download') summary.downloaded += 1;
          else summary[result.action] += 1;
          await log(`${result.action}: ${result.destination}`);
        } catch (error) {
          summary.errors += 1;
          await log(`error: modello ${model.id}: ${error.message}`);
        }
      }
    }
  }
  if (!dryRun) await saveManifest();
  return summary;
}
