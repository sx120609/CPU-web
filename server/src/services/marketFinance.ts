export function calculateMarketOrderAmounts(amountCents: number, commissionBps: number) {
  const safeAmount = Math.max(0, Math.round(amountCents));
  const safeBps = Math.min(5000, Math.max(0, Math.round(commissionBps)));
  const platformFeeCents = Math.min(safeAmount, Math.round((safeAmount * safeBps) / 10_000));
  return {
    amountCents: safeAmount,
    commissionBps: safeBps,
    platformFeeCents,
    sellerAmountCents: safeAmount - platformFeeCents,
  };
}

