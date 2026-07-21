import { dwhQuery } from './src/integrations/dwh.js';

async function check() {
  const t1 = await dwhQuery("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'octane' AND table_name = 'mart_transaction_line_items'");
  console.log('mart_transaction_line_items:', t1);

  const t2 = await dwhQuery("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'octane' AND table_name = 'rpt_transactions'");
  console.log('rpt_transactions:', t2);

  const t3 = await dwhQuery("SELECT * FROM octane.mart_bad_debtors LIMIT 1");
  console.log('mart_bad_debtors limit 1:', t3);

  const t4 = await dwhQuery("SELECT * FROM octane.rpt_debtor_companies LIMIT 1");
  console.log('rpt_debtor_companies limit 1:', t4);
}

check().catch(console.error);
