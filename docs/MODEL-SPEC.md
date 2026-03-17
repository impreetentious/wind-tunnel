# Wind Tunnel Model Specification

This is the authoritative mathematical contract for the pricing engine. Its
section numbering is stable so tests can cite individual requirements. Money is
modeled as floating dollars, not accounting currency units.

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

#### §4.1.1 Non-additive feature values (extension)

The additive rule `V_s(o) = Σ_(f ∈ F_o) v[s,f]` is the default. An optional set
of **pair interactions** captures complements and substitutes: unordered
feature pairs `{f, g}` each carry an adjustment `δ[f,g]` that applies once, and
only when both features are in the offer:

```text
V_s(o) = max(0, Σ_(f ∈ F_o) v[s,f] + Σ_({f,g} ⊆ F_o) δ_s[f,g])
```

An interaction with `δ > 0` is a complement (the pair is worth more than the
sum of its parts); `δ < 0` is a substitute. The adjustment applies to every
offer whose feature set contains both features, including tier + add-on
composites — so an add-on that completes a complementary pair unlocks the pair
value in exactly the composites that hold both features. A pair referencing a
feature absent from the offer contributes nothing, so a stale interaction is
inert rather than distorting. The value is floored at zero: a substitute may
reduce an offer below its additive parts but never below worthless, which the
envelope (§4.2) requires. Omitting all interactions is byte-identical to the
additive model, so this extension never changes an additive scenario.

Durable interactions are stored per unordered pair as a fraction of the
segment's full-catalog P50 WTP, `δ_s[f,g] = W_s · φ[f,g]` with
`φ[f,g] ∈ [−1, 1]`, so they scale per segment exactly like the additive
allocation shares `w[s,f]`. The schema rejects self-pairs, duplicate pairs, and
references to unknown features.

Required tests (cite `@spec §4.1`): pair adjustments apply only to offers
holding both features; complements add and substitutes subtract with a
zero floor; the empty-interaction path equals the additive model; a stale or
non-finite interaction is inert or rejected; the full expansion carries the
adjustment into add-on composites; and, through the state adapter, a strong
complement strictly raises simulated MRR on a single-paid-tier menu at `σ > 0`.

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

#### §4.10.1 D-efficient design generation (extension)

`generateDEfficientConjointDesign` seeds a random-balanced design from
`generateConjointDesign` and refines it by modified-Fedorov local search:
at each iteration, the swap of one attribute's level between two alternatives
that maximizes `log |X'X|` is accepted. Total per-attribute level counts are
invariant under any single-attribute pairwise swap, so balance is preserved
throughout the search. Termination is by no-improvement or a swap cap; the
best log-determinant across multi-start restarts is returned. If a start
cannot exceed the random-balanced baseline the result is labeled
`baseline` or `unimprovable`, never `improved`. Determinism holds under a
fixed seed. Required tests: T-CNJ-09 improvement or match against the
random-balanced baseline; T-CNJ-10 level balance preserved on the returned
design; T-CNJ-11 identifiability of the returned design; T-CNJ-12 determinism
under identical seeds.

#### §4.10.2 MNL best-worst estimation for MaxDiff (extension)

`estimateMaxDiffMnl` fits an item-level utility vector by joint-MNL over
best-worst pairs (Louviere's sequential decomposition: from a k-item task the
respondent's best is the max-utility of k items, the worst is the min-utility
— equivalently, the max-utility item in the negated set of the k − 1 remaining
items). One utility parameter per item is estimated with the identifying
constraint `Σ_i u_i = 0`, using the same log-sum-exp softmax, analytic
gradient, and damped Newton-Raphson kernel as §4.10 CBC. Statuses are `ok`,
`nonIdentifiable`, `separated`, and `nonConverged`. The `ok` result returns
utilities, standard errors from `−H⁻¹`, and normalized shares (softmax of
utilities). The counting-score result (§4.10) continues to ship as the
lightweight lens; MNL is available whenever there are enough responses to
identify the model. Required tests: T-MXD-04 recovery on a simulated dataset
with a known utility vector; T-MXD-05 the identifying constraint holds; T-MXD-06
separated and nonIdentifiable statuses on adversarial fixtures.

#### §4.10.3 Hierarchical Bayes for Conjoint (extension)

`estimateHbConjoint` fits per-respondent utility vectors on top of a
population-level normal prior with diagonal covariance:

