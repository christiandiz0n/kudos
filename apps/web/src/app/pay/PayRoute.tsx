"use client";

import { AccountGate } from "../_components/AccountGate";
import { PayFlow } from "./PayFlow";

export function PayRoute() {
  return <AccountGate>{(ctx) => <PayFlow {...ctx} />}</AccountGate>;
}
