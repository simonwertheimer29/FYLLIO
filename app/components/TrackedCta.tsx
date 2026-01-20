"use client";

import React from "react";

declare global {
  interface Window {
    plausible?: (eventName: string, options?: { props?: Record<string, any> }) => void;
  }
}

type Props = {
  href: string;
  className?: string;
  source: "navbar" | "hero";
  children: React.ReactNode;
};

export default function TrackedCta({ href, className, source, children }: Props) {
  const handleClick = () => {
    // Track
    if (typeof window !== "undefined" && window.plausible) {
      window.plausible("cta_interest_click", { props: { source } });
    }
  };

  return (
    <a href={href} className={className} onClick={handleClick}>
      {children}
    </a>
  );
}
