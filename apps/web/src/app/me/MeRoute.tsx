"use client";

import { AccountGate } from "../_components/AccountGate";
import { Record } from "../_components/Record";

export function MeRoute() {
  return <AccountGate>{(ctx) => <Record address={ctx.address} viewer="owner" fallbackName={ctx.name} />}</AccountGate>;
}
