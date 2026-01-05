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
    return "some sort of error occurred";
  }
  const seasonZeroless = parseInt(details.season, 10).toString();
  const episodeZeroless = parseInt(details.episodeNumber, 10).toString();
  const frameZeroless = parseInt(details.frameNumber, 10).toString();
  const totalFrames = details.totalFramesInEpisode.toString();
  return `The West Wing - ${seasonZeroless}x${episodeZeroless} - ${details.episodeTitle} - Frame ${frameZeroless} of ${totalFrames}`;
}
async function main() {
  const { LAST_IMAGE_NAME: lastImageName } = process.env;
  const nextImage = await getNextImage({ lastImageName });
  console.log(`Processing image: ${nextImage.imageName}`);
  const imageDetails = parseImageName(nextImage.imageName, nextImage.absolutePath);
  if (imageDetails) {
    const postText = TextFromImageDetails(imageDetails);
    await postImage({
      path: nextImage.absolutePath,
      text: postText,
      altText: postText,
    });
    console.log(`Successfully posted: ${postText}`);
  } else {
    console.error(`Could not parse image details from filename: ${nextImage.imageName}`);
  }
}
main();