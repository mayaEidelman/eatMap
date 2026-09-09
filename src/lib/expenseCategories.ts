import type { ExpenseCategory } from '../types';

export const EXPENSE_CATEGORY_META: Record<ExpenseCategory, { label: string; icon: string }> = {
  food: { label: 'Food', icon: '🍴' },
  transport: { label: 'Transport', icon: '🚕' },
  lodging: { label: 'Lodging', icon: '🛏️' },
  activities: { label: 'Activities', icon: '🎟️' },
  shopping: { label: 'Shopping', icon: '🛍️' },
  other: { label: 'Other', icon: '📌' },
};
