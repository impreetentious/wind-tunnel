# Wind Tunnel Model Specification

This is the authoritative mathematical contract for the pricing engine. Its section numbering
intentionally remains stable so tests can cite individual requirements. Money is modeled as
floating dollars, not accounting currency units.

## §4. Economic model contract

### §4.1 Buyer model

For each segment `s`, account count is `n_s`, seat count is `c_s`, full-catalog
median account WTP is `W_s`, and within-segment spread is `σ_s`. A feature
catalog is `F`; an offer `o` has feature set `F_o` and list price `p_o`.
Flat prices are $/account/month; per-seat prices become the effective
account-level price `P_s(o) = p_o · c_s`. Segment feature value is
`V_s(o) = Σ_(f ∈ F_o) v[s,f]`; all values are account-level.

Individual scale is `ε ~ LogNormal(0, σ_s²)` (median 1), so buyer utility is
`u(o) = ε · V_s(o) − P_s(o)` and the outside option has utility 0. The model is
horizontal across segments and vertical within a segment. Input allocation
shares map to values as `v[s,f] = W_s · w[s,f]` with `Σ_f w[s,f] = 1`.

`σ_s` is buyer heterogeneity, while P10/P90 bands around `W_s` and `n_s` are
assumption uncertainty used only by Monte Carlo. All band values are positive,
their base is P50, and `base = sqrt(q10 · q90)`. Given a valid band:

```text
μ = (ln q10 + ln q90) / 2 = ln base
σ = ln(q90 / q10) / (2 · z90)
z90 = 1.2815515655446004
```

`q10 = q90 = base` is the deterministic `σ = 0` branch.

Required tests: T-STAT-01 validates Φ reference values; T-STAT-02 validates
the Φ/Φ⁻¹ round trip; T-STAT-03 round-trips fitted P10/P90 bands; and
T-STAT-04 compares lognormal partial expectation with independent Simpson
integration. T-STAT-02 holds to `1e-9` on the interior grid and to `1e-8` at
the `±6σ` endpoints: binary64 CDF output at `+6σ` cannot retain more tail
detail, and the measured round trip is about `8.85e-9`.

### §4.2 Offer selection — utility upper envelope

Each buyer selects `argmax_o { ε · V_s(o) − P_s(o) }`, including the outside
option. The tie tolerance is `1e-9`. `selectOffers` has two modes:

- `conservative` is the product default: prefer lower effective price, then
  lower value, and prefer the outside option on a paid-vs-outside tie.
- `seller-favorable` is only for σ=0 screening/bundling oracles: prefer higher
  value, then higher price, and participation over the outside option.

When an own and competitor offer have identical effective `(value, price)`,
the competitor owns the share. This is an explicit conservative attribution
policy: it preserves the five-term identity by recording the result as
competitor loss rather than own revenue. Stable offer ID is only a fallback for
otherwise economically identical offers of the same owner class.

An offer is a utility line `u_o(ε) = V_o ε − P_o`. The active menu is its upper
envelope, with increasing values and entry breakpoints:

```text
ε*(o_k → o_(k+1)) = (P_(k+1) − P_k) / (V_(k+1) − V_k)
```

Deduplicate equal-value offers by retaining the lowest price, sort by value,
and stack-scan, popping a line whose intersection is at or before its
predecessor's entry. In a positive-spread segment, the active offer's share on
`(a_k, b_k]` is:

```text
share_k = Φ(ln(b_k) / σ_s) − Φ(ln(a_k) / σ_s)
```

with intervals clipped to `ε > 0`. At `σ_s = 0`, all mass is at `ε = 1` and a
direct argmax uses the selected tie mode.

The offer set comprises every tier plus each subset of up to three add-ons not
already wholly included in that tier, the outside option, and active competitor
alternatives. A composite has the union of its features and summed effective
prices. The cap is five tiers × 2³ add-on subsets + outside + six competitors.

Required tests: T-ENV-01 dominated offers; T-ENV-02 ordered breakpoints and
share conservation; T-ENV-03 independent brute-force cross-validation;
T-ENV-04 σ=0 ties; T-ENV-05 free-tier behavior; T-ADD-01 subset expansion;
and T-CMP-08 deterministic competitor-first own/competitor tie attribution.

### §4.3 Economics readouts and value conservation

For active intervals `(a_k, b_k]`, define
`L(a,b) = E[ε · 1(a < ε ≤ b)]`:

```text
L(a,b) = e^(σ²/2) · [Φ((σ² − ln a)/σ) − Φ((σ² − ln b)/σ)]
```

with zero/infinite limits handled analytically. For a segment, with
`V_full = V_s(F)`, compute:

