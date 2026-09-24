/**
 * Photogates on a LabQuest, over WebUSB.
 *
 * Gate A on DIG 1, and Gate B either on DIG 2 or daisy-chained into Gate A.
 * The session profile finds out which; this source passes the beam edges
 * through untouched for `photogateTiming.ts` to read.
 */

import type { NgioEdgeEvent } from '../ngioPackets.ts';
import { photogateWiring } from '../ngioSession.ts';
import { createNgioUsbTransport } from './ngioUsbTransport.ts';
import { createEmitter, type PhotogateSource } from './types.ts';

export const createWebUsbPhotogateSource = (): PhotogateSource => {
  const edges = createEmitter<NgioEdgeEvent>();

  const transport = createNgioUsbTransport({
    profile: 'photogate',
    // Edge detection is aperiodic: an unbroken beam sends nothing, and that
    // silence is the gates waiting, not the stream dying.
    streamingWatchdog: false,
    sourceLabel: 'LabQuest photogates over USB (WebUSB)',
    onStreamStart: () => {},
    onStreaming: (result) => {
      result.edges.forEach(edges.emit);
    },
  });

  return {
    id: 'webusb',
    label: 'LabQuest over USB',
    isReal: true,
    isSupported: transport.isSupported,
    connect: transport.connect,
    start: transport.start,
    stop: transport.stop,

    disconnect: async () => {
      await transport.disconnect();
      edges.clear();
    },

    subscribeEdges: edges.subscribe,
    wiring: () => {
      const session = transport.session();
      return session ? photogateWiring(session) : null;
    },
    onStatus: transport.onStatus,
    diagnostics: transport.diagnostics,
  };
};