```text
choice_it ∝ exp(x_it · β_r)                  (level 1, r = respondent(i))
β_r ~ N(μ, diag(σ²))                          (level 2)
μ_j ~ N(0, τ_μ²)                              (weakly informative)
σ_j² ~ InverseGamma(a_0, b_0)                (weakly informative)
```

The kernel is Metropolis-within-Gibbs: a per-respondent random-walk Metropolis
update on `β_r` under the level-1 log-likelihood and the level-2 prior,
alternated with closed-form Gibbs draws for μ (normal-normal conjugate) and σ²
(inverse-gamma conjugate). Random-walk proposal SDs adapt during warm-up using
the batched-acceptance recipe (Roberts–Gelman–Gilks), targeting the
0.15–0.44 acceptance band that keeps the sampler mixing without either
collapsing or rejecting every move. Warm-up draws are discarded; the returned
per-respondent β and population μ, σ are posterior means over the sampled
iterations. Randomness enters only through the seeded `mulberry32` PRNG, so
determinism holds under a fixed seed. No new dependency ships with this
extension; the sampler is in-repo, matching the §15 M-04 mandate.

HB is opt-in: the pooled MNL from §4.10 remains the default, shallower lens
and always ships alongside HB. HB requires **two or more respondents**;
single-respondent studies fall back to §4.10.

Required tests (`@spec §4.10`): T-HBC-01 recovers the sign and rough magnitude
of a synthetic population β on a 10-respondent, 6-task fixture; T-HBC-02
returns one β posterior per respondent with matching observation counts;
T-HBC-03 determinism under a fixed seed; T-HBC-04 rejects a single-respondent
study; T-HBC-05 mean acceptance stays inside a healthy [0.05, 0.95] band.

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

### §4.15 Usage-based pricing (extension)

A tier or add-on may attach a **usage line**: a base list price (unchanged
flat/per-seat metric) plus a per-unit charge on a named metric. Each segment
carries an expected-usage band `{p10, p50, p90}` per metric that appears in its
offers. The engine summarizes each buyer's monthly usage bill to its
per-segment expected cost:

```text
usageSurcharge_o,s = Σ_(line ∈ o) max(0, band[line.metric].p50 − line.includedUnits) · line.perUnitPrice
effectivePrice_o,s = flat/per-seat base + usageSurcharge_o,s
```

The surcharge folds into `effectivePrice`, so the envelope primitive (§4.2) is
unchanged: a buyer still faces `u(o) = ε · V_s(o) − P_s(o)` and picks the
utility-maximizing offer. This is a **per-segment expected-cost approximation**,
not a per-buyer joint distribution over usage and ε. The approximation is
stated in the UI and record — the engine does not hide it. Monte Carlo (§4.8)
samples the usage band as one more assumption, giving the P10/P50/P90
distribution over the surcharge and hence over MRR.

`includedUnits` (default `0`) is a free monthly allowance subtracted before
multiplying by `perUnitPrice`; a segment whose median usage stays at or below
the allowance pays zero surcharge, matching how billing pages read to buyers.
Missing metric bands make a usage line inert (0 surcharge) rather than
throwing, so a stale metric reference on an imported template never crashes an
unrelated offer — mirroring the interaction inertness policy in §4.1.1.

Backwards compatibility: a scenario that omits `usagePricing` and `usageBands`
computes a byte-identical `effectivePrice`, so every prior §4.3–§4.14 test and
template still holds. The persistence schema adds optional fields
(`model.usageMetrics`, `segment.usageBands`, `tier.usagePricing`,
`addOn.usagePricing`) with backward-compatible defaults; `SCHEMA_VERSION` is
unchanged.

Required tests (`@spec §4.15`): T-USG-01 billed volume above the allowance and
zero when at or below the allowance; T-USG-02 additive across multiple lines
and inert on missing bands; T-USG-03 the empty-line path equals the flat/
per-seat baseline; T-USG-04 rejects non-finite or ordered-band violations; and
the offer-expansion integration test that carries the surcharge through
tier + add-on composites and per-seat interactions.

### §4.16 Trials & time dynamics (extension)

The extension lifts the single-period screening model to a multi-period one
that captures the two effects that ship in v1: a **paid trial** during which
buyers evaluate the offer, and **retention** month over month. Time steps are
whole months. Notation for the extension only:

