/** The per-video thumbnail review: choosing, tagging, counting and keeping. */
export { MAX_WINNERS, chooseComparison, titleWords } from './compare';
export type { CompareThumb, ComparisonSet, ReviewTarget } from './compare';
export {
  SAME_SHARE,
  WINNING_CHANNELS,
  WINNING_LIFT,
  WINNING_SHARE,
  countComparison,
  missingValues,
} from './count';
export type { CountFlag, CountRow, Counted } from './count';
export { readComparison } from './store';
export type {
  ReviewedVideo,
  StoredThumbReview,
  ThumbAnswer,
  ThumbComparison,
  ThumbReviewRepo,
} from './store';
export {
  TAG_ATTRIBUTES,
  TAG_CHECKLIST,
  TAG_COLOURS,
  parseTagAnswer,
  tagValues,
  thumbTagsSchema,
} from './tags';
export type { ParsedTags, TagAttribute, TagKey, TagRejection, ThumbTags } from './tags';
export { comparisonText } from './text';
export { SqliteThumbReviewRepo } from '../repos/sqliteThumbReviewRepo';
