import { z } from 'zod';
import type { Db } from '../db/sqlite';
import { CHANNEL_IMAGE_RULE, isPinnedImageUrl } from '../sources/images';
import type { BrandImage, ChannelBrand } from '../sources/types';
import type { BrandRepo, StoredBrand } from './types';

interface BrandRow {
  id: string;
  description: string | null;
  avatar_json: string | null;
  banner_json: string | null;
  keywords_json: string | null;
  links_json: string | null;
  brand_fetched_at: string;
}

const imagesSchema = z.array(
  z.object({
    url: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
);
const wordsSchema = z.array(z.string());

/** A stored list read back through a schema; empty when it is not what was written. */
function parseList<T>(schema: z.ZodType<readonly T[]>, json: string | null): readonly T[] {
  if (json === null) return [];
  try {
    const parsed = schema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** The stored pictures whose address is still on the channel image host. */
const pinnedImages = (json: string | null): readonly BrandImage[] =>
  parseList(imagesSchema, json).filter((image) => isPinnedImageUrl(image.url, CHANNEL_IMAGE_RULE));

/**
 * The branding lives in its own columns of the channels table, as the facts
 * from the official API do. Reading a channel again rewrites them through
 * `save` and never through the channel repository, which leaves them alone.
 */
export class SqliteBrandRepo implements BrandRepo {
  constructor(private readonly db: Db) {}

  find(channelId: string): StoredBrand | null {
    const row = this.db
      .prepare<[string], BrandRow>(
        `SELECT id, description, avatar_json, banner_json, keywords_json, links_json, brand_fetched_at
         FROM channels WHERE id = ? AND brand_fetched_at IS NOT NULL`,
      )
      .get(channelId);
    if (!row) return null;
    return {
      channelId: row.id,
      description: row.description,
      avatar: pinnedImages(row.avatar_json),
      banner: pinnedImages(row.banner_json),
      keywords: parseList(wordsSchema, row.keywords_json),
      links: parseList(wordsSchema, row.links_json),
      fetchedAt: new Date(row.brand_fetched_at),
    };
  }

  save(channelId: string, brand: ChannelBrand, fetchedAt: Date): void {
    this.db
      .prepare(
        `UPDATE channels SET
           description = @description,
           avatar_json = @avatar,
           banner_json = @banner,
           keywords_json = @keywords,
           links_json = @links,
           brand_fetched_at = @fetchedAt
         WHERE id = @id`,
      )
      .run({
        id: channelId,
        description: brand.description,
        avatar: JSON.stringify(brand.avatar),
        banner: JSON.stringify(brand.banner),
        keywords: JSON.stringify(brand.keywords),
        links: JSON.stringify(brand.links),
        fetchedAt: fetchedAt.toISOString(),
      });
  }
}
