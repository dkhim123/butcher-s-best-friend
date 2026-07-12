import { useEffect, useState, ReactNode } from "react";
import { WifiOff } from "lucide-react";

/**
 * OfflineGuard — Tavern Inn is an online-only system. If the Wi-Fi drops, we
 * do NOT let staff keep "selling" against stale data; instead we show one calm
 * full-screen notice until the connection returns.
 *
 * The app underneath stays mounted (so nothing is lost — a half-typed cart is
 * still there when the network comes back); we just cover it and block input.
 */
export function OfflineGuard({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return (
    <>
      {children}
      {!online && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm p-6"
          role="alertdialog"
          aria-label="No internet connection"
        >
          <div className="max-w-sm text-center space-y-4">
            <div className="mx-auto h-16 w-16 rounded-2xl bg-destructive/10 grid place-items-center">
              <WifiOff className="h-8 w-8 text-destructive" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-xl font-bold">You're offline</h2>
              <p className="text-sm text-muted-foreground">
                This system needs an internet connection to keep everything in
                sync. Reconnect to your Wi-Fi and this will disappear
                automatically — nothing you were doing is lost.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">Waiting for connection…</p>
          </div>
        </div>
      )}
    </>
  );
}
