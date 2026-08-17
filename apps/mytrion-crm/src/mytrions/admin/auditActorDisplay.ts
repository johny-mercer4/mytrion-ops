/** Short Zoho ids (`zoho:42`, `zoho:888`) are API-test fixtures, not CRM users. */
export const CI_TEST_ACTOR_USER_ID = 'zoho:42';
export const CI_TEST_ACTOR_NAME = 'CI Test Admin';

const CI_TEST_USER_ID = /^zoho:\d{1,4}$/;
const CI_TEST_NAMES = new Set(['Robiya', 'Rep Riley', 'Admin Ann', 'Manager Mo']);

export function auditActorDisplay(entry: {
  userId?: string | null;
  userName?: string | null;
}): string {
  if (entry.userId && CI_TEST_USER_ID.test(entry.userId)) return CI_TEST_ACTOR_NAME;
  if (!entry.userId && entry.userName && CI_TEST_NAMES.has(entry.userName)) return CI_TEST_ACTOR_NAME;
  return entry.userName ?? entry.userId ?? 'system';
}
