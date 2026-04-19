'use client';

/**
 * useTweakMode — gate the <TweaksPanel /> dev surface
 * (memind-scrollytelling-rebuild AC-MSR-12).
 *
 * Ported from design-handoff `app.jsx` lines 269-282. The panel should
 * appear in three situations:
 *   1. The parent frame posts `__activate_edit_mode` (Claude Design's
 *      edit-mode IPC used when the canvas hosts the app in an iframe).
 *   2. The URL carries `?edit=1` — handy for local browser checks and
 *      for the demo recording takes.
 *   3. The page was loaded previously under either condition and has
 *      not received `__deactivate_edit_mode` yet.
 *
 * The hook also signals the parent that the page supports edit mode
 * by posting `__edit_mode_available` on mount (same handshake the
 * design-handoff prototype uses).
 *
 * Extracted as a pure `routeTweakMessage` helper so tests can exercise
 * the message-routing logic without a DOM — only the thin useState /
 * effect shell depends on the browser.
 */
import { useEffect, useState } from 'react';

export type TweakMessage =
  | { readonly type: '__activate_edit_mode' }
  | { readonly type: '__deactivate_edit_mode' };

/**
 * Pure message router. Returns the next active-state given the current
 * state + incoming `MessageEvent.data`, or `null` to indicate no
 * transition (the event was irrelevant). Exposed for unit tests.
 */
export function routeTweakMessage(data: unknown): boolean | null {
  if (!data || typeof data !== 'object') return null;
  const t = (data as { type?: unknown }).type;
  if (t === '__activate_edit_mode') return true;
  if (t === '__deactivate_edit_mode') return false;
  return null;
}

/**
 * Detect whether the URL is currently signalling `?edit=1`. SSR-safe
 * (returns false off the server) and tolerant of search strings with
 * extra params ahead of `edit`.
 */
export function readEditQuery(search: string): boolean {
  if (!search) return false;
  // Strip leading `?` then split into key/value pairs.
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return params.get('edit') === '1';
}

export function useTweakMode(): boolean {
  const [active, setActive] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Seed from the URL once on mount.
    if (readEditQuery(window.location.search)) {
      setActive(true);
    }
    const onMsg = (e: MessageEvent): void => {
      const next = routeTweakMessage(e.data);
      if (next !== null) setActive(next);
    };
    window.addEventListener('message', onMsg);
    // Same handshake the design-handoff prototype uses to announce that
    // the embedded page accepts edit-mode IPC. `window.parent` is always
    // defined — it points back at the window itself for top-level pages.
    try {
      window.parent?.postMessage({ type: '__edit_mode_available' }, '*');
    } catch {
      /* ignore cross-origin post failures — non-critical handshake */
    }
    return () => window.removeEventListener('message', onMsg);
  }, []);

  return active;
}
