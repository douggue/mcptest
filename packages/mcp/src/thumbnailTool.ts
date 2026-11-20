import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { checkedArgs, viewThumbnailsArgs, type ViewThumbnailsArgs } from './schemas';
import { fetchThumbnail, type FetchImage, type ThumbnailImage } from './thumbnailImages';

type Content = CallToolResult['content'];

function imageContent(videoId: string, image: ThumbnailImage): Content {
  if (!image.ok) {
    return [
      { type: 'text', text: `Thumbnail of video ${videoId} could not be shown: ${image.reason}` },
    ];
  }
  return [
    { type: 'text', text: `Thumbnail of video ${videoId}:` },
    { type: 'image', data: image.data, mimeType: image.mimeType },
  ];
}

/**
 * The thumbnails of the given videos as pictures the model can look at. One
 * image failing is said in words beside the others; the call only counts as
 * failed when nothing could be shown.
 */
export async function viewThumbnails(
  fetchImage: FetchImage | undefined,
  input: ViewThumbnailsArgs,
): Promise<CallToolResult> {
  const args = checkedArgs(viewThumbnailsArgs, input);
  const videoIds = [...new Set(args.video_ids)];
  const images = await Promise.all(videoIds.map((id) => fetchThumbnail(id, fetchImage)));
  const content = videoIds.flatMap((id, index) => {
    const image = images[index];
    return image ? imageContent(id, image) : [];
  });
  return images.some((image) => image.ok) ? { content } : { content, isError: true };
}
