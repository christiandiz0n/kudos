"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/design/cn";
import { MoneyGraph, type MoneyGraphProps } from "./MoneyGraph";

/**
 * The landscape money graph drawn at its container's real pixel size (QE F1). The fixed 1280x720 viewBox scaled a
 * 700px-wide card down to ~55%, so labels landed at 10-13px on the projector. Here the layout gets the measured box,
 * one SVG unit is one CSS pixel, and names/amounts keep an 18px floor. The wrapper reserves the space (no jump), and
 * the graph renders once the first measurement is in.
 */
export function FitMoneyGraph({ className, ...props }: Omit<MoneyGraphProps, "orientation" | "box">) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { w: Math.round(r.width), h: Math.round(r.height) };
      setBox((b) => (b && Math.abs(b.w - next.w) < 2 && Math.abs(b.h - next.h) < 2 ? b : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn(className ?? "relative h-full w-full")}>
      {box && box.w > 0 && box.h > 0 ? (
        <MoneyGraph {...props} orientation="landscape" box={box} className="absolute inset-0 h-full w-full" />
      ) : null}
    </div>
  );
}
