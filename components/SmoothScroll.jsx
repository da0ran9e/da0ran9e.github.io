"use client";

import Lenis from "lenis";
import { useEffect } from "react";

export default function SmoothScroll() {
  useEffect(() => {
    const root = document.documentElement;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let lenis;
    let rafId;

    const updateScrollVars = () => {
      const maxScroll = Math.max(1, root.scrollHeight - window.innerHeight);
      const y = window.scrollY || root.scrollTop || 0;
      root.style.setProperty("--scroll-y", `${y}px`);
      root.style.setProperty("--scroll-progress", `${Math.min(1, y / maxScroll)}`);
    };

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );

    document.querySelectorAll("[data-reveal]").forEach((node) => {
      revealObserver.observe(node);
    });

    updateScrollVars();

    if (!reduceMotion) {
      lenis = new Lenis({
        duration: 1.08,
        smoothWheel: true,
        wheelMultiplier: 0.86,
        touchMultiplier: 1.08,
        easing: (t) => Math.min(1, 1.001 - 2 ** (-10 * t)),
      });

      const frame = (time) => {
        lenis.raf(time);
        updateScrollVars();
        rafId = requestAnimationFrame(frame);
      };

      rafId = requestAnimationFrame(frame);
    } else {
      window.addEventListener("scroll", updateScrollVars, { passive: true });
    }

    return () => {
      revealObserver.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      if (lenis) lenis.destroy();
      window.removeEventListener("scroll", updateScrollVars);
    };
  }, []);

  return null;
}
