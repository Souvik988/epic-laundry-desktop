export const FINANCE_EXPENSE_CATEGORIES = [
  'PROCESSING', 'LOGISTICS', 'MARKETPLACE', 'PAYROLL', 'RENT', 'UTILITIES',
  'SOFTWARE', 'MARKETING', 'MAINTENANCE', 'ADMIN', 'FINANCE', 'TAX', 'CAPEX', 'OTHER', 'UNCLASSIFIED',
] as const;

export type FinanceExpenseCategory = typeof FINANCE_EXPENSE_CATEGORIES[number];
export type FinanceClassification = { label: string; grossProfit: boolean; contribution: boolean; ebitda: boolean; cashOut: boolean };

/** Management-accounting classification. It is deliberately separate from tax
 * treatment and can be revised prospectively without changing source amounts. */
export const FINANCE_CLASSIFICATIONS: Record<FinanceExpenseCategory, FinanceClassification> = {
  PROCESSING: { label: 'Processing & supplies', grossProfit: true, contribution: true, ebitda: true, cashOut: true },
  LOGISTICS: { label: 'Logistics & delivery', grossProfit: false, contribution: true, ebitda: true, cashOut: true },
  MARKETPLACE: { label: 'Marketplace fees', grossProfit: false, contribution: true, ebitda: true, cashOut: true },
  PAYROLL: { label: 'Payroll', grossProfit: false, contribution: false, ebitda: true, cashOut: true },
  RENT: { label: 'Rent', grossProfit: false, contribution: false, ebitda: true, cashOut: true },
  UTILITIES: { label: 'Utilities', grossProfit: false, contribution: false, ebitda: true, cashOut: true },
  SOFTWARE: { label: 'Software', grossProfit: false, contribution: false, ebitda: true, cashOut: true },
  MARKETING: { label: 'Marketing', grossProfit: false, contribution: false, ebitda: true, cashOut: true },
  MAINTENANCE: { label: 'Maintenance', grossProfit: false, contribution: false, ebitda: true, cashOut: true },
  ADMIN: { label: 'Administration', grossProfit: false, contribution: false, ebitda: true, cashOut: true },
  FINANCE: { label: 'Finance cost', grossProfit: false, contribution: false, ebitda: false, cashOut: true },
  TAX: { label: 'Tax payment', grossProfit: false, contribution: false, ebitda: false, cashOut: true },
  CAPEX: { label: 'Capital expenditure', grossProfit: false, contribution: false, ebitda: false, cashOut: true },
  OTHER: { label: 'Other operating expense', grossProfit: false, contribution: false, ebitda: true, cashOut: true },
  UNCLASSIFIED: { label: 'Unclassified', grossProfit: false, contribution: false, ebitda: false, cashOut: true },
};

export function financeExpenseCategory(value: unknown): FinanceExpenseCategory {
  const candidate = String(value || '').trim().toUpperCase();
  return (FINANCE_EXPENSE_CATEGORIES as readonly string[]).includes(candidate) ? candidate as FinanceExpenseCategory : 'UNCLASSIFIED';
}
