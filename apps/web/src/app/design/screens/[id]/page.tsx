import { Suspense } from "react";
import { notFound } from "next/navigation";
import { SCREENS } from "../../_mocks/meta";
import { ScreenMock } from "../../_mocks/ScreenMock";

export function generateStaticParams() {
  return SCREENS.map((s) => ({ id: s.id }));
}

async function ScreenRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = SCREENS.find((s) => s.id === id);
  if (!meta) notFound();
  return (
    <div
      data-screen={id}
      data-technical={meta.technical ? "true" : undefined}
      className={
        meta.desktop
          ? "min-h-dvh w-full"
          : meta.fixed
            ? "relative mx-auto h-dvh w-full max-w-[430px] overflow-hidden"
            : "mx-auto flex min-h-dvh w-full max-w-[430px] flex-col"
      }
    >
      <ScreenMock id={id} />
    </div>
  );
}

/** Full-bleed single screen at real size (for phone testing and screenshots). */
export default function DesignScreenPage({ params }: PageProps<"/design/screens/[id]">) {
  return (
    <Suspense>
      <ScreenRoute params={params} />
    </Suspense>
  );
}
