import type { Investable } from "@/api/types";

export type IdentifyProgressStage = "preparing" | "identifying";

type IdentifyProgressCopy = {
  label: string;
  detail: string;
  completedSteps: number;
};

/**
 * The client only knows when its photo is ready and when the identify request
 * has started. The final match stage deliberately remains pending: the API
 * does not stream server-side progress, so we must not present a guess as a
 * completed lookup.
 */
export function identifyProgressCopy(stage: IdentifyProgressStage): IdentifyProgressCopy {
  if (stage === "identifying") {
    return {
      label: "Identifying what’s in view",
      detail: "Next, we’ll match it to public ways to invest.",
      completedSteps: 1,
    };
  }

  return {
    label: "Preparing your photo",
    detail: "Then we’ll identify the brand and check public matches.",
    completedSteps: 0,
  };
}

/** Keep the primary match prominent while retaining every returned result. */
export function splitInvestableResults(investables: Investable[] | undefined): {
  primary: Investable | undefined;
  additional: Investable[];
} {
  const [primary, ...additional] = investables ?? [];
  return { primary, additional };
}

export function investableTicker(investable: Investable): string | undefined {
  return investable.brand.ticker?.symbol ?? investable.comparables[0]?.ticker;
}

export function investableLabel(investable: Investable): string {
  const ticker = investableTicker(investable);
  return ticker ? `$${ticker}` : "Private · no public match yet";
}
