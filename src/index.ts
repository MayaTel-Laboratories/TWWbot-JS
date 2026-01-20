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

function parseImageName(imageName: string, absolutePath: string): ImageDetails | null {
  const matchResult = imageName.match(/^TWW_(\d)x(\d{2})_(.*)__(\d+)\.jpeg$/);
  if (matchResult) {
    const season = matchResult[1];
    const episodeNumber = matchResult[2];
    const episodeTitle = matchResult[3];
    const frameNumber = matchResult[4];
    const directoryPath = path.dirname(absolutePath);
    const files = fs.readdirSync(directoryPath);
    const episodePrefix = `TWW_${season}x${episodeNumber}_${episodeTitle}__`;
    const totalFrames = files.filter(file =>
      file.startsWith(episodePrefix) && file.endsWith('.jpeg')
    ).length;
    return {
      season,
      episodeNumber,
      episodeTitle,
      frameNumber,
      totalFramesInEpisode: totalFrames,
    };
  }
  return null;
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

async function recognizeWithWorker(worker: any, buf: Buffer): Promise<string> {
  const { data } = await worker.recognize(buf);
  let rawLines: string[] = [];
  if (data && Array.isArray((data as any).lines) && (data as any).lines.length > 0) {
    rawLines = (data as any).lines.map((l: any) => (typeof l.text === 'string' ? l.text : '')).filter(Boolean);
  } else if (typeof data.text === 'string') {
    rawLines = data.text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }
  if (rawLines.length === 0) return '';
  const cleaned = rawLines.map(sanitizeLine).filter(Boolean);
  return cleaned.join(' ');
}

async function ocrSubtitlesTesseract(imagePath: string, opts?: { cropPercent?: number; maxLines?: number; }): Promise<string | null> {
  const cropPercent = opts?.cropPercent ?? 0.26;
  const maxLines = opts?.maxLines ?? 4;
  let worker: any = null;
  try {
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    const width = Math.round(metadata.width || 0);
    const height = Math.round(metadata.height || 0);
    if (!width || !height) return null;
    const minCrop = 40;
    const desiredCrop = Math.round(height * cropPercent);
    const cropHeight = Math.min(height, Math.max(minCrop, desiredCrop));
    const top = Math.max(0, height - cropHeight);
    let bufA: Buffer;
    let bufB: Buffer;
    try {
      bufA = await image
        .extract({ left: 0, top, width, height: cropHeight })
        .grayscale()
        .resize({ width: Math.min(2200, Math.round(width * 1.5)), withoutEnlargement: true })
        .normalize()
        .median(3)
        .sharpen()
        .toBuffer();
      bufB = await image
        .extract({ left: 0, top, width, height: cropHeight })
        .grayscale()
        .resize({ width: Math.min(2200, Math.round(width * 1.5)), withoutEnlargement: true })
        .normalize()
        .median(3)
        .sharpen()
        .threshold(150)
        .toBuffer();
    } catch (extractErr) {
      console.error('OCR extract failed, falling back to full image. metadata=', { width, height, cropHeight, top }, 'error=', extractErr);
      const fullBuf = await image
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
    await worker.load();
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
    console.error('OCR error:', e);
    return null;
  } finally {
    try {
      if (worker) await worker.terminate();
    } catch {}
  }
}

async function main() {
  const { LAST_IMAGE_NAME: lastImageName } = process.env;
  const nextImage = await getNextImage({ lastImageName });
  console.error(`Status: Preparing to post ${nextImage.imageName}`);
  const imageDetails = parseImageName(nextImage.imageName, nextImage.absolutePath);
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
  } else {
    console.error(`Error: Could not parse image details from filename: ${nextImage.imageName}`);
    console.log(lastImageName || '');
  }
}

main();