```text
Revenue         = n_s · Σ_own paid share_k · P_k
OwnBuyerSurplus = n_s · Σ_own [V_k · L(a_k,b_k) − P_k · share_k]
FencingGap      = n_s · Σ_own (V_full − V_k) · L(a_k,b_k)
Unserved        = n_s · V_full · L(outside interval)
CompetitorLoss  = n_s · Σ_competitor V_full · L(a_k,b_k)
Potential       = n_s · e^(σ²/2) · V_full
```

The required identity is
`Potential = Revenue + OwnBuyerSurplus + FencingGap + Unserved + CompetitorLoss`.
Without competitors it is the four-term form. Competitor utility/revenue is
never own buyer surplus. KPIs are MRR, paid conversion, ARPA, capture rate,
and, when active, competitor-loss share. Remove-offer counterfactuals report
MRR deltas. T-ECON-01…06 and T-CMP-07 validate this section.

### §4.4 Price sweeps

Sweep a selected tier's list-price unit over 400 grid points plus its exact
current price. For flat prices start at `max(current, 1.5 × max V_full)`; for
per-seat start at `max(current, 1.5 × max(V_full / c_s))`. Double the upper
bound while revenue rises at the edge or the best point is in the top 5%, up to
eight expansions. A boundary optimum at the cap is explicitly labeled “best in
searched range.” Composite offers derived from the changed tier move with it.
T-SWP-01…04 validate inclusion, monotonic demand, a golden optimum, and the
adaptive-boundary behavior.

### §4.5 Second-degree price-discrimination oracle

For two types `L, H` and Basic ⊂ Pro under single crossing, the serve-both
oracle is `p_B = V_LB` and `p_P = V_HP − V_HB + V_LB`. Exclude L iff
`n_H · (V_HB − V_LB) > n_L · V_LB`, then set `p_P = V_HP`. These fixtures run
at `σ = 0` with `seller-favorable`; exact binding-price ties are intentional.
T-SCRN-01…04 reproduce the closed-form result.

### §4.6 Bundling oracle

For two goods, compare pure components, pure bundle, and mixed bundling by
enumerating the stated candidate price bounds and taking the best valid revenue
under the same envelope/tie convention. T-BND-01…04 validate canonical
textbook cases, regime nesting, and deterministic ties.

### §4.7 Van Westendorp price sensitivity meter

The survey-first PSM takes one respondent quadruple
`(too cheap ≤ cheap ≤ expensive ≤ too expensive)`. Non-finite, negative, or
order-violating quadruples are reported and excluded; they are never repaired
or silently re-ordered. On the union grid of valid response prices, construct:

```text
too cheap      = share(response.tooCheap ≥ price)
cheap          = share(response.cheap ≥ price)
expensive      = share(response.expensive ≤ price)
too expensive  = share(response.tooExpensive ≤ price)
not cheap      = 1 − cheap
not expensive  = 1 − expensive
```

Crossings use piecewise-linear interpolation on that grid:

```text
PMC = too cheap × not cheap        PME = too expensive × not expensive
IPP = cheap × expensive            OPP = too cheap × too expensive
acceptable range = [PMC, PME] when the points are defined and ordered
```

An absent or degenerate crossing is reported as undefined for the data, never
estimated. The PSM display may use model-generated illustrative responses only
when they are persistently marked and visibly labeled “simulated — not
evidence.” T-VW-01…04 validate exclusions, symmetric construction,
hand-computed interpolation, and undefined states.

### §4.8 Monte Carlo uncertainty

Monte Carlo samples only assumption bands, never within-segment ε. It uses an
injected seeded PRNG and returns P10/P50/P90, design win rate, and tornado
drivers by absolute MRR change. T-MC-01…05 establish determinism, distribution
handling, percentile rules, and the time budget.

### §4.9 Design linter

The linter makes deterministic, cited findings: dominated offers, fence
inversion, free-tier leakage via counterfactual, downgrade/cannibalization
mass, dead fences, choice overload, weak anchoring, and competitor loss. It
never applies invented behavioral uplift multipliers. T-LNT-01…09 pin all
predicates and dollar readouts.

### §4.10 Conjoint and MaxDiff-lite

Choice-based conjoint uses pooled MNL with effects-coded non-price attributes,
numeric account-month price where a WTP bridge is needed, analytic gradient and
Hessian, damped Newton steps, and named `ok`, `nonIdentifiable`, `separated`,
or `nonConverged` outcomes. A bridge requires `ok`, an invertible observed
information matrix, and a significantly negative price coefficient:
`ΔWTP = −(β_(a,l1) − β_(a,l0)) / β_p`. It is an aggregate proposal only.

MaxDiff-lite requires every item to appear, scores
`(best − worst) / appearances`, shifts then normalizes to 100, and returns a
uniform `100/m` when all raw scores are equal. T-CNJ-01…08 and T-MXD-01…03
cover the estimator, derivative gate, bridge, balance, and degenerate scoring.

### §4.11 Competitive price-value map and alternatives

