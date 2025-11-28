import { BskyAgent, stringifyLex, jsonToLex } from '@atproto/api';
import * as fs from 'fs';
import * as util from 'util';
import * as sizeOf from 'buffer-image-size'
const GET_TIMEOUT = 15e3
const POST_TIMEOUT = 60e3
const readFile = util.promisify(fs.readFile);
async function loadImageData(path: fs.PathLike) {
  let buffer = await readFile(path);
  return { data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), buffer: buffer };
}
interface FetchHandlerResponse {
  status: number;
  headers: Record<string, string>;
  body: ArrayBuffer | undefined;
}
async function fetchHandler(
  reqUri: string,
  reqMethod: string,
  reqHeaders: Record<string, string>,
  reqBody: any,
): Promise<FetchHandlerResponse> {
  const reqMimeType = reqHeaders['Content-Type'] || reqHeaders['content-type'];
  if (reqMimeType && reqMimeType.startsWith('application/json')) {
    reqBody = stringifyLex(reqBody);
  } else if (typeof reqBody === 'string' && (reqBody.startsWith('/') || reqBody.startsWith('file:'))) {
  }
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), reqMethod === 'post' ? POST_TIMEOUT : GET_TIMEOUT);
  const res = await fetch(reqUri, {
    method: reqMethod,
    headers: reqHeaders,
    body: reqBody,
    signal: controller.signal,
  });
  const resStatus = res.status;
  const resHeaders: Record<string, string> = {};
  res.headers.forEach((value: string, key: string) => {
    resHeaders[key] = value;
  });
  const resMimeType = resHeaders['Content-Type'] || resHeaders['content-type'];
  let resBody;
  if (resMimeType) {
    if (resMimeType.startsWith('application/json')) {
      resBody = jsonToLex(await res.json());
    } else if (resMimeType.startsWith('text/')) {
      resBody = await res.text();
    } else {
      resBody = await res.blob();
    }
  }
  clearTimeout(to);
  return {
    status: resStatus,
    headers: resHeaders,
    body: resBody,
  };
}
type PostImageOptions = {
  path: fs.PathLike;
  text: string;
  altText: string;
};
async function postImage({ path, text, altText }: PostImageOptions) {
  const agent = new BskyAgent({ service: 'https://bsky.social' });
  BskyAgent.configure({
    fetch: fetchHandler,
  });
  await agent.login({
    identifier: process.env.BSKY_IDENTIFIER || 'BSKY_IDENTIFIER missing',
    password: process.env.BSKY_PASSWORD || 'BSKY_PASSWORD missing',
  });
  const { data, buffer } = await loadImageData(path);
  const dimensions = sizeOf(buffer);
  const testUpload = await agent.uploadBlob(data, { encoding: 'image/jpg' });
  await agent.post({
    text: text,
    embed: {
      images: [
        {
          image: testUpload.data.blob,
          alt: altText,
          aspectRatio: {
            width: dimensions.width,
            height: dimensions.height,
          },
        },
      ],
      $type: 'app.bsky.embed.images',
    },
  });
}
export { postImage };