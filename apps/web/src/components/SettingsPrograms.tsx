import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSettingsApi, type AllowReport, type ProgramsReport } from '../lib/settings';
import { Label } from './layout/Card';
import { Details } from './layout/Details';
import { QUIET_BUTTON } from './LabStatus';

type Programs =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly report: ProgramsReport }
  | { readonly status: 'failed'; readonly message: string };

type Allowed = AllowReport | { readonly failed: string } | null;

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong';

/** One block of what `npm run engines` prints: its heading, then a line each. */
function ReportLines({ lines }: { readonly lines: readonly string[] }) {
  const [heading, ...rest] = lines;
  return (
    <div className="flex flex-col gap-1">
      {heading && <span className="text-label text-outline">{heading.trim()}</span>}
      <ul className="flex flex-col gap-1">
        {rest.map((line) => (
          <li key={line} className="break-words">
            {line.trim()}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Report({ programs }: { readonly programs: Programs }) {
  if (programs.status === 'loading') {
    return (
      <p role="status" className="text-body-sm text-on-surface-variant">
        Looking for the AI programs and helper programs. This takes a few seconds.
      </p>
    );
  }
  if (programs.status === 'failed') {
    return (
      <p role="alert" className="text-body-sm text-error">
        {programs.message}
      </p>
    );
  }
  return (
    <Details summary="What Jgtube found">
      <div className="flex flex-col gap-3 text-body-sm text-on-surface-variant">
        <ReportLines lines={programs.report.engines} />
        <ReportLines lines={programs.report.helpers} />
      </div>
    </Details>
  );
}

/** The button that lets Antigravity use Jgtube's tools, and what it did. */
function AllowAntigravity({
  allowed,
  onAllow,
}: {
  readonly allowed: Allowed;
  readonly onAllow: () => void;
}) {
  return (
    <Details summary="Let Antigravity use Jgtube’s tools">
      <p className="text-body-sm text-on-surface-variant">
        Antigravity needs one line in its own settings before a run started by Jgtube may use
        Jgtube&rsquo;s tools. This adds it, and keeps a copy of the settings as they were.
      </p>
      <button type="button" onClick={onAllow} className={`${QUIET_BUTTON} w-fit`}>
        Let Antigravity use Jgtube&rsquo;s tools
      </button>
      {allowed && 'failed' in allowed && (
        <p role="alert" className="text-body-sm text-error">
          {allowed.failed}
        </p>
      )}
      {allowed && 'lines' in allowed && (
        <ul
          role="status"
          className={`flex flex-col gap-1 text-body-sm ${allowed.ok ? 'text-on-surface' : 'text-error'}`}
        >
          {allowed.lines.map((line) => (
            <li key={line} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      )}
    </Details>
  );
}

/** What `npm run engines` prints, and the button that lets Antigravity use Jgtube's tools. */
export function ProgramsPanel({ refreshKey }: { readonly refreshKey: number }) {
  const api = useMemo(() => createSettingsApi(), []);
  const [programs, setPrograms] = useState<Programs>({ status: 'loading' });
  const [allowed, setAllowed] = useState<Allowed>(null);
  const check = useCallback(() => {
    setPrograms({ status: 'loading' });
    api.programs().then(
      (report) => setPrograms({ status: 'ready', report }),
      (error: unknown) => setPrograms({ status: 'failed', message: messageOf(error) }),
    );
  }, [api]);
  // Checked when the screen opens and again after each save, which may have changed a path.
  useEffect(check, [check, refreshKey]);
  const allow = () => {
    api
      .allowAntigravity()
      .then(setAllowed, (error: unknown) => setAllowed({ failed: messageOf(error) }));
  };
  return (
    <section aria-labelledby="settings-programs" className="flex min-w-0 flex-col gap-space-sm">
      <Label
        action={
          <button
            type="button"
            onClick={check}
            className="flex items-center gap-1 rounded text-body-sm text-primary hover:underline"
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
            Check again
          </button>
        }
      >
        <span id="settings-programs">Programs on this computer</span>
      </Label>
      <Report programs={programs} />
      <AllowAntigravity allowed={allowed} onAllow={allow} />
    </section>
  );
}
