// Budgets: hard caps that pause the run with a continue card instead of
// looping forever. Cost uses provider-reported usage; the tokenizer estimate
// for missing usage lands with the cost-guardrail task.

export interface BudgetState {
  maxSteps: number;
  maxToolCalls: number;
  maxCostUSD: number;
  tokensIn: number;
  tokensOut: number;
  costUSD: number;
}

export type BudgetVerdict = "ok" | "steps" | "tools" | "cost";

export function checkBudget(budget: BudgetState, stepsUsed: number, toolCallsUsed: number): BudgetVerdict {
  if (stepsUsed >= budget.maxSteps) return "steps";
  if (toolCallsUsed >= budget.maxToolCalls) return "tools";
  if (budget.costUSD >= budget.maxCostUSD) return "cost";
  return "ok";
}

export function recordUsage(
  budget: BudgetState,
  inputTokens: number,
  outputTokens: number,
  pricePerMTokIn?: number,
  pricePerMTokOut?: number,
): BudgetState {
  const cost =
    budget.costUSD +
    (pricePerMTokIn !== undefined ? (inputTokens / 1_000_000) * pricePerMTokIn : 0) +
    (pricePerMTokOut !== undefined ? (outputTokens / 1_000_000) * pricePerMTokOut : 0);
  return {
    ...budget,
    tokensIn: budget.tokensIn + inputTokens,
    tokensOut: budget.tokensOut + outputTokens,
    costUSD: cost,
  };
}