- `t = 0 … T` — the period index. `t = 0` is the acquisition month.
- `trialLength_s ∈ ℕ` — trial length (months) for segment `s`; may be 0 (no
  trial).
- `trialConversion_s ∈ [0, 1]` — probability that a segment `s` buyer who
  selects a paid offer at `t = 0` converts to paid at `t = trialLength_s`. The
  §4.2/§4.3 monthly economics are collected only from converted buyers.
- `monthlyRetention_s ∈ [0, 1]` — probability a converted buyer remains from
  one month to the next. Deterministic per segment.
- `contractTerm` ∈ {`monthly`, `annual`} — annual applies retention only at the
  12th month; monthly applies it every month. Annual bills up front but the
  engine spreads revenue evenly (§2.1 v1: no discount modelling).

Given a §4.3 monthly readout `M_s` for segment `s`, the multi-period MRR at
period `t` is:

```text
mrr_s(t)
  = 0                              for t < trialLength_s
  = trialConversion_s · M_s        for t = trialLength_s
  = trialConversion_s · M_s · monthlyRetention_s^(t − trialLength_s)   for t > trialLength_s
```

Cumulative revenue over `T` periods sums the monthly MRR (annual terms bill
the same annualized total). LTV per acquired prospect is
`trialConversion_s · ARPA_s · Σ_(k=0..T-trialLength_s) monthlyRetention_s^k`
truncated at `T`. Aggregate KPIs sum over segments.

Defaults preserve v1 behaviour: `trialLength_s = 0`, `trialConversion_s = 1`,
`monthlyRetention_s = 1`, `contractTerm = monthly`, `T = 0` collapses to a
single-period readout byte-identical to §4.3. The extension is opt-in.

Required tests (`@spec §4.16`): T-TIME-01 the zero-default collapses to the
§4.3 readout; T-TIME-02 trial delay zeroes revenue until conversion; T-TIME-03
retention < 1 shrinks MRR geometrically; T-TIME-04 LTV equals the closed-form
sum; T-TIME-05 annual contract accumulates revenue evenly across 12 months.

### §4.17 Credit packs, breakage & outcome pricing (extension)

§4.15 gives the menu a metered line: an allowance and a per-unit rate. This
extension adds the two primitives a current hybrid menu actually sells, plus
the distinction that keeps them readable.

**Prepaid credit pack.** A block of `k = packUnits` of a metric bought up front
for `packPrice`, with an optional `overagePerUnit` rate charged past the pack.
Let `U` be the segment's monthly usage of that metric, distributed lognormally
with `μ = ln(P50)` and `σ` fitted from the band's P10/P90 by §4.1's contract —
the P50-centered convention of D-30, so the pack reads the same band the
metered line does. Writing `F` for its CDF and `L(a,b) = E[U·1(a<U≤b)]` for the
§4.3 partial expectation:

```text
expectedUnusedUnits   = E[(k − U)⁺] = k·F(k) − L(0, k)
expectedOverageUnits  = E[(U − k)⁺] = E[U] − k + expectedUnusedUnits
impliedUnitPrice      = packPrice / k
utilisation           = (k − expectedUnusedUnits) / k              ∈ [0, 1]
probabilityOfOverage  = 1 − F(k)
expectedBreakage      = expectedUnusedUnits · impliedUnitPrice     (expiring packs only)
expectedBuyerCost     = packPrice + expectedOverageUnits · overagePerUnit
```

`expiresAtPeriodEnd` defaults to true. A pack that rolls over reports zero
breakage and zero unused units: those units are still owed to the buyer, which
makes them a deferred-revenue question rather than a pricing one. A band whose
P10 or P90 is non-positive has no lognormal fit, so it degenerates to a point
mass at P50; a band with `P50 = 0` consumes nothing and forfeits the whole
pack.

**Where the money goes.** `expectedBuyerCost` folds into `effectivePrice`
exactly as §4.15's surcharge does, so the envelope primitive (§4.2) never
learns that packs exist. Breakage is **not** a sixth waterfall term. It is
already inside `Revenue`, and it is reported beside the identity as a
partition of it:

```text
Revenue = deliveredRevenue + breakageRevenue
Potential = Revenue + OwnBuyerSurplus + FencingGap + Unserved + CompetitorLoss   (§4.3, unchanged)
```

`conservationResidual` is therefore untouched by this extension, and
`breakageRevenue` is emitted on the readout only when the menu sells a pack —
an absent key, not a zero, so every pre-extension scenario and golden is
byte-identical.

