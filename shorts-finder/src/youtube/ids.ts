/** The shapes of the ids YouTube gives channels, videos and lists. */
export const CHANNEL_ID_PATTERN = /^UC[\w-]{22}$/;
export const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
/**
 * A list id: a prefix and a body of letters, digits, "-" and "_". An uploads
 * list is "UU" and the channel id's last 22 characters; other lists are longer.
 */
export const PLAYLIST_ID_PATTERN = /^[\w-]{2,64}$/;
