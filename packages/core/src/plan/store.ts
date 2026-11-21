/** The published video a kept concept became, as the owner linked it. */
export interface VideoLink {
  readonly conceptId: number;
  readonly centerChannelId: string;
  readonly videoId: string;
  readonly linkedAt: Date;
}

export interface VideoLinkRepo {
  /**
   * Links a concept to a video, replacing the concept's earlier video.
   * 'video-taken' when the video is already linked to another concept of the channel.
   */
  link(
    centerChannelId: string,
    conceptId: number,
    videoId: string,
    at: Date,
  ): 'linked' | 'video-taken';
  /** False when the concept had no video linked. */
  unlink(centerChannelId: string, conceptId: number): boolean;
  /** The channel's links, the newest first. */
  list(centerChannelId: string): readonly VideoLink[];
}