**Outcome pricing.** A metric carries an optional `unitKind ∈ {consumption,
outcome}`, default `consumption`. The arithmetic is identical for both; the
kind is carried explicitly because nothing downstream would otherwise notice
the difference, and one rule reads them differently (below). An `outcome` unit
is a _result_ — a resolved ticket, a completed task — rather than a unit of
resource spent.

**Linter rules (§4.9 family U).** Each is gated on the offer carrying a pack or
a metered line, so a flat/per-seat menu is provably silent on all three.

- **U1 overage cliff** — `overagePerUnit > impliedUnitPrice` and the segment
  exceeds the pack with probability > 20%. Rational buyers bulk-shift to a
  larger pack or the next tier, so the modeled overage revenue is unlikely to
  arrive. Warning.
- **U2 credit-expiry resentment** — an expiring pack whose `utilisation` is
  below 70%. Warning below 50%, info between. The money is real; the finding is
  about what an unspent balance does to a renewal.
- **U3 allowance dead zone** — an included allowance the segment exceeds with
  probability < 5%. Restricted to `consumption` metrics: an unspent outcome
  allowance is a value question, not a broken fence. Info.

Backwards compatibility: the persistence schema adds optional
`tier.creditPacks`, `addOn.creditPacks`, and `usageMetric.unitKind` with no
default rewriting; `SCHEMA_VERSION` is unchanged.

Required tests (`@spec §4.17`): T-CRD-01 the unit identity and utilisation
bounds; T-CRD-02 a rolling pack reports no breakage; T-CRD-03 packs far above
P90 and far below P10; T-CRD-04 the cliff predicate is strict; T-CRD-05
property bounds on random packs and bands; T-CRD-06 the degenerate-band
fallback; T-CRD-07 invalid packs are rejected; T-CRD-08/09 hybrid summary
splits breakage from overage and treats an unbanded metric as inert; T-CRD-10
allowance dead zones; T-CRD-11 the surcharge reaches `effectivePrice` and
labels its breakage; T-CRD-12 the §4.3 identity is undisturbed and the key is
absent without packs; T-LNT-13…18 the three U rules and their gates.

### §4.18 Repricing & migration (extension)

Everywhere else the buyers are new. Here they are already customers on a plan,
and the question is what happens when the packaging under them changes. The
mechanics are the same primitive: the **incumbent plan is one more offer in the
§4.2 envelope**, with `owner = own` and `kind = incumbent`.

**Notation (extension only).** Segment `s` has an installed base of `b_s`
accounts on incumbent plan `I` with account-level value `V_s(I)` and
grandfathered price `P_s(I)`, and a one-off account-level switching cost
`c_s ≥ 0`. `O` is the proposed menu, already expanded for `s` by §4.2's offer
expansion, including its outside option and any competitors.

**Where the switching cost goes.** Utility is `ε·V − P`, and a switching cost
is a dollar amount the buyer's scale factor does not multiply, so it belongs on
the price side. The envelope pins the outside option at `(0, 0)` and cannot
carry a shifted one, so the cost is charged on the moves rather than credited
to the stay:

```text
choice set = { (V_s(o), P_s(o) + c_s) : o ∈ O, o ≠ outside }
             ∪ { outside at (0, 0) }
             ∪ { (V_s(I), P_s(I)) }        when the policy leaves I available
```

Two consequences are stated rather than hidden. First, **churning to no vendor
is modeled without the switching cost**: what is priced is the cost of standing
a replacement up, not the cost of stopping. This is the conservative direction
— it makes churn easier to choose, and a migration model that under-predicts
churn is the dangerous one. Second, the switching cost is a **buyer** cost:
choice-set prices carry it, and the revenue bridge books each destination's own
price.

**Policy is the choice set.**

- `grandfather` — `I` stays in the set at `P_s(I)` indefinitely.
- `forced-at-renewal` — `I` is removed; every account re-chooses or leaves.
- `opt-in-with-deadline` — `I` stays in the set. For a rational buyer this is
  identical to `grandfather`; the difference is inertia, and D-08 forbids
  inventing a behavioral coefficient. The engine therefore reports
  `mrrRequiringBuyerAction` (the closing MRR sitting on `I`) as an exposure
  ceiling instead of discounting it by an assumed take-up rate.

