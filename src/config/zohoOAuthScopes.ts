/** Least-privilege worker scopes for login and the Sales CRM mutations available in Mytrion. */
export const DEFAULT_ZOHO_OAUTH_SCOPES = [
  'ZohoCRM.users.READ',
  'AaaServer.profile.READ',
  'ZohoCRM.modules.leads.READ',
  'ZohoCRM.modules.leads.CREATE',
  'ZohoCRM.modules.leads.UPDATE',
  'ZohoCRM.modules.deals.READ',
  'ZohoCRM.modules.deals.UPDATE',
  'ZohoCRM.modules.notes.READ',
  'ZohoCRM.modules.notes.CREATE',
  'ZohoCRM.modules.notes.UPDATE',
  'ZohoCRM.modules.notes.DELETE',
  'ZohoCRM.modules.attachments.CREATE',
].join(',');
