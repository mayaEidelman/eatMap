import { supabase } from '../supabaseClient';
import { getExchangeRate } from '../currency';
import type { Expense, ExpenseCategory, ExpenseGroup, ExpenseGroupMember, ExpenseSettlement, ExpenseShare, GroupMemberStatus } from '../../types';

export type ExpenseGroupWithMembers = ExpenseGroup & { members: ExpenseGroupMember[] };

function mapGroup(row: any): ExpenseGroup {
  return {
    id: row.id,
    listId: row.list_id,
    ownerId: row.owner_id,
    name: row.name,
    baseCurrency: row.base_currency,
    createdAt: row.created_at,
  };
}

function mapMember(row: any): ExpenseGroupMember {
  return {
    groupId: row.group_id,
    userId: row.user_id,
    status: row.status as GroupMemberStatus,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    respondedAt: row.responded_at ?? undefined,
  };
}

/** Groups the current user has any membership row in (invited, accepted, or declined), each with
 * its full member roster attached so the UI can render avatars/status without extra round trips. */
export async function fetchExpenseGroups(currentUserId: string): Promise<ExpenseGroupWithMembers[]> {
  const { data: myMemberships, error: membershipError } = await supabase
    .from('expense_group_members')
    .select('group_id')
    .eq('user_id', currentUserId);
  if (membershipError) throw membershipError;

  const groupIds = (myMemberships ?? []).map((row) => row.group_id as string);
  if (groupIds.length === 0) return [];

  const [groupsRes, membersRes] = await Promise.all([
    supabase.from('expense_groups').select('*').in('id', groupIds).order('created_at', { ascending: false }),
    supabase.from('expense_group_members').select('*').in('group_id', groupIds),
  ]);
  if (groupsRes.error) throw groupsRes.error;
  if (membersRes.error) throw membersRes.error;

  const members = (membersRes.data ?? []).map(mapMember);
  return (groupsRes.data ?? []).map((row) => ({
    ...mapGroup(row),
    members: members.filter((member) => member.groupId === row.id),
  }));
}

export async function createExpenseGroup(
  ownerId: string,
  listId: string,
  name: string,
  baseCurrency: string,
  inviteUserIds: string[],
): Promise<string> {
  // Insert with a client-generated id rather than `.select().single()`-ing it back: the SELECT
  // policy on expense_groups requires a membership row for the caller, which doesn't exist yet
  // at this point (it's the next insert below), so RLS would silently drop the RETURNING row and
  // `.single()` would throw "no rows returned" even though the insert itself succeeded.
  const groupId = crypto.randomUUID();

  const { error } = await supabase
    .from('expense_groups')
    .insert({ id: groupId, list_id: listId, owner_id: ownerId, name, base_currency: baseCurrency });
  if (error) throw error;

  const memberRows = [
    { group_id: groupId, user_id: ownerId, status: 'accepted', invited_by: ownerId, responded_at: new Date().toISOString() },
    ...inviteUserIds
      .filter((userId) => userId !== ownerId)
      .map((userId) => ({ group_id: groupId, user_id: userId, status: 'invited', invited_by: ownerId })),
  ];
  const { error: membersError } = await supabase.from('expense_group_members').insert(memberRows);
  if (membersError) throw membersError;

  return groupId;
}

export async function inviteMember(groupId: string, userId: string, invitedBy: string): Promise<void> {
  const { error } = await supabase
    .from('expense_group_members')
    .insert({ group_id: groupId, user_id: userId, status: 'invited', invited_by: invitedBy });
  if (error) throw error;
}

export async function respondToInvite(groupId: string, userId: string, status: 'accepted' | 'declined'): Promise<void> {
  const { error } = await supabase
    .from('expense_group_members')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function removeMember(groupId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('expense_group_members').delete().eq('group_id', groupId).eq('user_id', userId);
  if (error) throw error;
}

function mapExpense(row: any, shares: ExpenseShare[]): Expense {
  return {
    id: row.id,
    groupId: row.group_id,
    paidBy: row.paid_by,
    description: row.description,
    category: row.category as ExpenseCategory,
    amount: Number(row.amount),
    currency: row.currency,
    exchangeRate: Number(row.exchange_rate),
    convertedAmount: Number(row.converted_amount),
    spentAt: row.spent_at,
    createdAt: row.created_at,
    shares,
  };
}

export type GroupLedger = { expenses: Expense[]; settlements: ExpenseSettlement[] };

export async function fetchGroupLedger(groupId: string): Promise<GroupLedger> {
  const [expensesRes, settlementsRes] = await Promise.all([
    supabase.from('expenses').select('*').eq('group_id', groupId).order('spent_at', { ascending: false }),
    supabase.from('expense_settlements').select('*').eq('group_id', groupId).order('created_at', { ascending: false }),
  ]);
  if (expensesRes.error) throw expensesRes.error;
  if (settlementsRes.error) throw settlementsRes.error;

  const expenseIds = (expensesRes.data ?? []).map((row) => row.id as string);
  const { data: shareRows, error: sharesError } =
    expenseIds.length > 0
      ? await supabase.from('expense_shares').select('*').in('expense_id', expenseIds)
      : { data: [], error: null };
  if (sharesError) throw sharesError;

  const sharesByExpense = new Map<string, ExpenseShare[]>();
  (shareRows ?? []).forEach((row) => {
    const list = sharesByExpense.get(row.expense_id) ?? [];
    list.push({ userId: row.user_id, amount: Number(row.amount) });
    sharesByExpense.set(row.expense_id, list);
  });

  const expenses = (expensesRes.data ?? []).map((row) => mapExpense(row, sharesByExpense.get(row.id) ?? []));
  const settlements: ExpenseSettlement[] = (settlementsRes.data ?? []).map((row) => ({
    id: row.id,
    groupId: row.group_id,
    fromUser: row.from_user,
    toUser: row.to_user,
    amount: Number(row.amount),
    createdAt: row.created_at,
  }));

  return { expenses, settlements };
}

export type NewExpense = {
  paidBy: string;
  description: string;
  category: ExpenseCategory;
  amount: number;
  currency: string;
  spentAt: string;
  shares: ExpenseShare[];
};

export async function addExpense(groupId: string, baseCurrency: string, expense: NewExpense): Promise<void> {
  const exchangeRate = await getExchangeRate(expense.currency, baseCurrency);
  const convertedAmount = Math.round(expense.amount * exchangeRate * 100) / 100;

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      group_id: groupId,
      paid_by: expense.paidBy,
      description: expense.description,
      category: expense.category,
      amount: expense.amount,
      currency: expense.currency,
      exchange_rate: exchangeRate,
      converted_amount: convertedAmount,
      spent_at: expense.spentAt,
    })
    .select('id')
    .single();
  if (error) throw error;

  const { error: sharesError } = await supabase
    .from('expense_shares')
    .insert(expense.shares.map((share) => ({ expense_id: data.id, user_id: share.userId, amount: share.amount })));
  if (sharesError) throw sharesError;
}

export async function deleteExpense(expenseId: string): Promise<void> {
  const { error } = await supabase.from('expenses').delete().eq('id', expenseId);
  if (error) throw error;
}

export async function addSettlement(groupId: string, fromUser: string, toUser: string, amount: number): Promise<void> {
  const { error } = await supabase.from('expense_settlements').insert({ group_id: groupId, from_user: fromUser, to_user: toUser, amount });
  if (error) throw error;
}
