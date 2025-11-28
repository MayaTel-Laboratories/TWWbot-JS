interface ImageDetails {
  season: string
  episodeNumber: string
  episodeTitle: string
  frameNumber: string
}
function parseImageName(imageName: string): ImageDetails | null {
  const match = imageName.match(/^TWW_(\d)x(\d{2})_(.)__(\d+)\.jpeg$/);
  if (match) {
    return {
      season: match[1]
      episodeNumber: match[2]
      episodeTitle: match[3]
      frameNumber: match[4]
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