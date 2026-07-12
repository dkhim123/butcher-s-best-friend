import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

/**
 * Captured Chrome/Edge/Android install prompt. Not in the standard DOM lib
 * types, so we describe the shape we use.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true);

/**
 * InstallButton — offers to install the PWA on phone, tablet, desktop & laptop.
 *
 * - Chrome/Edge/Android: uses the real `beforeinstallprompt` event.
 * - iOS Safari (no such event): shows the Share → "Add to Home Screen" hint.
 * - Hidden once the app is already installed / running standalone.
 */
export function InstallButton({
  variant = "outline",
  className,
}: {
  variant?: "outline" | "ghost" | "secondary";
  className?: string;
}) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const isIos =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !/crios|fxios/i.test(navigator.userAgent);

  // Nothing to offer: not iOS and no captured prompt yet (e.g. Firefox desktop).
  if (!deferred && !isIos) return null;

  const handleClick = async () => {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      return;
    }
    if (isIos) setShowIosHint((v) => !v);
  };

  return (
    <div className="relative">
      <Button variant={variant} size="sm" onClick={handleClick} className={`gap-1.5 ${className ?? ""}`}>
        <Download className="h-4 w-4" />
        Install app
      </Button>
      {showIosHint && (
        <div className="absolute right-0 z-50 mt-2 w-60 rounded-lg border bg-popover p-3 text-xs shadow-elevated">
          On iPhone/iPad: tap the <strong>Share</strong> icon, then{" "}
          <strong>“Add to Home Screen”</strong>.
        </div>
      )}
    </div>
  );
}
