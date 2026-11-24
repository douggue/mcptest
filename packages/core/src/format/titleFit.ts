/**
 * Whether a title follows a title formula, worked out in code: the formula's
 * fixed words appear in the title in order (letter case, punctuation and
 * spacing aside), each slot holds at least one word, and nothing but
 * punctuation stands outside them. A formula with no slot fits nothing.
 */
import { formulaParts } from '../formulas/formulas';

const plain = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function titleFits(formula: string, title: string): boolean {
  const parts = formulaParts(formula);
  if (!parts.some((part) => 'slot' in part)) return false;
  const pattern = parts
    .map((part) =>
      'slot' in part
        ? '(?:\\S+(?: \\S+)*)'
        : plain(part.text)
            .split(' ')
            .filter((word) => word !== '')
            .map(escape)
            .join(' '),
    )
    .filter((piece) => piece !== '')
    .join(' ');
  return new RegExp(`^${pattern}$`, 'u').test(plain(title));
}
