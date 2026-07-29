import { BillingPricing } from "../features/billing/BillingPricing";
import {
  BillingSummarySection,
  type BillingSummarySectionProps,
} from "../features/billing/BillingSummarySection";

export function BillingPage(props: BillingSummarySectionProps) {
  return (
    <>
      <BillingPricing />
      <BillingSummarySection {...props} />
    </>
  );
}
