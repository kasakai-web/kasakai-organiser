"use client";

import Script from "next/script";
import { useEffect, useRef, useSyncExternalStore } from "react";

type Gsi = {
  accounts: {
    id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
    };
  };
};
declare global {
  interface Window { google?: Gsi }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const noSubscribe = () => () => {};
// WhatsApp / Instagram / Facebook webviews — where a shared link opens.
const isInAppBrowser = () =>
  /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|LinkedInApp|Snapchat|Pinterest|MicroMessenger|Twitter/i.test(navigator.userAgent);

// False inside WhatsApp/Instagram webviews, where Google refuses to sign anyone
// in (phone + code works there), and when no client id is configured.
export function useGoogleAvailable() {
  const inApp = useSyncExternalStore(noSubscribe, isInAppBrowser, () => true);
  return !!CLIENT_ID && !inApp;
}

// Google's own "Sign in with Google" button (Google Identity Services). It hands
// back an ID token that the backend verifies; there is no redirect and no secret.
export function GoogleSignInButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(onCredential);
  useEffect(() => { latest.current = onCredential; });

  if (!CLIENT_ID) return null;

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        onReady={() => {
          if (!box.current || !window.google) return;
          window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: (r) => latest.current(r.credential) });
          window.google.accounts.id.renderButton(box.current, {
            theme: "filled_black", size: "large", text: "continue_with", width: Math.min(box.current.offsetWidth, 400),
          });
        }}
      />
      <div ref={box} style={{ display: "flex", justifyContent: "center", minHeight: "44px" }} />
    </>
  );
}
