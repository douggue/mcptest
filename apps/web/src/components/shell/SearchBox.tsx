import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_SEARCH_CHARS, MIN_SEARCH_CHARS, type SearchChannel } from '../../lib/search';
import { createBreakdownViewApi } from '../../lib/videoBreakdown';
import { IconButton } from '../ui/Button';
import { SearchResults, type SearchActions } from './SearchResults';
import { useSearch } from './useSearch';

interface Props {
  /** The channels that can be found by name: the map's and the owner's own. */
  readonly channels: readonly SearchChannel[];
  readonly onOpenChannel: (channelId: string) => void;
  readonly onOpenVideo: (videoId: string) => void;
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** Reading a channel that is not stored from YouTube, so its page can open. */
function useChannelRead(onRead: (channelId: string) => void) {
  const api = useMemo(() => createBreakdownViewApi(), []);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const read = useCallback(
    (ref: string) => {
      setReading(true);
      setProblem(null);
      api.readChannel(ref).then(
        (channel) => {
          setReading(false);
          onRead(channel.id);
        },
        (error: unknown) => {
          setReading(false);
          setProblem(error instanceof Error ? error.message : 'The channel was not read');
        },
      );
    },
    [api, onRead],
  );
  const clear = useCallback(() => setProblem(null), []);
  return { reading, problem, read, clear };
}

/**
 * The top bar's search: type a few letters to find a stored channel or
 * video, or paste a YouTube link to open that channel or video. On a phone
 * it opens from its icon and covers the bar. "/" puts the cursor in it.
 */
export function SearchBox({ channels, onOpenChannel, onOpenVideo }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useSearch(text, channels);

  const close = useCallback(() => {
    setOpen(false);
    setPhone(false);
  }, []);
  const done = useCallback(() => {
    close();
    setText('');
    input.current?.blur();
  }, [close]);
  const openChannel = useCallback(
    (channelId: string) => {
      done();
      onOpenChannel(channelId);
    },
    [done, onOpenChannel],
  );
  const reader = useChannelRead(openChannel);
  const actions: SearchActions = {
    openChannel,
    openVideo: (videoId) => {
      done();
      onOpenVideo(videoId);
    },
    close: done,
    readChannel: reader.read,
    reading: reader.reading,
    readProblem: reader.problem,
  };

  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
      if (event.key !== '/' || isTyping(event.target)) return;
      event.preventDefault();
      setPhone(true);
      window.setTimeout(() => input.current?.focus(), 0);
    };
    const outside = (event: PointerEvent): void => {
      if (!box.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', outside);
    };
  }, [close]);

  const shown =
    open && text.trim() !== '' && (results.link !== null || text.trim().length >= MIN_SEARCH_CHARS);
  /** Enter opens the link named, or the first thing found. */
  const submit = (): void => {
    const { link, linked } = results;
    const first = results.channels[0];
    const firstVideo = results.videos[0];
    if (link?.kind === 'video') actions.openVideo(link.videoId);
    else if (link && linked?.status === 'channel') openChannel(linked.channel.id);
    else if (link && linked?.status === 'missing') reader.read(text.trim());
    else if (link) return;
    else if (first) openChannel(first.id);
    else if (firstVideo) actions.openVideo(firstVideo.videoId);
  };

  return (
    <>
      <IconButton
        icon={Search}
        label="Search, or paste a YouTube link"
        className="md:hidden"
        onClick={() => {
          setPhone(true);
          window.setTimeout(() => input.current?.focus(), 0);
        }}
      />
      <div
        ref={box}
        className={
          phone
            ? 'fixed inset-x-0 top-0 z-[60] flex h-14 items-center gap-2 bg-ground px-4 md:relative md:inset-auto md:z-auto md:mx-auto md:h-auto md:max-w-[520px] md:flex-1 md:bg-transparent md:px-0'
            : 'relative mx-auto hidden max-w-[520px] flex-1 md:block'
        }
      >
        <form
          role="search"
          className="flex h-[42px] min-w-0 flex-1 items-center gap-2.5 rounded border border-line bg-white/[0.045] px-3.5 focus-within:border-signal/50"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Search aria-hidden="true" className="h-[18px] w-[18px] flex-none text-dim" />
          <label htmlFor="global-search" className="sr-only">
            Search, or paste a YouTube link
          </label>
          <input
            ref={input}
            id="global-search"
            type="text"
            autoComplete="off"
            value={text}
            maxLength={MAX_SEARCH_CHARS}
            onChange={(event) => {
              setText(event.target.value);
              setOpen(true);
              reader.clear();
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search, or paste a YouTube link"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-dim focus:outline-none"
          />
          <kbd className="hidden flex-none rounded-md border border-line-2 px-1.5 text-xs text-dim md:inline">
            /
          </kbd>
        </form>
        {phone && <IconButton icon={X} label="Close search" className="md:hidden" onClick={done} />}
        {shown && (
          <div
            aria-label="Search results"
            className="absolute inset-x-2 top-full z-[60] mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-card p-1.5 shadow-2xl md:inset-x-0 md:mt-2"
          >
            <SearchResults text={text.trim()} results={results} actions={actions} />
          </div>
        )}
      </div>
    </>
  );
}
