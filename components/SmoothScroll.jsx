"use client";

import Lenis from "lenis";
import { useEffect } from "react";

export default function SmoothScroll() {
  useEffect(() => {
    const root = document.documentElement;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let lenis;
    let rafId;
    const parallax = {
      far: 0,
      mid: 0,
      near: 0,
      foreground: 0,
    };

    const paintScrollVars = (y) => {
      const maxScroll = Math.max(1, root.scrollHeight - window.innerHeight);
      root.style.setProperty("--scroll-y", `${y}px`);
      root.style.setProperty("--scroll-progress", `${Math.min(1, y / maxScroll)}`);
      root.style.setProperty("--parallax-far", `${parallax.far}px`);
      root.style.setProperty("--parallax-mid", `${parallax.mid}px`);
      root.style.setProperty("--parallax-near", `${parallax.near}px`);
      root.style.setProperty("--parallax-foreground", `${parallax.foreground}px`);
    };

    const updateScrollVars = () => {
      const y = window.scrollY || root.scrollTop || 0;
      parallax.far = y;
      parallax.mid = y;
      parallax.near = y;
      parallax.foreground = y;
      paintScrollVars(y);
    };

    const updateLayeredScrollVars = () => {
      const y = window.scrollY || root.scrollTop || 0;
      parallax.far += (y - parallax.far) * 0.055;
      parallax.mid += (y - parallax.mid) * 0.095;
      parallax.near += (y - parallax.near) * 0.15;
      parallax.foreground += (y - parallax.foreground) * 0.22;
      paintScrollVars(y);
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
        updateLayeredScrollVars();
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
