import { EXPENSE_CATEGORIES, type ExpenseCategory } from '../types';

export const EXPENSE_CATEGORY_META: Record<ExpenseCategory, { label: string; icon: string }> = {
  food: { label: 'Food', icon: '🍴' },
  transport: { label: 'Transport', icon: '🚕' },
  lodging: { label: 'Lodging', icon: '🛏️' },
  activities: { label: 'Activities', icon: '🎟️' },
  shopping: { label: 'Shopping', icon: '🛍️' },
  other: { label: 'Other', icon: '📌' },
};

export function groupExpensesByCategory<T extends { category: ExpenseCategory }>(expenses: T[]) {
  const map = new Map<ExpenseCategory, T[]>();
  expenses.forEach((expense) => {
    const list = map.get(expense.category) ?? [];
    list.push(expense);
    map.set(expense.category, list);
  });

  return EXPENSE_CATEGORIES.filter((category) => map.has(category)).map((category) => ({
    category,
    expenses: map.get(category) as T[],
  }));
}