**Outputs.** Shares come from §4.2 on the choice set above. For each active
offer `k` with share `share_k`:

```text
accounts_k    = b_s · share_k
revenue_k     = accounts_k · P_s(k)          for own offers; 0 for competitors and the outside option
delta_k       = revenue_k − accounts_k · P_s(I)
openingMrr    = b_s · P_s(I)
expansion     = Σ_(own k, delta_k > 0) delta_k
contraction   = Σ_(own k, delta_k ≤ 0) delta_k
churn         = Σ_(k ∉ own) delta_k
closingMrr    = Σ_k revenue_k
```

**Bridge identity (must hold exactly):**
`closingMrr = openingMrr + expansion + contraction + churn`. It follows from
shares summing to 1: the three movements partition the base and are disjoint by
construction. `bridgeResidual` reports the deviation and is zero within
binary64 error. The migration matrix is the set of `(segment, destination)`
cells above; a competitor destination and the outside option are kept apart so
"left the category" is legible from "left for a named rival".

**The grandfathering counterfactual.** Under a policy that keeps `I`, the
engine also runs the same segment with `I` withdrawn and reports
`withdrawnIncumbentMrr` and `grandfatherOpportunityCost = withdrawnIncumbentMrr
− closingMrr`. This is the number that makes M1 a rule rather than an
observation: a sticky legacy cohort is only a problem when withdrawing the plan
would earn more _after_ the churn withdrawing it causes. Under
`forced-at-renewal` the cost is zero — the plan is already gone.

**Reported beside, never substituted into.** `simulateEconomics` (§4.3) still
answers "what would a fresh buyer choose?"; this answers "what does the base
already on us do?". They are different populations and no KPI mixes them.

**Linter rules (§4.9 family M).** All three are gated on a migration readout
being supplied, so a greenfield scenario is provably silent.

- **M1 stranded legacy cohort** — a non-forced policy, stay share > 50%, and
  `grandfatherOpportunityCost > 0`. Warning.
- **M2 migration prices a segment into churn** — churn share > 10%, quantified
  against the expansion the same migration wins from every other segment.
  Warning.
- **M3 legacy pricing depends on a deadline** — `opt-in-with-deadline` with
  non-zero `mrrRequiringBuyerAction`. Info.

**Persistence.** The scenario gains an optional `migration` block naming the
incumbent design, the policy, and one base row per segment
(`{segmentId, incumbentTierId, baseCount, switchingCost}`). The incumbent plan
is a _tier of another design in the same scenario_, so current-design vs
proposed-design is the §15 M-10 diff's first-class comparison
(`diffDesignPair`), and the incumbent's value and effective price are computed
by the same `expandOffers` path as every other offer — a migration readout can
never disagree with the simulator about what the legacy plan costs.
`SCHEMA_VERSION` is unchanged.

Required tests (`@spec §4.18`): T-MIG-01 the bridge reconciles under every
policy; T-MIG-02 the matrix accounts for the whole base; T-MIG-03 withdrawing
the incumbent matches the forced run; T-MIG-04 the switching cost sticks buyers
and is never booked as revenue; T-MIG-05 opt-in equals grandfathering plus a
disclosed exposure; T-MIG-06 competitor exits are separated from category
exits; T-MIG-07 the bridge is exact on random bases and policies; T-MIG-08
invalid bases are rejected; T-MIG-09…12 the state adapter, its gates, metered
incumbent pricing, and schema cross-validation; T-MIG-13…15 the design-pair and
scenario diffs; T-LNT-19…22 the three M rules and their gate.

### §4.19 Discount-policy leakage (extension)

List price is a ceiling; achieved price is a policy outcome. Every §4.3 number
is computed at list, which is the right answer for the menu that was _designed_
and the wrong one for the menu buyers are actually offered. This extension
evaluates the second one through the same upper envelope (§4.2) — a discount is
a price, and prices are what the envelope already takes.

**Policy.** Each paid tier `t` may carry `floorFraction_t ∈ [0, 1]`, the deepest
discount sales may reach as a fraction of list, optional approval bands
`{upToFraction, approver}` (reported, never simulated as a friction), and
`hitRate_{t,s} ∈ [0, 1]`, the expected share of segment `s`'s deals that reach
that floor. Per segment, `Σ_t hitRate_{t,s} ≤ 1`.

