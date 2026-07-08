"use client";

import { ArrowUpRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export default function GatedAppTile({ app, index }) {
  const [armed, setArmed] = useState(false);
  const clickBurst = useRef(0);
  const tripleCount = useRef(0);
  const resetTimer = useRef(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
    };
  }, []);

  const resetGate = () => {
    clickBurst.current = 0;
    tripleCount.current = 0;
    setArmed(false);
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
  };

  const openApp = () => {
    resetGate();
    if (app.href.startsWith("http")) {
      window.open(app.href, "_blank", "noopener,noreferrer");
      return;
    }
    window.location.href = app.href;
  };

  const handleClick = (event) => {
    event.preventDefault();

    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(resetGate, 6500);

    clickBurst.current += 1;

    if (clickBurst.current >= 3) {
      clickBurst.current = 0;
      tripleCount.current += 1;
      setArmed(true);

      if (tripleCount.current >= 2) openApp();
    }
  };

  return (
    <a
      className={armed ? "app-tile is-armed" : "app-tile"}
      style={{ "--i": index }}
      href={app.href}
      onClick={handleClick}
      onDragStart={(event) => event.preventDefault()}
    >
      <span>{app.stack}</span>
      <h3>{app.title}</h3>
      <p>{app.summary}</p>
      <ArrowUpRight size={17} strokeWidth={1.8} />
    </a>
  );
}
