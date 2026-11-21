import { useState } from 'react';
import { initials, logoUrl } from '../lib/format';

interface Props {
  readonly title: string;
  /** The stored address of the channel's logo; null or absent when none has been read. */
  readonly logoUrl: string | null | undefined;
  /** How many initials stand in for a missing logo: one in small circles, two in large ones. */
  readonly letters?: 1 | 2;
}

/**
 * A channel's own logo, filling the round frame it is put in, and the
 * channel's initials until a logo has been read or when the picture will not
 * load. The address came from a YouTube page, so it is checked before use.
 */
export function ChannelLogo({ title, logoUrl: stored, letters = 2 }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  const logo = logoUrl(stored ?? null);
  if (logo === null || failed === logo) {
    return <>{letters === 1 ? initials(title).charAt(0) : initials(title)}</>;
  }
  return (
    <img
      src={logo}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(logo)}
      className="h-full w-full rounded-full object-cover"
    />
  );
}
