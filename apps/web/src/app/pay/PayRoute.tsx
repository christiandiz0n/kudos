"use client";

import { useSearchParams } from "next/navigation";
import { parsePayParams } from "@/lib/qr";
import { AccountGate } from "../_components/AccountGate";
import { InvalidPayLink } from "./InvalidPayLink";
import { PayFlow } from "./PayFlow";

export function PayRoute() {
  const params = useSearchParams();
  // QE-3-01: a malformed link is answered before sign-in or any quote (nothing to pay, nothing to retry).
  const link = parsePayParams(params.get("v"), params.get("o"));
  if (!link) return <InvalidPayLink />;
  return <AccountGate>{(ctx) => <PayFlow key={`${link.venue}-${link.orderId}`} {...ctx} venue={link.venue} orderId={link.orderId} />}</AccountGate>;
}
