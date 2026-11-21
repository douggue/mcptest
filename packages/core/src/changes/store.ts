/** A map of a centre channel as it is stored: when it was made and its frozen copy. */
export interface EarlierMap {
  readonly id: number;
  readonly createdAt: Date;
  /** The map as it looked when it was made, as stored; null when none was frozen. */
  readonly snapshotJson: string | null;
}

/** When the owner last looked at what changed around a channel, and the maps made for it over time. */
export interface LookRepo {
  /** Null until the owner has marked this channel as seen. */
  lastLook(centerChannelId: string): Date | null;
  markSeen(centerChannelId: string, at: Date): void;
  /** The map that was the channel's latest at that moment; null when none had been made yet. */
  mapAsOf(centerChannelId: string, at: Date): EarlierMap | null;
}
