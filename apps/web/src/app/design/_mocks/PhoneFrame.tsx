import type { ReactNode } from "react";
import Link from "next/link";

/** 390×844 device frame for /design. At narrow viewports it shrinks to the column width. */
export function PhoneFrame({ id, title, who, note, children }: { id: string; title: string; who: string; note: string; children: ReactNode }) {
  return (
    <figure className="flex w-full max-w-[390px] flex-col gap-3" data-screen={id}>
      <div className="relative h-[844px] w-full overflow-hidden rounded-[40px] bg-canvas shadow-2 ring-1 ring-line [transform:translateZ(0)]">
        {children}
      </div>
      <figcaption className="px-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-body-sm font-semibold text-ink">{title}</p>
          <span className="text-caption text-ink-3">{who}</span>
        </div>
        <p className="mt-0.5 text-caption text-ink-2">{note}</p>
        <Link href={`/design/screens/${id}`} className="focus-ring mt-1 inline-block rounded-xs text-caption font-semibold text-accent-ink underline-offset-4 hover:underline">
          Open full screen
        </Link>
      </figcaption>
    </figure>
  );
}
