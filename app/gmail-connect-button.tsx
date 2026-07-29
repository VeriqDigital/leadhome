"use client";

import { useRef, useState } from "react";

type StartedRef = { current: boolean };

export function startSingleFlightOAuthNavigation(
  started: StartedRef,
  navigate: (href: string) => void,
  href: string,
): boolean {
  if (started.current) return false;
  started.current = true;
  navigate(href);
  return true;
}

export function GmailConnectButton({
  reconnect = false,
  className,
  children,
}: {
  reconnect?: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const started = useRef(false);
  const [starting, setStarting] = useState(false);
  const href = reconnect
    ? "/api/gmail/connect?reconnect=1"
    : "/api/gmail/connect";

  function begin() {
    if (
      !startSingleFlightOAuthNavigation(
        started,
        (destination) => window.location.assign(destination),
        href,
      )
    ) {
      return;
    }
    setStarting(true);
  }

  return (
    <button
      type="button"
      disabled={starting}
      aria-busy={starting}
      onClick={begin}
      className={`${className} cursor-pointer disabled:cursor-wait disabled:opacity-60`}
    >
      {starting ? "Opening Google…" : children}
    </button>
  );
}
