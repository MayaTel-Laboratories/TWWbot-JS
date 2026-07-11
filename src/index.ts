import { postImage } from './clients/at';
import { getNextImage } from './images';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

interface ImageDetails {
  season: string;
  episodeNumber: string;
  episodeTitle: string;
  frameNumber: string;
  totalFramesInEpisode: number;
}

function countFramesFromManifest(manifestPath: string | undefined, season: string, episode: string): number | null {
  if (!manifestPath) return null;
  try {
    if (!fs.existsSync(manifestPath)) return null;
    const raw = fs.readFileSync(manifestPath, 'utf8');
    if (!raw) return null;
    const data = JSON.parse(raw);
    const arr = Array.isArray(data) ? data : Array.isArray(data.frames) ? data.frames : null;
    if (!arr) return null;

    const fileRegex = new RegExp(`^TWW_${season}x${episode}_.+__\\d+\\.jpeg$`, 'i');
    let count = 0;
    for (const it of arr) {
      const name = (it && (it.name || it.path)) ? (it.name || it.path) : '';
      if (!name) continue;
      if (fileRegex.test(name)) count++;
    }
    return count;
  } catch (e) {
    return null;
  }
}

function getSubtitleFromManifest(manifestPath: string | undefined, filename: string): string | null {
  if (!manifestPath) return null;
  try {
    if (!fs.existsSync(manifestPath)) return null;
    const raw = fs.readFileSync(manifestPath, 'utf8');
    if (!raw) return null;
    const data = JSON.parse(raw);
    const arr = Array.isArray(data) ? data : Array.isArray(data.frames) ? data.frames : null;
    if (!arr) return null;

    const entry = arr.find((it: any) => it && (it.name || it.path) === filename);
    if (!entry) return null;
    return typeof entry.subtitleText === 'string' && entry.subtitleText.length > 0 ? entry.subtitleText : null;
  } catch (e) {
    return null;
  }
}

