# History

## 2026-10-24 · billing
- Shopify Billing with Free/Starter/Growth/Pro, 14-day trial, test mode via `SHOPIFY_BILLING_TEST`
- `/plans` page (Polaris web components), `/api/billing` to read/change plan
- `app_subscriptions/update` webhook re-syncs the plan; App Bridge nav menu
- One trial per shop (`shops.trial_started_at`, migration applied to Supabase); duplicate plan → 409; bad input → 400
- Test charges always outside production; production only if `SHOPIFY_BILLING_TEST=true`
- First unit tests (`npm test`, node:test)
- Open: not yet tested on a dev store; plan limits enforced in task `plan-limits`
