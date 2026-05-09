# Lease-to-Own Scenario Model

**Built by:** Teddy (Claude Code)  
**Owner:** David Atashroo  
**Live:** https://davidatashroo-teddy.github.io/lto-scenario-model/

A single-page financial model for analyzing the economics of a lease-to-own real estate purchase versus buying conventionally today. Built specifically for the 39 Orinda View deal, but parameterized for any LTO structure.

## What it does

**Forward analysis:** Given a deal structure, computes the 30-year lifetime cost of the proposed LTO deal versus three conventional purchase scenarios (at different $/sqft price points).

**Reverse analysis:** Solves for the comparable purchase price today at which buying conventionally would produce the same lifetime cost as the deal (closed-form, not a search).

**Sensitivity panel:** Shows how the breakeven and savings shift across key assumptions (rate, hold period, lease length, tax escalation, refi terms).

## How the math works

### Monthly P&I
```
M = L × [r × (1+r)^n] / [(1+r)^n - 1]
where r = annualRate/12, n = termMonths
```

### Property tax & insurance (geometric series with escalation)
```
Total = year1 × [(1+g)^n - 1] / g
```

### Lifetime cost of the deal
```
= option_fee + total_rent + down + closing + total_PI + property_tax_total + insurance_total
```
Where `total_PI` for ARM products accounts for the initial rate period and post-refi P&I at the refinanced balance.

### Lifetime cost of a conventional purchase at price P
```
= down + closing + total_PI + property_tax_total + insurance_total
```
All terms scale linearly in P, so the lifetime cost function is `cost(P) = P × k + c` where `c` is the flat refinance closing cost (0 for 30-year fixed).

### Breakeven (closed-form)
```
k = down_pct + closing_pct + per-dollar-PI + per-dollar-tax + per-dollar-insurance
breakeven_price = (deal_lifetime_cost - c) / k
```

## Validation test cases

**Test 1 — 39 Orinda View base case (30-year fixed)**
- Inputs: $3.1M total, $75K option fee, $15K/mo rent, 18 months, 5.40% close rate, 6.40% today rate, 30-yr fixed, 30-yr hold, 1% tax, 2% escalation, $4,683 insurance (auto), 4316 sqft
- Expected deal lifetime cost: ~$6.5–6.6M
- Expected breakeven price: ~$2.65–2.75M (~$615–635/sqft)

**Test 2 — ARM scenario**
- Same but 7/1 ARM, refi at yr 7 at 4.90%
- Monthly P&I at 5.40% on $2.204M loan ≈ $12,376
- Balance after 84 months ≈ $1.93M
- Refi P&I at 4.90% over 23 years ≈ $11,300/mo
- Deal lifetime cost should be $200–400K lower than 30-yr fixed equivalent

## URL sharing

All inputs encode to URL query parameters. Share a scenario by clicking "Copy scenario URL." Reset to defaults clears the URL state.

## Roadmap (v2+)

- Live rate module (auto-populate from rate forecast service)
- Live insurance API (replace county lookup table)
- Capital gains tax modeling (IRC §453 installment sale treatment)
- Cash flow timeline view (monthly housing cost as stacked area chart)
- Save and compare multiple deal structures
