import { useCallback, useEffect, useState } from 'react';
import { redirectOf, routeFromHash, routeHash, type Route } from '../lib/routes';

/** How long a view is given to show an element an in-page link points to. */
const ANCHOR_WAIT_MS = 3000;
const ANCHOR_POLL_MS = 100;

/**
 * The screen the address names. An address from before the five places is
 * rewritten in place to the new one of the same screen, so the bar, a
 * bookmark made now and the back button all carry the new address.
 */
function current(): Route {
  const { hash } = window.location;
  const redirect = redirectOf(hash);
  if (redirect !== null) window.history.replaceState(window.history.state, '', redirect);
  return routeFromHash(hash);
}

/** Brings an element into view once it is on the page; sections load their data first. */
function scrollToWhenShown(id: string): () => void {
  const started = Date.now();
  const timer = window.setInterval(() => {
    const element = document.getElementById(id);
    if (element) element.scrollIntoView({ block: 'start' });
    if (element || Date.now() - started > ANCHOR_WAIT_MS) window.clearInterval(timer);
  }, ANCHOR_POLL_MS);
  return () => window.clearInterval(timer);
}

/**
 * The view on screen, read from the address, and the way to open another.
 * Opening a view adds it to the browser's history, so back and forward work
 * and a reload keeps it. A new view starts at its top, or at the element an
 * in-page link points to.
 */
export function useRoute() {
  const [route, setRoute] = useState<Route>(current);

  useEffect(() => {
    const follow = () => setRoute(current());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  const { view, channelId, anchor } = route;
  useEffect(() => {
    if (anchor) return scrollToWhenShown(anchor);
    window.scrollTo({ top: 0 });
    return undefined;
  }, [view, channelId, anchor]);

  const go = useCallback((next: Route) => {
    const hash = routeHash(next);
    if (window.location.hash === hash) setRoute(routeFromHash(hash));
    else window.location.hash = hash;
  }, []);

  return { route, go };
}

export type Go = (route: Route) => void;
