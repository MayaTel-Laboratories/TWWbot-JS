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

function TextFromImageDetails(details: ImageDetails): string {
  if (!details) {
    return "some sort of error occurred in the filename parsing logic. please ping maya until she fixes it";
  }
  const seasonZeroless = parseInt(details.season, 10).toString();
  const episodeZeroless = parseInt(details.episodeNumber, 10).toString();
  const frameZeroless = parseInt(details.frameNumber, 10).toString();
  const totalFrames = details.totalFramesInEpisode.toString();
  return `The West Wing - ${seasonZeroless}x${episodeZeroless} - ${details.episodeTitle} - Frame ${frameZeroless} of ${totalFrames}`;
}

function sanitizeLine(raw: string): string {
  let t = raw || '';
  t = t.replace(/\r/g, '\n');
  t = t.replace(/\n+/g, ' ');
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/^[^\w"]+/, '').replace(/[^\w"]+$/, '');
  return t;
}

async function ocrSubtitlesTesseract(imagePath: string, opts?: { cropPercent?: number; maxLines?: number; }): Promise<string | null> {
  const cropPercent = opts?.cropPercent ?? 0.22;
  const maxLines = opts?.maxLines ?? 4;
  try {
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    if (!width || !height) return null;
    const cropHeight = Math.max(80, Math.round(height * cropPercent));
    const top = Math.max(0, height - cropHeight);
    const buf = await image
      .extract({ left: 0, top, width, height: cropHeight })
      .grayscale()
      .resize({ width: Math.min(1600, Math.round(width)), withoutEnlargement: true })
      .normalize()
      .sharpen()
      .toBuffer();

    const worker = await createWorker({
    });

    await worker.load();
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK.toString(),
      preserve_interword_spaces: '1',
    });

    const { data } = await worker.recognize(buf);
    await worker.terminate();
    let rawLines: string[] = [];
    if (data && Array.isArray((data as any).lines) && (data as any).lines.length > 0) {
      rawLines = (data as any).lines.map((l: any) => (typeof l.text === 'string' ? l.text : '')).filter(Boolean);
    } else if (typeof data.text === 'string') {
      rawLines = data.text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }

    if (rawLines.length === 0) return null;
    const cleaned = rawLines.slice(0, maxLines).map(sanitizeLine).filter(Boolean);
    if (cleaned.length === 0) return null;
    const joined = cleaned.join(' | ');
    return joined;
  } catch (e) {
    console.error('OCR error:', e);
    return null;
  }
}

async function main() {
  const { LAST_IMAGE_NAME: lastImageName } = process.env;
  const nextImage = await getNextImage({ lastImageName });
  console.error(`Status: Preparing to post ${nextImage.imageName}`);
  const imageDetails = parseImageName(nextImage.imageName, nextImage.absolutePath);

  if (imageDetails) {
    const postText = TextFromImageDetails(imageDetails);
    const ocrText = await ocrSubtitlesTesseract(nextImage.absolutePath, { cropPercent: 0.22, maxLines: 4 });
    const maxAltLength = 2000;
    let altText = postText;
    if (ocrText) {
      altText = `${postText} — Burned-in subtitle: "${ocrText}"`;
    }

    if (altText.length > maxAltLength) {
      altText = altText.slice(0, maxAltLength - 1) + '…';
    }
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