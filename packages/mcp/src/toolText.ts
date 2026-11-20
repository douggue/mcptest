/**
 * What each tool is called and when to use it, written for the model that
 * chooses between them. The keys used in the answers are explained here once,
 * so the answers themselves can stay short.
 */
export const TOOL_TEXT = {
  get_map: {
    title: 'Competitor map',
    description:
      'Start here. The latest stored competitor map around a YouTube channel: the centre channel, the model channel ' +
      'if the owner named one, counts, and the look-alike channels (the same kind of channel as the centre), best ' +
      'match first. Per channel: id, title, subs, match (title match with the centre, 0 to 100), tier (close, medium ' +
      'or far: how strongly YouTube recommends it beside the centre), rising (a young channel already well above its ' +
      'size) and best (its strongest recent video; score is a multiple of that channel’s usual views). Reads the ' +
      'local store only, so it is fast. Fails when no map exists yet: use make_map.',
  },
  get_breakouts: {
    title: 'Breakout videos',
    description:
      'Videos from the last 30 days on the map that got far more views than their channel usually gets, strongest ' +
      'first. Use it for "what should I make next" and "why did this video work". Each has the evidence already ' +
      'worked out: score (views as a multiple of usual), views, usual (the channel’s median views at that age), ' +
      'sample (how many videos the usual comes from), hits (how many of the channel’s recent videos broke out, such ' +
      'as 3/15), channelAgeDays, ageDays and secs (length). caution marks a score that rests on few videos or on a ' +
      'very small usual. Reads the local store only.',
  },
  get_thumbnail_board: {
    title: 'Thumbnail board',
    description:
      'For thumbnail questions. Per look-alike channel: its winners (videos at or above winnerMinScore times the ' +
      'channel’s usual views) beside its ordinary videos (at or below ordinaryMaxScore), and under own the newest ' +
      'videos of the centre channel. Gives video ids, titles, views and scores, not pictures: pass the ids to ' +
      'view_thumbnails to look at them. Reads the local store only.',
  },
  view_thumbnails: {
    title: 'Look at thumbnails',
    description:
      'Look at the real thumbnail pictures of up to 8 videos, by video id from the other tools. Use it to compare ' +
      'winners with ordinary videos and with the owner’s own thumbnails, and to say specifically what to copy or ' +
      'change. Fetches the pictures from YouTube’s image host; one that cannot be loaded is reported in words.',
  },
  get_channel_videos: {
    title: 'One channel’s videos',
    description:
      'One stored channel’s videos with scores (views as a multiple of that channel’s usual views), strongest first ' +
      'or newest first, with usual, sample, ageDays and secs. Works for any channel on a stored map, the owner’s own ' +
      'included. Use it to study a single channel after get_map. Reads the local store only.',
  },
  make_map: {
    title: 'Make a new map',
    description:
      'Makes a new map around a channel by reading YouTube: follows recommendations outwards from the channel (and ' +
      'from the model channel, if given), stores each channel found with its recent videos, and returns the same ' +
      'summary as get_map plus any warnings. Slow: it takes minutes (roughly 2 to 20, more with depth 3 or a large ' +
      'size) and makes hundreds of requests to YouTube, so use it only when the owner asks for a new or fresher map ' +
      'or when get_map says there is none. Only one runs at a time. If the call times out on your side the map is ' +
      'still being made: wait a few minutes, then call get_map.',
  },
} as const;
