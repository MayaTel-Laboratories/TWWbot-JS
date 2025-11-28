import { postImage } from './clients/at';
import { getNextImage } from './images';
import * as dotenv from 'dotenv';
dotenv.config();
interface ImageDetails {
  season: string
  episodeNumber: string
  episodeTitle: string
  frameNumber: string
}
function parseImageName(imageName: string): ImageDetails | null {
  const matchResult = imageName.match(/^TWW_(\d)x(\d{2})_(\w+)__(\d+)\.jpeg$/);
  if (matchResult) {
    return {
      season: matchResult[1],
      episodeNumber: matchResult[2],
      episodeTitle: matchResult[3],
      frameNumber: matchResult[4],
    };
  }
  return null
}
function TextFromImageDetails(details: ImageDetails): string {
  if (!details) {
    return "A West Wing Image";
  }
  return `The West Wing - ${details.season}x${details.episodeNumber} - ${details.episodeTitle} - Frame ${details.frameNumber}`;
}
async function main() {
  const { LAST_IMAGE_NAME: lastImageName } = process.env;
  const nextImage = await getNextImage({ lastImageName });
  console.log(nextImage.imageName);
  const imageDetails = parseImageName(nextImage.imageName);
  if (imageDetails) {
    const postText = TextFromImageDetails(imageDetails);
    await postImage({
      path: nextImage.absolutePath,
      text: postText,
      altText: postText,
    });
  } else {
      console.error(`Could not parse image details from filename: ${nextImage.imageName}`);
  }
}
main();