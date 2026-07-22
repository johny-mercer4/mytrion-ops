import { dwhQuery } from './src/integrations/dwh.js';

async function check() {
  const res = await dwhQuery("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'octane' AND table_name = 'rpt_debtor_companies'");
  console.log('rpt_debtor_companies:', res);
  
  const res2 = await dwhQuery("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'octane' AND table_name = 'mart_bad_debtors'");
  console.log('mart_bad_debtors:', res2);

  const res3 = await dwhQuery("SELECT table_name FROM information_schema.tables WHERE table_schema = 'octane' AND table_name LIKE '%tx%' OR table_name LIKE '%transaction%'");
  console.log('tables:', res3);
  
  const res4 = await dwhQuery("SELECT table_name FROM information_schema.tables WHERE table_schema = 'octane' AND table_name LIKE '%finance%'");
  console.log('finance tables:', res4);
  
  const res5 = await dwhQuery("SELECT table_name FROM information_schema.tables WHERE table_schema = 'octane' AND table_name LIKE '%debtor%'");
  console.log('debtor tables:', res5);
}

check().catch(console.error);
