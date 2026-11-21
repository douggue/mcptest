/**
 * Packaging concepts: a title with two alternates, a thumbnail brief with its
 * overlay text and an opening hook, written by an AI engine for one channel
 * from videos the owner picked on that channel's own map.
 *
 * Everything here belongs to one centre channel. A store holds several
 * looked-up channels in different niches, and a concept made for one is never
 * read for another.
 */

/** Whether the concepts are for full-length videos or for clips under a minute. */
export const CONCEPT_LENGTHS = ['long', 'shorts'] as const;
export type ConceptLength = (typeof CONCEPT_LENGTHS)[number];

/** A first batch, a different angle on one concept's subject, or other subjects in its vein. */
export type ConceptOrigin = 'batch' | 'twist' | 'more';

/**
 * Where a title format the owner picked came from: the transfer list's
 * templates (worked out in code from titles) or a stored formula (written by
 * an engine). `template` is its text as it read when it was picked.
 */
export interface ConceptFormat {
  readonly source: 'transfer' | 'formula';
  /** The transfer template's key, or the formula's id as text. */
  readonly ref: string;
  readonly template: string;
}

/** What a batch of concepts rests on. */
export interface NewBatch {
  readonly centerChannelId: string;
  /** The videos the owner picked as inspiration, by id. */
  readonly inspiration: readonly string[];
  /**
   * The picked videos whose way of opening the owner wants modelled: the ones
   * they took from the hook library. Each is also among `inspiration`.
   */
  readonly hookModels: readonly string[];
  readonly format: ConceptFormat | null;
  /** The owner's own wording of their topic; null when they gave none. */
  readonly angle: string | null;
  readonly length: ConceptLength;
}

export interface StoredBatch extends NewBatch {
  readonly id: number;
  readonly createdAt: Date;
}

/** The parts of one concept, as the engine wrote them. */
export interface ConceptFields {
  readonly title: string;
  readonly altTitles: readonly [string, string];
  /** What the thumbnail shows. */
  readonly thumbnail: string;
  /** The few words set on the thumbnail. */
  readonly overlay: string;
  /** The opening sentence of the video. */
  readonly hook: string;
  /**
   * Which hook of the library its opening follows the way of, as the engine
   * wrote it (a video id and a style name); null when it follows none.
   */
  readonly hookStyle: string | null;
  /** Which picked videos it draws on, and what it takes from each. */
  readonly restsOn: string;
  /** What real fact, event or product must be looked up before making it, or "nothing". */
  readonly needs: string;
}

export interface NewConcept extends ConceptFields {
  readonly origin: ConceptOrigin;
  /** The concept a twist or a more-like-this came from; null for a first batch. */
  readonly parentId: number | null;
  /** The engine that wrote it, by its id. */
  readonly engine: string;
}

export interface StoredConcept extends NewConcept {
  readonly id: number;
  readonly batchId: number;
  readonly centerChannelId: string;
  readonly kept: boolean;
  readonly createdAt: Date;
}

export interface AddOptions {
  /**
   * Remove the centre channel's concepts that were not kept, from every other
   * batch, as these are stored: a new batch replaces the one before it.
   */
  readonly replaceUnkept?: boolean;
}

/** Concepts and the batches they came from, each read and changed through its centre channel. */
export interface ConceptRepo {
  createBatch(batch: NewBatch, createdAt: Date): number;
  /** Null when the batch does not exist or belongs to another channel. */
  findBatch(centerChannelId: string, batchId: number): StoredBatch | null;
  listBatches(centerChannelId: string): readonly StoredBatch[];
  /** Stores all the concepts or none. Throws for a batch that does not exist or a concept with an empty field. */
  addConcepts(
    batchId: number,
    concepts: readonly NewConcept[],
    createdAt: Date,
    options?: AddOptions,
  ): readonly StoredConcept[];
  /** Null when the concept does not exist or belongs to another channel. */
  find(centerChannelId: string, conceptId: number): StoredConcept | null;
  /** The kept ones first, then the newest batch first, each batch in the order it was written. */
  listForCenter(centerChannelId: string): readonly StoredConcept[];
  /** False when the concept does not exist or belongs to another channel. */
  setKept(centerChannelId: string, conceptId: number, kept: boolean): boolean;
  /** Removes the channel's concepts that were not kept, and the batches left empty. Returns how many went. */
  clearUnkept(centerChannelId: string): number;
  /** Removes a batch nothing was stored for, such as one whose run failed. */
  removeBatchIfEmpty(batchId: number): void;
}
