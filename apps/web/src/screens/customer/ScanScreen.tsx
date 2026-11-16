import type { ReactNode } from "react";
import { Button, IconButton } from "@/components/ui";

export interface ScanScreenProps {
  /** The live camera element (FRONTEND_INTEGRATION). The mock renders a dark placeholder. */
  camera?: ReactNode;
  hint?: string;
  error?: string;
  onClose?: () => void;
  onEnterCode?: () => void;
}

/** Full-bleed camera with a calm viewfinder. Always dark, regardless of theme (it's a camera). */
export function ScanScreen({ camera, hint = "Point at the code on the counter screen", error, onClose, onEnterCode }: ScanScreenProps) {
  return (
    <div data-theme="dark" className="relative flex h-full min-h-full flex-col overflow-hidden bg-[#0d0c0b] text-ink">
      <div className="absolute inset-0">{camera ?? <div className="size-full bg-[radial-gradient(120%_80%_at_50%_40%,#2a2723_0%,#0d0c0b_70%)]" />}</div>
      <div className="relative flex items-center justify-between px-3 pt-3">
        <IconButton icon="close" label="Close scanner" onClick={onClose} />
        <p className="text-body font-semibold">Scan to pay</p>
        <span className="size-12" />
      </div>
      <div className="relative flex flex-1 flex-col items-center justify-center px-8">
        {/* Viewfinder: four soft corners */}
        <div aria-hidden className="relative size-64">
          {["top-0 left-0 border-t-4 border-l-4 rounded-tl-[28px]", "top-0 right-0 border-t-4 border-r-4 rounded-tr-[28px]", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-[28px]", "bottom-0 right-0 border-r-4 border-b-4 rounded-br-[28px]"].map((c) => (
            <span key={c} className={`absolute size-14 border-white/90 ${c}`} />
          ))}
        </div>
        <p className="mt-8 max-w-[26ch] text-center text-body text-white/85" role="status">
          {error ?? hint}
        </p>
      </div>
      <div className="relative px-5 pb-8">
        <Button block variant="ghost" className="text-white hover:bg-white/10" onClick={onEnterCode}>
          Type the code instead
        </Button>
      </div>
    </div>
  );
}
