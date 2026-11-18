"use client";

import { useParams } from "next/navigation";
import { Record } from "../../_components/Record";

export function PublicRecord() {
  const { address } = useParams<{ address: string }>();
  return <Record address={address} viewer="visitor" />;
}
