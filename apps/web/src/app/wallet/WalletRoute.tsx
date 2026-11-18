"use client";

import { AccountGate } from "../_components/AccountGate";
import { WalletHome } from "./WalletHome";

export function WalletRoute() {
  return <AccountGate>{(ctx) => <WalletHome {...ctx} />}</AccountGate>;
}
