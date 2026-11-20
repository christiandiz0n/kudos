import { Suspense } from "react";
import { notFound } from "next/navigation";
import { SCREENS } from "../../_mocks/meta";
import { ScreenMock } from "../../_mocks/ScreenMock";
import { AppFrame } from "@/components/ui/AppFrame";

export function generateStaticParams() {
  return SCREENS.map((s) => ({ id: s.id }));
}

async function ScreenRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = SCREENS.find((s) => s.id === id);
  if (!meta) notFound();
  const body = (
    <div
      data-screen={id}
      data-technical={meta.technical ? "true" : undefined}
      className={
        meta.desktop
          ? "min-h-dvh w-full"
          : meta.fixed
            ? "relative mx-auto h-dvh w-full max-w-[430px] overflow-hidden sm:max-w-none"
            : "mx-auto flex min-h-dvh w-full max-w-[430px] flex-1 flex-col sm:max-w-none"
      }
    >
      <ScreenMock id={id} />
    </div>
  );
  // A9: phone screens sit in the same centered column as the app from 640px up.
  return meta.desktop ? body : <AppFrame>{body}</AppFrame>;
}

/** Full-bleed single screen at real size (for phone testing and screenshots). */
export default function DesignScreenPage({ params }: PageProps<"/design/screens/[id]">) {
  return (
    <Suspense>
      <ScreenRoute params={params} />
    </Suspense>
  );
}
