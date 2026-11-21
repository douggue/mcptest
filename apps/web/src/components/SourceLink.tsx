/** A web page a fact or a verdict rests on, named by its site, opening in a new tab. */
export function SourceLink({ href }: { readonly href: string }) {
  let site = href;
  try {
    site = new URL(href).hostname.replace(/^www\./, '');
  } catch {
    // Only https addresses reach the page; one that does not read as an address shows whole.
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
    >
      {site}
    </a>
  );
}
