import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addExpense as addExpenseApi,
  addSettlement as addSettlementApi,
  deleteExpense as deleteExpenseApi,
  fetchGroupLedger,
  type NewExpense,
} from '../lib/api/expenses';

export function useGroupExpenses(groupId: string | null, baseCurrency: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['groupExpenses', groupId] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchGroupLedger(groupId as string),
    enabled: Boolean(groupId),
  });

  async function addExpense(expense: NewExpense) {
    if (!groupId || !baseCurrency) return;
    await addExpenseApi(groupId, baseCurrency, expense);
    await queryClient.invalidateQueries({ queryKey });
  }

  async function deleteExpense(expenseId: string) {
    await deleteExpenseApi(expenseId);
    await queryClient.invalidateQueries({ queryKey });
  }

  async function addSettlement(fromUser: string, toUser: string, amount: number) {
    if (!groupId) return;
    await addSettlementApi(groupId, fromUser, toUser, amount);
    await queryClient.invalidateQueries({ queryKey });
  }

  return {
    expenses: query.data?.expenses ?? [],
    settlements: query.data?.settlements ?? [],
    isLoading: query.isPending,
    error: query.error,
    addExpense,
    deleteExpense,
    addSettlement,
  };
}
