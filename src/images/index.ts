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

function compareEntries(a: ReturnType<typeof parseTwwFilename>, b: ReturnType<typeof parseTwwFilename>) {
  if (!a || !b) return 0;
  if (a.season !== b.season) return a.season - b.season;
  if (a.episode !== b.episode) return a.episode - b.episode;
  return a.frame - b.frame;
}

async function getNextImage(options?: GetNextImageOptions): Promise<NextImage> {
  const { lastImageName } = options || {};
  const readdir = util.promisify(fs.readdir);
  const imagesDir = path.resolve(__dirname, '../../imagequeue');
  const files = await readdir(imagesDir);

  const parsed = files
    .map(parseTwwFilename)
    .filter((p): p is ReturnType<typeof parseTwwFilename> => p !== null);

  if (parsed.length === 0) {
    throw new Error(`No TWW images found in directory ${imagesDir}`);
  }

  parsed.sort(compareEntries);
  const indexByName = new Map<string, number>();
  parsed.forEach((p, i) => indexByName.set(p.filename, i));

  let nextIndex = 0;
  let loopedAround = false;

  if (lastImageName) {
    const idx = indexByName.get(lastImageName);
    if (typeof idx === 'number') {
      nextIndex = idx + 1;
      if (nextIndex >= parsed.length) {
        nextIndex = 0;
        loopedAround = true;
      }
    } else {
      const lastParsed = parseTwwFilename(lastImageName);
      if (lastParsed) {
        const found = parsed.findIndex(p =>
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

  const selected = parsed[nextIndex];
  return {
    imageName: selected.filename,
    absolutePath: path.join(imagesDir, selected.filename),
    loopedAround,
  };
}

export { getNextImage };
export type { NextImage, GetNextImageOptions };