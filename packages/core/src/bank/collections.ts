/**
 * The owner's named collections of bank videos ("Hooks to steal",
 * "Thumbnail refs"), as the store keeps them.
 */
export const MAX_COLLECTION_NAME = 60;
/** Line breaks, control characters and the invisible marks that reorder or hide text. */
const NOT_ONE_LINE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/;

export interface BankCollection {
  readonly id: number;
  readonly name: string;
  readonly count: number;
  readonly createdAt: string;
}

export interface CollectionRepo {
  /** The collection of that name (case ignored), made if there is none; its id. */
  create(name: string, at: Date): number;
  find(id: number): BankCollection | null;
  list(): readonly BankCollection[];
  /** False when the collection is not there. Throws for a video id that is not one. */
  add(id: number, videoId: string, at: Date): boolean;
  remove(id: number, videoId: string): boolean;
  delete(id: number): boolean;
  /** The collection's video ids, the most recently added first. */
  videoIds(id: number): readonly string[];
  /** Every video in any collection, with the collections it is in. */
  membership(): ReadonlyMap<string, readonly number[]>;
}

/** Why a name is not taken, in plain words, or null when it is. */
export function collectionNameProblem(name: string): string | null {
  if (NOT_ONE_LINE.test(name)) return 'A collection’s name must be one line of plain text.';
  if (name.trim() === '') return 'Give the collection a name.';
  return name.trim().length > MAX_COLLECTION_NAME
    ? `A collection’s name can be at most ${MAX_COLLECTION_NAME} characters.`
    : null;
}
