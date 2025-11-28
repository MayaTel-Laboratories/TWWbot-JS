import { postImage } from './clients/at';
import { getNextImage } from './images';
import * as dotenv from 'dotenv';
dotenv.config();
interface ImageDetails {
  season: string;        // Y
  episodeNumber: string; // ZZ
  episodeTitle: string;  // Q
  frameNumber: string;   // F
}
function parseImageName(imageName: string): ImageDetails | null {
  const match = imageName.match(/^TWW_(\d)x(\d{2})_(.)__(\d+)\.jpeg$/);

  if (match) {
    return {
      season: match,
      episodeNumber: match,
      episodeTitle: match,
      frameNumber: match,
    };
  }
  return null;
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