async function countFramesFromGitHub(repo: string, imagePath: string, ref: string, season: string, episode: string, token?: string): Promise<number | null> {
  try {
    if (!repo) return null;
    const headers: Record<string,string> = {
      'Accept': 'application/vnd.github+json'
    };
    if (token) headers['Authorization'] = `token ${token}`;
    const branchUrl = `https://api.github.com/repos/${repo}/branches/${encodeURIComponent(ref)}`;
    let res = await fetch(branchUrl, { headers });
    if (!res.ok) {
      const treeUrlTry = `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
      res = await fetch(treeUrlTry, { headers });
      if (!res.ok) return null;
      const treeDataTry = await res.json();
      const treeTry = Array.isArray(treeDataTry?.tree) ? treeDataTry.tree : null;
      if (!treeTry) return null;

      const normalizedPath = imagePath.replace(/^\/+|\/+$/g, '');
      const prefix = normalizedPath.length ? `${normalizedPath}/` : '';

      const fileRegex = new RegExp(`^TWW_${season}x${episode}_.+__\\d+\\.jpeg$`, 'i');

      let c = 0;
      for (const entry of treeTry) {
        if (!entry || entry.type !== 'blob') continue;
        const fullPath = entry.path || '';
        if (!fullPath.startsWith(prefix)) continue;
        const basename = fullPath.split('/').pop() || fullPath;
        if (fileRegex.test(basename)) {
          c++;
        }
      }
      return c;
    }

    const branchData = await res.json();
    const sha = branchData?.commit?.sha;
    if (!sha) return null;
    const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(sha)}?recursive=1`;
    res = await fetch(treeUrl, { headers });
    if (!res.ok) {
      return null;
    }
    const treeData = await res.json();
    const tree = Array.isArray(treeData?.tree) ? treeData.tree : null;
    if (!tree) return null;
    const normalizedPath = imagePath.replace(/^\/+|\/+$/g, '');
    const prefix = normalizedPath.length ? `${normalizedPath}/` : '';
    const fileRegex = new RegExp(`^TWW_${season}x${episode}_.+__\\d+\\.jpeg$`, 'i');

    let count = 0;
    for (const entry of tree) {
      if (!entry || entry.type !== 'blob') continue;
      const fullPath = entry.path || '';
      if (!fullPath.startsWith(prefix)) continue;
      const basename = fullPath.split('/').pop() || fullPath;
      if (fileRegex.test(basename)) {
        count++;
      }
    }

    return count;
  } catch (e) {
    console.error('countFramesFromGitHub exception:', e);
    return null;
  }
}

async function getImageDetails(imageName: string, absolutePath: string): Promise<ImageDetails | null> {
  const matchResult = imageName.match(/^TWW_(\d+)x(\d{1,})_(.*)__(\d+)\.jpeg$/i);
  if (!matchResult) return null;

  const season = matchResult[1];
  const episodeNumber = matchResult[2];
  const episodeTitle = matchResult[3];
  const frameNumber = matchResult[4];
  const manifestPath = process.env.MANIFEST_JSON;
  const manifestCount = countFramesFromManifest(manifestPath, season, episodeNumber);
  if (manifestCount !== null && manifestCount > 0) {
    return {
      season,
      episodeNumber,
      episodeTitle,
      frameNumber,
      totalFramesInEpisode: manifestCount,
    };
  }

  const repo = process.env.GITHUB_REPOSITORY || '';
  const ref = process.env.IMAGE_BRANCH || process.env.GITHUB_REF?.replace(/^refs\/heads\//, '') || 'main';
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || undefined;
  const apiCount = await countFramesFromGitHub(repo, process.env.IMAGE_PATH_IN_REPO || 'imagequeue', ref, season, episodeNumber, token);
  if (apiCount !== null && apiCount > 0) {
    return {
      season,
      episodeNumber,
      episodeTitle,
      frameNumber,
      totalFramesInEpisode: apiCount,
    };
  }

  try {
    const directoryPath = path.dirname(absolutePath);
    const files = fs.readdirSync(directoryPath);
    const episodeRegex = new RegExp(`^TWW_${season}x${episodeNumber}_.+__\\d+\\.jpeg$`, 'i');
    const totalFrames = files.filter(file => episodeRegex.test(file)).length;
    return {
      season,
      episodeNumber,
      episodeTitle,
      frameNumber,
      totalFramesInEpisode: totalFrames,
    };
  } catch (e) {
    return {
      season,
      episodeNumber,
      episodeTitle,
      frameNumber,
      totalFramesInEpisode: 0,
    };
  }
}

function AltTextFromDetails(details: ImageDetails, subtitleText: string | null): string {
  const seasonZeroless = parseInt(details.season, 10).toString();
  const episodeZeroless = parseInt(details.episodeNumber, 10).toString();
  const episodeTitleEscaped = details.episodeTitle.replace(/"/g, '\\"');
  if (subtitleText && subtitleText.length > 0) {
    return `A still frame from The West Wing, ${seasonZeroless}x${episodeZeroless}, "${episodeTitleEscaped}". The subtitle reads "${subtitleText}".`;
  } else {
    return `A still frame from The West Wing, ${seasonZeroless}x${episodeZeroless}, "${episodeTitleEscaped}".`;
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason);
  setTimeout(() => process.exit(1), 100);
});
process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err);
  setTimeout(() => process.exit(1), 100);
});

async function main() {
  const { LAST_IMAGE_NAME: lastImageName } = process.env;
  const nextImage = await getNextImage({ lastImageName });
  console.error(`Status: Preparing to post ${nextImage.imageName}`);
  const imageDetails = await getImageDetails(nextImage.imageName, nextImage.absolutePath);
  if (imageDetails) {
    const postText = `The West Wing - ${parseInt(imageDetails.season, 10)}x${parseInt(imageDetails.episodeNumber, 10)} - ${imageDetails.episodeTitle} - Frame ${parseInt(imageDetails.frameNumber, 10)} of ${imageDetails.totalFramesInEpisode}`;
    const subtitleText = getSubtitleFromManifest(process.env.MANIFEST_JSON, nextImage.imageName);
    console.error(`Manifest path: ${process.env.MANIFEST_JSON}`);
    console.error(`Image name: ${nextImage.imageName}`);
    console.error(`Subtitle found: ${subtitleText}`);
    let altText = AltTextFromDetails(imageDetails, subtitleText);
    console.error(`Alt text: ${altText}`);
    const maxAltLength = 2000;
    if (altText.length > maxAltLength) altText = altText.slice(0, maxAltLength - 1) + '…';
    await postImage({
      path: nextImage.absolutePath,
      text: postText,
      altText,
    });
    console.error(`Status: Successfully posted to Bluesky`);
    console.log(nextImage.imageName);
    setTimeout(() => process.exit(0), 150);
  } else {
    console.error(`Error: Could not parse image details from filename: ${nextImage.imageName}`);
    console.log(lastImageName || '');
    setTimeout(() => process.exit(1), 150);
  }
}

main();