The map is segment-scoped, with value on X, price on Y, and zero-utility ray
`P = εV`. It shows discrete Pareto non-dominated competitor points only; no
interpolation creates a market alternative. A competitor directly dominates a
tier iff `V_c ≥ V_t` and `P_c ≤ P_t`, strict in one. The same competitor data
becomes an envelope offer and contributes only to `CompetitorLoss`.
T-CMP-01…08 cover frontier construction, rays, direct dominance, engine shares,
conservation, empty competitor identity, and the B-001 tie policy.

### §4.13 Elasticity and cross-tier substitution matrix

Per segment, given an active envelope (§4.2) at within-segment `σ > 0`, the
demand share of the k-th active offer is
`share_k = Φ(ln(b_k)/σ) − Φ(ln(a_k)/σ)`. Let
`g(x) = φ(ln(x)/σ) / (σ · x)` be the standardized lognormal density with
`μ = 0`. The own-price share derivative is

```text
∂share_k / ∂P_k = − g(a_k) / (V_k − V_{k-1})
                 − g(b_k) / (V_{k+1} − V_k)
```

Cross-price share derivatives are non-zero only for the two envelope neighbors
of offer k, so the segment substitution matrix is tridiagonal in the
envelope-ordered active offers:

```text
∂share_{k-1} / ∂P_k = + g(a_k) / (V_k − V_{k-1})
∂share_{k+1} / ∂P_k = + g(b_k) / (V_{k+1} − V_k)
```

Boundary offers use `g(0) = 0` (outside-adjacent lower bound) and
`g(+∞) = 0` (top-envelope upper bound). Total-share conservation holds
exactly: `Σ_k ∂share_k / ∂P_j = 0` for every perturbed price `j`.

Own-price demand elasticity is `(P_k / share_k) · ∂share_k / ∂P_k`, always
`≤ 0` at price-positive, share-positive active offers. Revenue elasticity is
`1 + (own-price demand elasticity)`; it crosses zero at a local revenue peak
along a price sweep, matching §4.4.

These are _regime-local_ derivatives: they are valid only for price changes
small enough that the current active-offer envelope is preserved. A step large
enough to push an offer onto or off the envelope changes the derivative
structure. Use §4.4's price sweep for finite steps.

At `σ = 0` the segment collapses to a point mass; local derivatives are Dirac
distributions and are not reported. The elasticity readout is returned with
`degenerate: true`, empty per-offer elasticities, and empty substitution
entries. Use §4.4 for the finite-difference view a `σ = 0` segment supports.

Required tests: T-ELS-01 analytic-vs-finite-difference derivative gate on
three- and four-offer fixtures; T-ELS-02 column-sum conservation; T-ELS-03 the
`σ = 0` degenerate branch; T-ELS-04 own-price signs and the revenue-elasticity
zero-crossing near a price-sweep argmax.

### §4.14 Joint price optimizer (local search, not truth)

The optimizer searches for a per-tier price vector that locally maximizes
scenario MRR under the closed-form simulator. It runs coordinate descent on
each tier's list-price unit ($/account/month for flat, $/seat/month for
per-seat), with multi-start from perturbations of the current design's prices;
each single-tier line search reuses the §4.4 price-sweep grid so its results
are locally consistent with the sweep chart. It returns the best local
optimum found across all starts plus per-start diagnostics.

Because MRR is _not_ concave in the joint price vector (screening menus
routinely have several local optima), the result is explicitly labeled
`local optimum` and never `optimal`. The public UI presentation must keep the
per-tier sweep plus the tornado (§4.8) as the primary reading; the optimizer
readout is a supplementary "under these assumptions and starting near your
current design, this menu found more revenue" rather than an authoritative
answer. This honesty framing is required (D-07, D-24, and §2.2 cut rationale).

Determinism: given the same scenario, seed, and search options, the optimizer
returns the same result. Randomness enters only through the seeded PRNG used
to generate perturbed starts. The optimizer never mutates the scenario; the
caller applies the returned prices explicitly.

Required tests: T-OPT-01 the optimizer weakly improves scenario MRR against
the current design (`bestMrr ≥ baseline.mrr − tolerance`); T-OPT-02 on a
convex single-tier fixture the optimizer converges to the price-sweep
argmax within one grid step; T-OPT-03 determinism (identical seeds → identical
result); T-OPT-04 a scenario with no tiers is rejected with an informative
error rather than silently returning the empty menu.

### §4.12 Numerical conventions

Prices are non-negative; UI `σ_s` is `[0.05, 2.0]` with low/medium/high presets
of `0.25/0.5/0.9`. Percentages display to one decimal; USD uses
`Intl.NumberFormat`. Softmax uses log-sum-exp. All engine randomness is an
injected seeded PRNG. The engine remains pure TypeScript: no React, DOM,
`Date.now`, or ambient `Math.random`.
