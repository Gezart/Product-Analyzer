# History

## 2026-10-24 · scoring
- `src/lib/scoring.ts`: metrics (sell-through, days of cover, stock value, trend, conversion), statuses and money at stake, store-relative thresholds, editable defaults
- `src/lib/score-shop.ts`: scores a shop's active products from `product_daily_metrics` and writes `product_scores`
- 17 unit tests (`npm test`)
- Dead stock needs proof: with less than 90 days of order history, a product with no sales is "slow mover"
- Open: `scoreShop` is called by the `daily-metrics` and `settings` tasks
