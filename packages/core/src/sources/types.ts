export type DatePrecision = 'hour' | 'day' | 'week' | 'month' | 'year';

/** A publish date derived from relative text such as "2w ago". */
export interface ApproxDate {
  readonly date: Date;
  readonly precision: DatePrecision;
  readonly raw: string;
}

export type ChannelRef =
  | { readonly kind: 'id'; readonly id: string }
  | { readonly kind: 'handle'; readonly handle: string };

export interface ChannelInfo {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  readonly subscribers: number | null;
  readonly subscribersHidden: boolean;
  readonly videoCount: number | null;
}

export interface VideoItem {
  readonly id: string;
  readonly channelId: string;
  readonly title: string;
  readonly views: number | null;
  readonly durationSeconds: number | null;
  readonly published: ApproxDate | null;
}

/** A video with the fields needed to store and score it. */
export interface StorableVideo extends VideoItem {
  readonly views: number;
  readonly published: ApproxDate;
}

export interface SidebarItem {
  readonly videoId: string;
  readonly title: string;
  readonly channelId: string | null;
  readonly channelName: string | null;
  readonly channelHandle: string | null;
  readonly views: number | null;
  readonly published: ApproxDate | null;
}

export interface ChannelSnapshot {
  readonly channel: ChannelInfo;
  readonly videos: readonly VideoItem[];
}

/** Everything the engine needs from YouTube, so the access method can be swapped. */
export interface YouTubeSource {
  resolveChannelId(handle: string): Promise<string>;
  fetchChannel(channelId: string, maxVideos: number): Promise<ChannelSnapshot>;
  getSidebar(videoId: string): Promise<readonly SidebarItem[]>;
}
