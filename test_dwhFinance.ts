import { fetchFinanceDebtors, fetchFinanceTransactions } from './src/integrations/dwhFinance.js';

async function check() {
  const debtors = await fetchFinanceDebtors({ limit: 1 });
  console.log('debtors:', debtors);
  const tx = await fetchFinanceTransactions({ limit: 1 });
  console.log('tx:', tx);
}

check().catch(console.error);
