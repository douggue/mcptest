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
      'size) and best (its strongest recent video; score is a multiple of that channel’s usual views). group says ' +
      'whether a look-alike has already taken off (taken-off: three or more uploads in the last 90 days passed ' +
      '10,000 views, 100,000 views in all and at least one per subscriber) or is rising (young, far above its size, small totals so far); absent means neither. The ' +
      'look-alikes are listed about seven taken-off to three rising, as far as the map has them, each group best ' +
      'match first, with the ones in neither group last; counts.mix gives the actual split. unsettled ' +
      'marks a channel whose look-alike call (in or out) changed when a random half of the other channels was left ' +
      'off the map: treat it as undecided and judge it from its titles, not as a firm yes or no. Reads the local ' +
      'store only, so it is fast. Fails when no map exists yet: use make_map.',
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
      'or when get_map says there is none. Only one runs at a time, and it is refused while Jgtube is reading YouTube ' +
      'in another window or process (the web app making a map, a refresh, a keyword search): wait and try again. If ' +
      'the call times out on your side the map is still being made: wait a few minutes, then call get_map.',
  },
  get_near_misses: {
    title: 'Near misses',
    description:
      'Channels on the map that fit the centre on size, upload rate and video length but were left out of the ' +
      'look-alikes only because their titles use different words. They are candidates for "same topic, different ' +
      'wording": read each one’s recent titles and best video and judge by meaning, not vocabulary, whether it covers ' +
      'the same subject for the same viewer. Closest title match first, with match (0 to 100), recentViews (views on ' +
      'uploads from the last 30 days), best and titles (newest first). Suggest the convincing ones to the owner; if ' +
      'they agree, record it with set_competitor_status. Reads the local store only.',
  },
  set_competitor_status: {
    title: 'Keep or remove a competitor',
    description:
      'Records the owner’s decision about one channel on a centre channel’s latest map: kept (count it as a ' +
      'look-alike although the filter left it out), removed (never count it) or auto (withdraw the decision). This ' +
      'changes a stored choice: it shows in the web app and holds for every later map of that centre. Call it only ' +
      'after the owner has agreed, in this conversation, to that change for that channel; never on your own ' +
      'judgement and never for several channels the owner has not each agreed to. It can be undone with auto.',
  },
  list_niches: {
    title: 'New niches',
    description:
      'New or small channels anywhere in the store (not only on one map) that have a recent video far above their ' +
      'size: possible new niches. Most views on the last 90 days of uploads first. Per channel: subs, recentViews ' +
      'and uploads (last 30 days), views90d and uploads90d (last 90 days), viewsPerSub, earnsUsd and earns90dUsd ' +
      '(a rough low and high guess, in US dollars, at the ad money those views are worth: for comparing channels, ' +
      'not a payout; adRate says which rough country tier the rate was scaled by, or that the top rate was assumed ' +
      'because the country is unknown; notPaidYet marks a channel too small to be paid for ads), country, ' +
      'otherLanguage (the channel writes in another alphabet, named when known: an idea that works there may not ' +
      'have been made in the owner’s language yet), channelAgeDays, why (new: first upload within newMaxAgeDays; ' +
      'small: at or under smallMaxSubs), hits (strong videos out of scored ones), top (its videos that took off) ' +
      'and titles. watched marks channels the owner chose to follow; qualifies false marks a watched one that no ' +
      'longer meets the rule. ' +
      'Reads the local store only.',
  },
  list_transfer_opportunities: {
    title: 'Niche transfer opportunities',
    description:
      'Ideas from the whole store (not one map) that several channels made as the same title for different ' +
      'places, with the versions side by side: use it for "what is working elsewhere that I could make for my ' +
      'country". Titles are compared as templates: {place} stands for a country, its people, a region or a US ' +
      'state, {n} for a number. status says where the idea stands for the owner’s place: open (a version took ' +
      'off elsewhere, none made for the owner’s place), weak (the owner’s place has one that got under a tenth of ' +
      'the best elsewhere), done, unproven (nothing took off) or unplaced (a place is not known). verdict says ' +
      'it in words with the view counts. Per version: video, place, channel, subs, views, score (multiple of ' +
      'that channel’s usual views), ageDays, tookOff. oneWordOff lists titles made for the owner’s place that ' +
      'differ from the idea by one word: judge by meaning whether that word is a synonym (so the idea was already ' +
      'done) or another subject. show "formats" lists title formats used for several subjects ({subject} marks ' +
      'what changes), with how many subjects, channels and videos use each: a format moving to a new subject is ' +
      'how an idea crosses categories. place and placeFrom say which place the ideas were judged for and how it ' +
      'was worked out; pass place when that is wrong. Only videos from the last windowDays days count. Reads the ' +
      'local store only.',
  },
  get_transcript: {
    title: 'Video transcript',
    description:
      'What is said in one video: its captions as text, with the time in square brackets every half minute or ' +
      'so. Use it to study a script: the hook in the first thirty seconds, how the video is structured, the ' +
      'wording, the call to action. The first part of the answer gives lang (the captions’ language), auto ' +
      '(made by YouTube’s speech recognition, so names and numbers may be misheard), lines and lastLineAt; the ' +
      'second part is the text. A long transcript is cut at a time mark: cut.startSeconds is where to call ' +
      'again from. A video without captions answers captions false, which is normal and not a failure. The ' +
      'captions are read from YouTube the first time and kept, so asking again is free.',
  },
  view_video_frames: {
    title: 'Look at frames across a video',
    description:
      'Look at what one video shows from start to end: sheets of small frames that YouTube takes at a regular ' +
      'interval (its storyboard). Each sheet is one picture holding a grid of frames, under a caption that says ' +
      'how to read the grid (left to right, then top to bottom) and the time of its first and last frame. Use ' +
      'it to describe the visual style: talking head, stock footage, animation or illustration type, on-screen ' +
      'text, how often the picture changes. It shows pictures only: no sound, and frames several seconds ' +
      'apart, so it cannot show sound design or the exact cut between two shots. sheets says how many to look ' +
      'at, spread evenly across the video. A video without a storyboard answers frames false.',
  },
  get_channel_brand: {
    title: 'Channel branding',
    description:
      'How one channel presents itself: bio (its description), keywords and links as text, then its logo and ' +
      'its cover (the banner across the top of its page) as pictures to look at. logo and cover give the size ' +
      'of each picture, or false when the channel has none. Works for any channel; one whose branding is not ' +
      'stored yet is read from YouTube once and kept. Pass images false for the text alone.',
  },
  get_video_details: {
    title: 'Video descriptions and tags',
    description:
      'The title, description, tags, length (secs), views and score (views as a multiple of the channel’s usual ' +
      'views) of up to 10 videos. Use it to find a channel’s title formula and description template: compare ' +
      'its winners (from get_thumbnail_board or get_channel_videos) with its ordinary videos. descriptionCut ' +
      'marks a description longer than description_chars. views and score are absent for a video whose ' +
      'channel is not in the store. Descriptions are read from YouTube the first time and kept; problems ' +
      'lists a video that could not be read.',
  },
} as const;
