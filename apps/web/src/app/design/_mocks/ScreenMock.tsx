"use client";

import { CUSTOMER_SCREENS } from "./meta.customer";
import { CustomerMock } from "./CustomerMocks";
import { VENUE_SCREENS } from "./meta.venue";
import { VenueMock } from "./VenueMocks";

/** Dispatches /design screen ids: customer mocks (UI-customer) and venue/public mocks (UI-venue). */
export function ScreenMock({ id }: { id: string }) {
  if (CUSTOMER_SCREENS.some((s) => s.id === id)) return <CustomerMock id={id} />;
  if (VENUE_SCREENS.some((s) => s.id === id)) return <VenueMock id={id} />;
  return <p className="p-6">Unknown screen: {id}</p>;
}
