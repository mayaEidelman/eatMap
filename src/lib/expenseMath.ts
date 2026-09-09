import type { Expense, ExpenseSettlement, ExpenseShare } from '../types';

const EPSILON = 0.01;

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Splits `amount` evenly across participants, handing any leftover cent(s) from rounding to the
 * first few participants so the shares always sum exactly to `amount`. */
export function splitEqually(amount: number, participantIds: string[]): ExpenseShare[] {
  if (participantIds.length === 0) return [];

  const totalCents = toCents(amount);
  const baseCents = Math.floor(totalCents / participantIds.length);
  const remainder = totalCents - baseCents * participantIds.length;

  return participantIds.map((userId, index) => ({
    userId,
    amount: (baseCents + (index < remainder ? 1 : 0)) / 100,
  }));
}

export function sharesSumTo(shares: ExpenseShare[], amount: number): boolean {
  const sum = shares.reduce((total, share) => total + share.amount, 0);
  return Math.abs(sum - amount) < EPSILON;
}

export type Balance = { userId: string; net: number };

/** Net balance per member in the group's base currency. Positive means the group owes them money;
 * negative means they owe the group. Each expense's shares are stored in that expense's original
 * currency, so they're converted using the same exchange rate snapshotted on the expense. */
export function computeBalances(
  memberIds: string[],
  expenses: Expense[],
  settlements: ExpenseSettlement[],
): Balance[] {
  const net = new Map<string, number>(memberIds.map((userId) => [userId, 0]));
  const addNet = (userId: string, delta: number) => net.set(userId, (net.get(userId) ?? 0) + delta);

  for (const expense of expenses) {
    addNet(expense.paidBy, expense.convertedAmount);
    for (const share of expense.shares) {
      addNet(share.userId, -share.amount * expense.exchangeRate);
    }
  }

  for (const settlement of settlements) {
    addNet(settlement.fromUser, settlement.amount);
    addNet(settlement.toUser, -settlement.amount);
  }

  return Array.from(net.entries()).map(([userId, value]) => ({ userId, net: Math.round(value * 100) / 100 }));
}

export type DebtSuggestion = { fromUser: string; toUser: string; amount: number };

/** Greedy largest-debtor/largest-creditor matching so the UI can show a handful of "who pays
 * whom" suggestions instead of a full pairwise matrix. */
export function simplifyDebts(balances: Balance[]): DebtSuggestion[] {
  const creditors = balances.filter((b) => b.net > EPSILON).map((b) => ({ ...b })).sort((a, b) => b.net - a.net);
  const debtors = balances.filter((b) => b.net < -EPSILON).map((b) => ({ ...b, net: -b.net })).sort((a, b) => b.net - a.net);

  const suggestions: DebtSuggestion[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];
    const amount = Math.round(Math.min(creditor.net, debtor.net) * 100) / 100;

    if (amount > EPSILON) {
      suggestions.push({ fromUser: debtor.userId, toUser: creditor.userId, amount });
    }

    creditor.net -= amount;
    debtor.net -= amount;

    if (creditor.net <= EPSILON) ci += 1;
    if (debtor.net <= EPSILON) di += 1;
  }

  return suggestions;
}
