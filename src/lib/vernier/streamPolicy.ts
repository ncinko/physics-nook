/**
 * When to open a detector stream, as a pure decision.
 *
 * This exists because getting it wrong is silent and expensive. A source
 * reports `connecting` twice — once for the device picker, once for the NGIO
 * handshake — so an effect that treats "not ready and not streaming" as "the
 * stream is gone" will re-open the stream the instant the handshake succeeds,
 * which restarts the handshake, forever. The symptom is a device that cycles
 * through its setup messages and never settles, and nothing in the transport
 * or protocol layers looks wrong while it happens.
 *
 * Keeping the rule here rather than inline in an effect means the transition
 * sequence can be asserted in `tests/vernier` instead of discovered on
 * hardware.
 */

import type { SourceStatusKind } from './sources/types.ts';

export type StreamDecision =
  /** Open a stream and remember the source it belongs to. */
  | 'start'
  /** Drop the remembered source; there is nothing streaming any more. */
  | 'forget'
  /** Leave things alone. */
  | 'wait';

export const decideStream = (
  sourceId: string | null,
  statusKind: SourceStatusKind,
  /** The source a stream was last opened for, or null. */
  streamedSource: string | null,
): StreamDecision => {
  // Gone or broken. A failed handshake must land here rather than retrying,
  // or a device that cannot be read becomes an infinite reconnect loop.
  if (
    sourceId === null ||
    statusKind === 'idle' ||
    statusKind === 'error' ||
    statusKind === 'unsupported'
  ) {
    return 'forget';
  }

  // `connecting` is a moment to do nothing: it is not ready to be told to
  // stream, and it does not mean an existing stream was lost.
  if (statusKind !== 'ready' && statusKind !== 'streaming') return 'wait';

  return streamedSource === sourceId ? 'wait' : 'start';
};
