/**
 * What the later features add to the library, in one place so that the main
 * index names them with a single line: what changed since the last look.
 */
export { hadReadingBy, videosAsOf } from './changes/asOf';
export {
  CHANGES_BREAKOUTS_SHOWN,
  CHANGES_FORMATS_SHOWN,
  CHANGES_FORMAT_MIN_BREAKOUTS,
  mapChanges,
  type BreakoutBefore,
  type ChannelHistory,
  type GroupChange,
  type GroupChanges,
  type MapChanges,
  type NewBreakout,
} from './changes/changes';
export { breakoutFormats, type BreakoutFormat, type TitledBreakout } from './changes/formats';
export {
  CHANGES_WEEK_DAYS,
  CHANGES_YESTERDAY_DAYS,
  SINCE_KINDS,
  loadChanges,
  resolveSince,
  type ChangesDeps,
  type ChangesFreshness,
  type ChangesView,
  type SinceKind,
} from './changes/load';
export {
  lookalikeChanges,
  type LookalikeChanges,
  type LookalikeRef,
  type NotComparable,
} from './changes/lookalikes';
export type { EarlierMap, LookRepo } from './changes/store';
export { SqliteLookRepo } from './repos/sqliteLookRepo';
