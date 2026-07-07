"use client";

import { useState } from "react";

export default function LogoBadge({ src, alt, fallback }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className="logo-badge" aria-label={alt}>
      {!failed && src ? <img src={src} alt={alt} onError={() => setFailed(true)} /> : null}
      <span className={failed || !src ? "logo-fallback is-active" : "logo-fallback"}>{fallback}</span>
    </span>
  );
}
