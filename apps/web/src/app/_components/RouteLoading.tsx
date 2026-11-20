import { AppFrame, Screen, Skeleton, SkeletonRow } from "@/components/ui";

/** Server-rendered shell shown until the browser-only screen mounts. */
export function RouteLoading() {
  return (
    <AppFrame>
      <Screen>
        <div aria-busy="true" className="pt-10">
          <span className="sr-only">Loading</span>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-12 w-48" />
          <div className="mt-8">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        </div>
      </Screen>
    </AppFrame>
  );
}
