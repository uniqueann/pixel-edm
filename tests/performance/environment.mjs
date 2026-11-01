export const environment = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public-key",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3110",
  EDM_CREDENTIAL_KEYRING:
    '{"active":"test-v1","keys":{"test-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="}}',
  CREEM_EDM_TEAM_MONTHLY_PRODUCT_ID: "prod_e2e_team_monthly",
  DODO_EDM_TEAM_MONTHLY_PRODUCT_ID: "pdt_e2e_team_monthly",
};
