import { postImage } from './clients/at';
import { getNextImage } from './images';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import sharp = require('sharp');
import { createWorker, PSM } from 'tesseract.js';

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
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;

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
      const sampleMatches: string[] = [];
      for (const entry of treeTry) {
        if (!entry || entry.type !== 'blob') continue;
        const fullPath = entry.path || '';
        if (!fullPath.startsWith(prefix)) continue;
        const basename = fullPath.split('/').pop() || fullPath;
        if (fileRegex.test(basename)) {
          c++;
          if (sampleMatches.length < 10) sampleMatches.push(basename);
        }
      }
      console.error(`countFramesFromGitHub (fallback-sha) treeEntries=${treeTry.length}, matches=${c}`);
      if (sampleMatches.length) console.error('sample matches:', sampleMatches.join(', '));
      return c;
    }

    const branchData = await res.json();
    const sha = branchData?.commit?.sha;
    if (!sha) return null;
    const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(sha)}?recursive=1`;
    res = await fetch(treeUrl, { headers });
    if (!res.ok) {
      console.error('countFramesFromGitHub: failed to fetch tree:', res.status, res.statusText);
      return null;
    }
    const treeData = await res.json();
    const tree = Array.isArray(treeData?.tree) ? treeData.tree : null;
    if (!tree) return null;
    const normalizedPath = imagePath.replace(/^\/+|\/+$/g, '');
    const prefix = normalizedPath.length ? `${normalizedPath}/` : '';
    const fileRegex = new RegExp(`^TWW_${season}x${episode}_.+__\\d+\\.jpeg$`, 'i');
    let count = 0;
    const sampleMatches: string[] = [];
    for (const entry of tree) {
      if (!entry || entry.type !== 'blob') continue;
      const fullPath = entry.path || '';
      if (!fullPath.startsWith(prefix)) continue;
      const basename = fullPath.split('/').pop() || fullPath;
      if (fileRegex.test(basename)) {
        count++;
        if (sampleMatches.length < 10) sampleMatches.push(basename);
      }
    }

    console.error(`countFramesFromGitHub: treeEntries=${tree.length}, matches=${count}, sha=${sha}`);
    if (sampleMatches.length) console.error('sample matches:', sampleMatches.join(', '));
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

function sanitizeLine(raw: string): string {
  let t = raw || '';
  t = t.replace(/\r/g, '\n');
  t = t.replace(/\n+/g, ' ');
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/^[^\w"']+/, '').replace(/[^\w"']+$/, '');
  return t;
}

function textQualityScore(s: string): number {
  if (!s) return 0;
  const total = s.replace(/\s/g, '').length || 1;
  const alpha = (s.match(/[A-Z]/gi) || []).length;
  const numeric = (s.match(/[0-9]/g) || []).length;
  const bad = (s.match(/[^A-Z0-9\s\.,'"\-?:;()]/gi) || []).length;
  return ((alpha + numeric) - bad) / total;
}

function normalizeBbox(w: any) {
  const bbox = w.bbox || {};
  const x0 = bbox.x0 ?? bbox.x ?? w.x0 ?? w.x ?? 0;
  const x1 = bbox.x1 ?? bbox.x1 ?? bbox.x2 ?? w.x1 ?? w.x2 ?? (x0 + (bbox.w ?? bbox.width ?? 0));
  const y0 = bbox.y0 ?? bbox.y ?? w.y0 ?? w.y ?? 0;
  const y1 = bbox.y1 ?? bbox.y1 ?? bbox.y2 ?? w.y1 ?? w.y2 ?? (y0 + (bbox.h ?? bbox.height ?? 0));
  return { text: w.text ?? w.word ?? w.symbol ?? '', x0: Number(x0), x1: Number(x1), y0: Number(y0), y1: Number(y1) };
}

function buildLinesFromWordBoxes(boxes: Array<{text: string; x0: number; x1: number; y0: number; y1: number;}>, maxGapFactor = 0.45) {
  if (!boxes.length) return [];
  boxes.sort((a, b) => {
    const ay = (a.y0 + a.y1) / 2;
    const by = (b.y0 + b.y1) / 2;
    if (Math.abs(ay - by) > 10) return ay - by;
    return a.x0 - b.x0;
  });
  const heights = boxes.map(b => Math.max(1, b.y1 - b.y0));
  const avgHeight = heights.reduce((s, v) => s + v, 0) / heights.length;
  const avgCharWidth = boxes.reduce((s, b) => s + ((b.x1 - b.x0) / Math.max(1, b.text.length)), 0) / boxes.length;
  const lineThreshold = Math.max(10, avgHeight * 0.6);
  const gapThreshold = Math.max(1, avgCharWidth * maxGapFactor);
  const lines: Array<Array<typeof boxes[0]>> = [];
  for (const box of boxes) {
    const centerY = (box.y0 + box.y1) / 2;
    let placed = false;
    for (const line of lines) {
      const ly = (line[0].y0 + line[0].y1) / 2;
      if (Math.abs(centerY - ly) <= lineThreshold) {
        line.push(box);
        placed = true;
        break;
      }
    }
    if (!placed) lines.push([box]);
  }
  const joinedLines = lines.map(line => {
    line.sort((a, b) => a.x0 - b.x0);
    let out = '';
    for (let i = 0; i < line.length; i++) {
      const w = line[i];
      if (i === 0) out += w.text.trim();
      else {
        const prev = line[i - 1];
        const gap = w.x0 - prev.x1;
        if (gap >= gapThreshold) out += ' ' + w.text.trim();
        else out += w.text.trim();
      }
    }
    return out.trim();
  });
  return joinedLines.map(sanitizeLine).filter(Boolean);
}

function buildLinesFromSymbols(symbols: any[], maxGapFactor = 0.45) {
  if (!symbols || !symbols.length) return [];
  const boxes = symbols.map(s => normalizeBbox(s));
  return buildLinesFromWordBoxes(boxes, maxGapFactor);
}

async function attachPunctuationToWords(words: any[], symbols: any[]) {
  if (!symbols || symbols.length === 0 || !words || words.length === 0) return words;
  const punctRE = /^[\.\,\?\!\:\;'\-\"“”'·]$/;
  const wboxes = words.map((w: any) => ({ ...(w.bbox || w), text: w.text ?? w.word ?? w.symbol ?? '' }));
  const sboxes = symbols.map((s: any) => ({ ...(s.bbox || s), text: s.text ?? s.symbol ?? '' }));
  for (const s of sboxes) {
    const t = (s.text || '').trim();
    if (!t || !punctRE.test(t)) continue;
    const sx0 = Number(s.x0 ?? s.x ?? (s.bbox && s.bbox.x0) ?? 0);
    const sx1 = Number(s.x1 ?? s.x1 ?? (s.bbox && s.bbox.x1) ?? sx0);
    const scx = (sx0 + sx1) / 2;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < wboxes.length; i++) {
      const w = wboxes[i];
      const wx0 = Number(w.x0 ?? w.x ?? (w.bbox && w.bbox.x0) ?? 0);
      const wx1 = Number(w.x1 ?? w.x1 ?? (w.bbox && w.bbox.x1) ?? wx0);
      const wcx = (wx0 + wx1) / 2;
      const dist = Math.abs(wcx - scx);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      wboxes[bestIdx].text = (wboxes[bestIdx].text || '') + t;
    }
  }
  return words.map((w: any, i: number) => {
    const nb = wboxes[i];
    const out = { ...w };
    out.text = nb.text;
    if ('word' in out) out.word = nb.text;
    return out;
  });
}

async function recognizeWithWorker(worker: any, buf: Buffer): Promise<string> {
  const { data } = await worker.recognize(buf);
  let lines: string[] = [];
  if (data && Array.isArray((data as any).words) && (data as any).words.length > 0) {
    const wordsRaw = (data as any).words;
    const symbolsRaw = Array.isArray((data as any).symbols) ? (data as any).symbols : [];
    const wordsWithPunct = await attachPunctuationToWords(wordsRaw, symbolsRaw);
    const boxes = wordsWithPunct.map((w: any) => normalizeBbox(w));
    lines = buildLinesFromWordBoxes(boxes, 0.45);
  } else if (data && Array.isArray((data as any).symbols) && (data as any).symbols.length > 0) {
    lines = buildLinesFromSymbols((data as any).symbols, 0.45);
  } else if (typeof data.text === 'string') {
    lines = data.text.split(/\r?\n/).map(s => sanitizeLine(s)).filter(Boolean);
  }
  if (lines.length === 0) return '';
  return lines.join(' ');
}

async function ocrSubtitlesTesseract(imagePath: string, opts?: { cropPercent?: number; maxLines?: number; }): Promise<string | null> {
  const cropPercent = opts?.cropPercent ?? 0.26;
  const maxLines = opts?.maxLines ?? 4;
  let worker: any = null;
  try {
    const base = sharp(imagePath);
    const metadata = await base.metadata();
    const width = Math.round(metadata.width || 0);
    const height = Math.round(metadata.height || 0);
    if (!width || !height) return null;
    const minCrop = 40;
    const desiredCrop = Math.round(height * cropPercent);
    let cropHeight = Math.min(height, Math.max(minCrop, desiredCrop));
    let top = Math.max(0, height - cropHeight);
    if (top + cropHeight > height) {
      cropHeight = Math.max(1, height - top);
    }
    if (cropHeight <= 0) {
      cropHeight = Math.min(height, Math.max(1, desiredCrop));
      top = Math.max(0, height - cropHeight);
    }
    let bufA: Buffer;
    let bufB: Buffer;
    try {
      bufA = await base.clone()
        .extract({ left: 0, top, width, height: cropHeight })
        .grayscale()
        .resize({ width: Math.min(2200, Math.round(width * 1.5)), withoutEnlargement: true })
        .normalize()
        .median(3)
        .sharpen()
        .toBuffer();
      bufB = await base.clone()
        .extract({ left: 0, top, width, height: cropHeight })
        .grayscale()
        .resize({ width: Math.min(2200, Math.round(width * 1.5)), withoutEnlargement: true })
        .normalize()
        .median(3)
        .sharpen()
        .threshold(150)
        .toBuffer();
    } catch (extractErr) {
      const fullBuf = await base.clone()
        .grayscale()
        .resize({ width: Math.min(2200, Math.round(width * 1.5)), withoutEnlargement: true })
        .normalize()
        .median(3)
        .sharpen()
        .toBuffer();
      bufA = fullBuf;
      bufB = fullBuf;
    }
    worker = await createWorker({});
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,\'"-?:!',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    const textA = (await recognizeWithWorker(worker, bufA)).toUpperCase().trim();
    const textB = (await recognizeWithWorker(worker, bufB)).toUpperCase().trim();
    const scoreA = textQualityScore(textA);
    const scoreB = textQualityScore(textB);
    let chosen = textA;
    if (scoreB > scoreA) chosen = textB;
    const lines = chosen.split(/\s{2,}|\s\|\s| ?\.\s ?/).map(s => s.trim()).filter(Boolean);
    let finalLines = lines;
    if (finalLines.length === 0 && chosen.length > 0) {
      finalLines = chosen.split(/\s/).reduce<string[]>((acc, w) => {
        if (acc.length === 0) acc.push(w);
        else if ((acc[acc.length - 1] + ' ' + w).length <= 30) acc[acc.length - 1] = acc[acc.length - 1] + ' ' + w;
        else acc.push(w);
        return acc;
      }, []);
    }
    finalLines = finalLines.slice(0, maxLines).map(s => s.replace(/[^A-Z0-9 \.,'"\-?:!]/g, '').trim()).filter(Boolean);
    if (finalLines.length === 0) return null;
    return finalLines.join(' | ');
  } catch (e) {
    return null;
  } finally {
    try {
      if (worker) await worker.terminate();
    } catch {}
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
    const ocrText = await ocrSubtitlesTesseract(nextImage.absolutePath, { cropPercent: 0.26, maxLines: 4 });
    let altText = AltTextFromDetails(imageDetails, ocrText);
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