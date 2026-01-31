import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

type GetNextImageOptions = {
  lastImageName?: string | undefined;
};

type NextImage = {
  imageName: string;
  absolutePath: string;
  loopedAround: boolean;
};

const IMAGE_REGEX = /^TWW_(\d+)x(\d{2})_(.*?)__(\d+)\.(jpg|jpeg|png|gif|bmp)$/i;
const CACHE_FILENAME = '.imagecache.json';

/** Parse TWW filename; return null if not matching */
function parseTwwFilename(filename: string) {
  const m = filename.match(IMAGE_REGEX);
  if (!m) return null;
  return {
    filename,
    season: Number(m[1]),
    episode: Number(m[2]),
    title: m[3],
    frame: Number(m[4]),
    ext: m[5].toLowerCase(),
  };
}

/** Numeric compare by season -> episode -> frame */
function compareEntries(a: ReturnType<typeof parseTwwFilename>, b: ReturnType<typeof parseTwwFilename>) {
  if (!a || !b) return 0;
  if (a.season !== b.season) return a.season - b.season;
  if (a.episode !== b.episode) return a.episode - b.episode;
  return a.frame - b.frame;
}

type CacheFile = {
  dirMtimeMs: number;
  createdAt: number;
  entries: Array<{
    filename: string;
    season: number;
    episode: number;
    title: string;
    frame: number;
    ext: string;
  }>;
};

async function readCacheIfValid(imagesDir: string, dirMtimeMs: number): Promise<CacheFile | null> {
  const cachePath = path.join(imagesDir, CACHE_FILENAME);
  try {
    const raw = await util.promisify(fs.readFile)(cachePath, 'utf8');
    const parsed: CacheFile = JSON.parse(raw);
    if (typeof parsed.dirMtimeMs === 'number' && parsed.dirMtimeMs === dirMtimeMs && Array.isArray(parsed.entries)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeCache(imagesDir: string, cache: CacheFile): Promise<void> {
  const cachePath = path.join(imagesDir, CACHE_FILENAME);
  const tmpPath = cachePath + '.tmp';
  const data = JSON.stringify(cache);
  await util.promisify(fs.writeFile)(tmpPath, data, 'utf8');
  await util.promisify(fs.rename)(tmpPath, cachePath);
}

async function getSortedEntries(imagesDir: string) {
  const readdir = util.promisify(fs.readdir);
  const stat = util.promisify(fs.stat);
  let dirStats;
  try {
    dirStats = await stat(imagesDir);
  } catch (e) {
    throw new Error(`Images directory not found: ${imagesDir}`);
  }
  const dirMtimeMs = typeof dirStats.mtimeMs === 'number' ? dirStats.mtimeMs : new Date(dirStats.mtime).getTime();
  const cached = await readCacheIfValid(imagesDir, dirMtimeMs);
  if (cached && Array.isArray(cached.entries) && cached.entries.length > 0) {
    return cached.entries.map(e => ({
      filename: e.filename,
      season: e.season,
      episode: e.episode,
      title: e.title,
      frame: e.frame,
      ext: e.ext,
    }));
  }
  const files = await readdir(imagesDir);
  const parsed = files
    .map(parseTwwFilename)
    .filter((p): p is ReturnType<typeof parseTwwFilename> => p !== null);

  if (parsed.length === 0) {
    const emptyCache: CacheFile = { dirMtimeMs, createdAt: Date.now(), entries: [] };
    try { await writeCache(imagesDir, emptyCache); } catch {}
    return [];
  }

  parsed.sort(compareEntries);
  const cacheToWrite: CacheFile = {
    dirMtimeMs,
    createdAt: Date.now(),
    entries: parsed.map(p => ({
      filename: p.filename,
      season: p.season,
      episode: p.episode,
      title: p.title,
      frame: p.frame,
      ext: p.ext,
    })),
  };
  try {
    await writeCache(imagesDir, cacheToWrite);
  } catch {
  }

  return cacheToWrite.entries;
}

async function getNextImage(options?: GetNextImageOptions): Promise<NextImage> {
  const { lastImageName } = options || {};
  const imagesDir = path.resolve(__dirname, '../../imagequeue');

  const entries = await getSortedEntries(imagesDir);
  if (!entries || entries.length === 0) {
    throw new Error(`No TWW images found in directory ${imagesDir}`);
  }
  const indexByName = new Map<string, number>();
  entries.forEach((p, i) => indexByName.set(p.filename, i));

  let nextIndex = 0;
  let loopedAround = false;

  if (lastImageName) {
    const idx = indexByName.get(lastImageName);
    if (typeof idx === 'number') {
      nextIndex = idx + 1;
      if (nextIndex >= entries.length) {
        nextIndex = 0;
        loopedAround = true;
      }
    } else {
      const lastParsed = parseTwwFilename(lastImageName);
      if (lastParsed) {
        const found = entries.findIndex(p =>
          p.season > lastParsed.season ||
          (p.season === lastParsed.season && p.episode > lastParsed.episode) ||
          (p.season === lastParsed.season && p.episode === lastParsed.episode && p.frame > lastParsed.frame)
        );
        if (found >= 0) {
          nextIndex = found;
        } else {
          nextIndex = 0;
          loopedAround = true;
        }
      } else {
        nextIndex = 0;
      }
    }
  } else {
    nextIndex = 0;
  }

  const selected = entries[nextIndex];
  return {
    imageName: selected.filename,
    absolutePath: path.join(imagesDir, selected.filename),
    loopedAround,
  };
}

export { getNextImage };
export type { NextImage, GetNextImageOptions };