**Cohorts, not a discount distribution.** Rather than invent a per-deal
distribution over discount depth, the population is partitioned into cohorts the
envelope evaluates exactly:

```text
list cohort     : weight 1 − Σ_t hitRate_{t,s},  menu = list
cohort for t    : weight hitRate_{t,s},          menu = list with only tier t at its floor
```

Discounting tier `t` reduces every offer built on `t` — the plain tier and its
add-on composites — by the same **absolute** amount `floorFraction_t · P_s(t)`,
where `P_s(t)` is the plain tier's own effective price. Add-ons are separate
lines and keep their prices. Prices are floored at zero.

```text
listMrr_s              = MRR of the list menu at §4.3
achievedMrr_s          = Σ_cohorts weight · MRR(cohort menu)
discountLeakage_s      = listMrr_s − achievedMrr_s
discountLeakageShare_s = discountLeakage_s / listMrr_s      (0 when listMrr_s = 0)
```

The leakage is deliberately **not** `hitRate × depth × revenue`: at a discounted
price buyers also re-sort, and some re-sort upward, so achieved MRR can exceed
list in a segment where a floor pulls buyers up a tier. Running each cohort
through the envelope captures that; multiplying through cannot. The assumption
is a mixture over cohorts rather than a joint distribution over depth and ε, and
it is stated in the UI and the record.

**Fence erosion.** A menu is a screen. The structurally important failure is a
discounted Better beating an undiscounted Best _for the buyers Best was built
for_. The test is **not** "the higher tier's share goes to zero" — it cannot,
since a strictly-higher-value line always wins the envelope again at a high
enough ε, so that predicate would never fire. What is asked instead, for the
segment's **P90 buyer** at scale `ε₉₀ = exp(σ_s · z₉₀)` (and `ε = 1` when
`σ_s = 0`, where the segment is a point mass):

```text
erosion(t, h, s)  ⟺  argmax at ε₉₀ on the list menu is h,
                     argmax at ε₉₀ on tier t's floor menu is t,
                     and V_s(h) > V_s(t)
```

Erosion is a property of the **policy**, not of how often it is used: it is
checked at the permitted floor even when the hit rate is zero, because a floor
that un-fences the menu does so on the first deal that reaches it. The readout
reports `shareAtList` and `mrrAtRisk` for the eroded tier, plus the shallowest
approver whose band covers the permitted depth.

**Naming.** `linter.ts` already uses "leakage" for the free tier (E5) and
`time-dynamics.ts` for trial conversion. This concept is `discountLeakage`
everywhere and never the bare word.

**Reported beside, never substituted into.** Headline MRR, conversion, and
capture rate stay at list. A tool that quietly answered the achieved-price
question while labelling it the designed-price one would be doing the thing this
module exists to expose.

**Linter rules (§4.9 family P).** Both gated on a discount readout being
supplied, so a list-priced design is provably silent.

- **P1 the discount policy has un-fenced the menu** — one finding per erosion,
  naming the tier, the segment, the MRR at risk, and the approver. Warning.
- **P2 permitted discounts move material revenue** — `discountLeakageShare`
  above 10%. Warning.

**Persistence.** `design.discountPolicies` is optional; absent means list price
is the achieved price. `SCHEMA_VERSION` is unchanged.

Required tests (`@spec §4.19`): T-DSC-01 no policy changes nothing; T-DSC-02
leakage is priced through the choice model, not multiplied out; T-DSC-03 the
P90 flip fires at depth and not shallow; T-DSC-04 erosion is checked at a zero
hit rate; T-DSC-05 a cheaper tier is never reported as eroded; T-DSC-06 add-ons
keep their prices; T-DSC-07 cohort weights partition and leakage is bounded on
random policies; T-DSC-08 invalid policies are rejected; T-DSC-09 a policy on an
absent tier is inert; T-DSC-10…13 the state adapter, its gate, the shared
list-MRR definition, and schema cross-validation; T-LNT-23…25 the two P rules
and their gate.

### §4.12 Numerical conventions

Prices are non-negative; UI `σ_s` is `[0.05, 2.0]` with low/medium/high presets
of `0.25/0.5/0.9`. Percentages display to one decimal; USD uses
`Intl.NumberFormat`. Softmax uses log-sum-exp. All engine randomness is an
injected seeded PRNG. The engine remains pure TypeScript: no React, DOM,
`Date.now`, or ambient `Math.random`.
