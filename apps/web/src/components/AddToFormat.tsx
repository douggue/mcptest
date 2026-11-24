import { Check, Layers } from 'lucide-react';
import { useState } from 'react';
import { createFormatApi, type IngredientSourceRequest } from '../lib/formatApi';
import { viewHref } from '../lib/routes';
import { buttonClass } from './ui/Button';

const formatApi = createFormatApi();

type State =
  | { readonly status: 'idle' | 'adding' }
  | { readonly status: 'added' }
  | { readonly status: 'failed'; readonly message: string };

interface Props {
  /** What to put on the format builder's shelf. */
  readonly source: IngredientSourceRequest;
  /** Words on the button; "Add to format" by default. */
  readonly label?: string;
  /** Icon only, with the words as its label: for a tight card. */
  readonly iconOnly?: boolean;
  /** Drawn as a full second button, where it sits beside other buttons of that size. */
  readonly large?: boolean;
}

const BUTTON =
  'inline-flex min-h-9 flex-none items-center gap-1.5 rounded-full px-3 py-1 text-body-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Puts one piece of what the owner is looking at on the format builder's
 * shelf. The server reads the piece from the store and counts what it rests
 * on; once it is there the button links to the shelf.
 */
export function AddToFormat({ source, label = 'Add to format', iconOnly, large }: Props) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const button = large ? buttonClass('second') : BUTTON;
  if (state.status === 'added') {
    return (
      <a href={viewHref('format')} className={`${button} ${large ? '' : 'text-primary'}`}>
        <Check aria-hidden="true" className="h-4 w-4" />
        On your shelf
      </a>
    );
  }
  const add = async (): Promise<void> => {
    setState({ status: 'adding' });
    try {
      await formatApi.add(source);
      setState({ status: 'added' });
    } catch (error) {
      setState({
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2">
      <button
        type="button"
        onClick={() => void add()}
        disabled={state.status === 'adding'}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        className={button}
      >
        <Layers aria-hidden="true" className="h-4 w-4" />
        {!iconOnly && (state.status === 'adding' ? 'Adding…' : label)}
      </button>
      {state.status === 'failed' && (
        <span role="alert" className="min-w-0 break-words text-body-sm text-error">
          {state.message}
        </span>
      )}
    </span>
  );
}
