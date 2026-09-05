/**
 * When a found update is allowed to interrupt someone.
 *
 * Separated from the code that talks to GitHub and puts dialogs on screen so the
 * rule itself can be tested. It is the part most likely to be got wrong, and the
 * consequence of getting it wrong is a dialog over a projector in a full hall.
 *
 * Nothing here imports Electron, on purpose.
 */

export type UpdateAction =
  /** Nothing to say. */
  | { readonly kind: 'nothing' }
  /** Change the menu line only. No dialog, no focus, no sound. */
  | { readonly kind: 'menu-only'; readonly version: string }
  /** Ask properly. */
  | { readonly kind: 'offer'; readonly version: string };

export interface UpdateSituation {
  /** The version waiting, or null when this copy is current. */
  readonly version: string | null;
  /** Is a tournament being played right now? Unknown counts as yes. */
  readonly tournamentLive: boolean;
  /** A version the organiser has already turned down. */
  readonly declined: string | null;
  /** Did the organiser ask for this check, rather than it happening on a timer? */
  readonly askedFor: boolean;
}

export function decideUpdateAction(situation: UpdateSituation): UpdateAction {
  const { version, tournamentLive, declined, askedFor } = situation;
  if (version === null) return { kind: 'nothing' };

  // They opened the menu and clicked it, so answer, whatever else is going on.
  if (askedFor) return { kind: 'offer', version };

  // A tournament is being played. The menu may say so; nothing may take focus.
  if (tournamentLive) return { kind: 'menu-only', version };

  // Already said no to this one. Asking again every six hours is nagging.
  if (declined === version) return { kind: 'menu-only', version };

  return { kind: 'offer', version };
}
