/**
 * useWeighingScale — optional Web Serial weighing-scale integration
 *
 * WHAT THIS DOES (in plain English):
 *   Most retail digital scales have a serial output (USB-to-serial cable).
 *   Modern Chrome / Edge browsers can talk to those scales via the Web Serial API.
 *   This hook lets the user click "Connect scale", pick the COM port, and from
 *   then on every weight reading from the scale shows up as a number we can
 *   use to auto-fill the kg input.
 *
 *   If the browser doesn't support Web Serial (Firefox, Safari, mobile),
 *   `isSupported` will be false and the user just types the kg manually.
 *
 * COMMON SCALE OUTPUT FORMATS (we try to parse them all):
 *   "ST,GS,+002.350kg\r\n"      ← TSC / Adam / Kern toledo-style
 *   "  2.350 kg\r\n"            ← Avery, Aclas
 *   "+02.350 KG\r\n"            ← CAS
 *   "2.350\r\n"                 ← Generic "just the number"
 *
 * WHAT GETS USED:
 *   const { isSupported, connected, lastWeight, connect, disconnect } = useWeighingScale();
 *   <input value={qtyInput || (lastWeight ? lastWeight.toFixed(3) : "")} />
 *
 * NOTE: Web Serial requires HTTPS or localhost. Localhost is fine for dev.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// Web Serial API isn't in TypeScript's lib.dom yet. We type the bits we use.
interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

interface SerialNavigator extends Navigator {
  serial?: {
    requestPort(options?: unknown): Promise<SerialPortLike>;
    getPorts(): Promise<SerialPortLike[]>;
  };
}

const WEIGHT_REGEX =
  /([+-]?\s*\d+(?:[.,]\d+)?)\s*(?:kg|KG|g|G)?/;

function parseWeight(buf: string): number | null {
  const m = buf.match(WEIGHT_REGEX);
  if (!m) return null;
  const raw = m[1].replace(/\s+/g, "").replace(",", ".");
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (buf.toLowerCase().includes(" g") && !buf.toLowerCase().includes("kg")) {
    return n / 1000;
  }
  return n;
}

export interface WeighingScaleState {
  isSupported: boolean;
  connected: boolean;
  lastWeight: number | null;
  lastReadAt: number | null;
  error: string | null;
  connect: (baudRate?: number) => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useWeighingScale(): WeighingScaleState {
  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const stopRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [lastWeight, setLastWeight] = useState<number | null>(null);
  const [lastReadAt, setLastReadAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSupported =
    typeof navigator !== "undefined" &&
    typeof (navigator as SerialNavigator).serial !== "undefined" &&
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.protocol === "https:");

  const readLoop = useCallback(async () => {
    if (!portRef.current?.readable) return;
    const decoder = new TextDecoder();
    let buffer = "";

    while (!stopRef.current) {
      const reader = portRef.current.readable.getReader();
      readerRef.current = reader;
      try {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          let nl = buffer.indexOf("\n");
          while (nl !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (line) {
              const w = parseWeight(line);
              if (w != null && w >= 0 && w < 10_000) {
                setLastWeight(Number(w.toFixed(3)));
                setLastReadAt(Date.now());
              }
            }
            nl = buffer.indexOf("\n");
          }
        }
      } catch (err) {
        if (!stopRef.current) {
          setError(err instanceof Error ? err.message : "Read failed");
        }
        break;
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* noop */
        }
        readerRef.current = null;
      }
    }
  }, []);

  const connect = useCallback(
    async (baudRate: number = 9600) => {
      setError(null);
      if (!isSupported) {
        setError("This browser doesn't support the Web Serial API. Use Chrome or Edge on desktop.");
        return;
      }
      try {
        const serial = (navigator as SerialNavigator).serial!;
        const port = await serial.requestPort();
        await port.open({ baudRate });
        portRef.current = port;
        stopRef.current = false;
        setConnected(true);
        readLoop();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to connect");
      }
    },
    [isSupported, readLoop],
  );

  const disconnect = useCallback(async () => {
    stopRef.current = true;
    try {
      await readerRef.current?.cancel();
    } catch {
      /* noop */
    }
    try {
      await portRef.current?.close();
    } catch {
      /* noop */
    }
    portRef.current = null;
    readerRef.current = null;
    setConnected(false);
  }, []);

  useEffect(() => () => {
    void disconnect();
  }, [disconnect]);

  return { isSupported, connected, lastWeight, lastReadAt, error, connect, disconnect };
}
