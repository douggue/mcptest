import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * `main` is the screen's one next step (cyan); `second` is any other action;
 * `text` is a link that reads as words.
 */
export type ButtonKind = 'main' | 'second' | 'text';

const BASE =
  'inline-flex flex-none items-center justify-center gap-2 whitespace-nowrap border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-not-allowed disabled:opacity-50';
const KIND: Readonly<Record<ButtonKind, string>> = {
  main: 'border-transparent bg-signal text-on-signal shadow-[0_6px_24px_-8px_rgba(0,210,255,0.6)] hover:brightness-110',
  second: 'border-line bg-white/[0.06] text-ink hover:border-line-2 hover:bg-white/10',
  text: 'border-transparent px-1.5 text-link hover:underline',
};
const SIZE = {
  regular: 'h-11 rounded px-[18px] text-[15px]',
  small: 'h-9 rounded-md px-3 text-body-sm',
} as const;

/** The classes of a button, for the few places that draw their own element. */
export const buttonClass = (kind: ButtonKind = 'second', small = false, wide = false): string =>
  `${BASE} ${KIND[kind]} ${SIZE[small ? 'small' : 'regular']} ${wide ? 'w-full' : ''}`;

interface Props {
  readonly children: ReactNode;
  readonly kind?: ButtonKind;
  readonly small?: boolean;
  /** Fills the width it is given. */
  readonly wide?: boolean;
  readonly icon?: LucideIcon;
  /** An icon after the words, such as an arrow. */
  readonly iconAfter?: LucideIcon;
  /** With an address the button is a link. */
  readonly href?: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly submit?: boolean;
  readonly label?: string;
}

/** A button of the design system: one cyan `main` per screen, `second` for the rest. */
export function Button(props: Props) {
  const { children, kind, small, wide, icon: Icon, iconAfter: After, href, label } = props;
  const size = small ? 'h-4 w-4' : 'h-[18px] w-[18px]';
  const inside = (
    <>
      {Icon && <Icon aria-hidden="true" className={`${size} flex-none`} />}
      {children}
      {After && <After aria-hidden="true" className={`${size} flex-none`} />}
    </>
  );
  const className = buttonClass(kind, small, wide);
  if (href !== undefined) {
    return (
      <a href={href} onClick={props.onClick} aria-label={label} className={className}>
        {inside}
      </a>
    );
  }
  return (
    <button
      type={props.submit ? 'submit' : 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={label}
      className={className}
    >
      {inside}
    </button>
  );
}

interface IconProps {
  readonly icon: LucideIcon;
  /** What the button does, read aloud and shown on hover. */
  readonly label: string;
  readonly href?: string;
  readonly onClick?: () => void;
  readonly bordered?: boolean;
  readonly pressed?: boolean;
  readonly className?: string;
}

const ICON_BUTTON =
  'grid h-10 w-10 flex-none place-items-center rounded border text-muted transition-colors hover:bg-white/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal aria-[current=page]:text-signal aria-pressed:text-signal';

/** A square button that is only an icon. */
export function IconButton(props: IconProps) {
  const { icon: Icon, label, href, onClick, bordered, pressed, className } = props;
  const classes = `${ICON_BUTTON} ${bordered ? 'border-line' : 'border-transparent'} ${className ?? ''}`;
  const icon = <Icon aria-hidden="true" className="h-5 w-5" />;
  if (href !== undefined) {
    return (
      <a href={href} onClick={onClick} aria-label={label} title={label} className={classes}>
        {icon}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={classes}
    >
      {icon}
    </button>
  );
}
