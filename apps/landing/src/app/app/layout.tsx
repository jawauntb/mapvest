"use client";

import { PaywallRoot } from "./Paywall";

export default function AppSectionLayout({ children }: { children: React.ReactNode }) {
  return <PaywallRoot>{children}</PaywallRoot>;
}
