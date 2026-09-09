import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export { gsap, useGSAP };

export const MOTION = {
  ease: "power2.out",
  overlay: 0.2,
  drawer: 0.28,
  veil: 0.22,
  empty: 0.24,
} as const;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
