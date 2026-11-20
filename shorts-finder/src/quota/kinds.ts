/**
 * What a call to the API is for, which decides the share of the day's
 * allowance it is paid from:
 *
 * - `search`: looking for videos on a subject (search.list).
 * - `reading`: reading tracked videos' figures again (videos.list).
 * - `channel`: channel facts and upload lists (channels.list, playlistItems.list).
 * - `reserve`: kept back for retries, confirmations and a search asked for by hand.
 */
export const QUOTA_KINDS = ['search', 'reading', 'channel', 'reserve'] as const;

export type QuotaKind = (typeof QUOTA_KINDS)[number];
