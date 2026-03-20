# Wind Tunnel — Economic Engine & Method Catalog

The normative economics for this repository: the buyer model, offer selection by upper envelope,
the economics readouts and the conservation identity, price sweeps, the second-degree price-
discrimination oracle, the bundling analyzer, Van Westendorp, Monte Carlo and tornado, the design
linter rule families, conjoint and MaxDiff, and the competitive price-value map.

**This document is authoritative and permanent.** Source comments cite it by section number as
`docs/MATH-SPEC.md §X`; where a source comment and this document disagree, this document wins until an
owner ruling says otherwise. Section numbering is contract — renumbering a section breaks every
citation that points at it.

---

Everything here is normative. Phase 1 extracts §4 into `docs/MODEL-SPEC.md` with section numbers preserved; every engine test cites the spec section it verifies (§7.3). Named tests (T-IDs) are the acceptance instruments — phases are reviewed against them.

**Notation.** Segments `s` have prospect count `n_s`, seat count `c_s ≥ 1`, account-level per-feature median values `v[s,f] ≥ 0` ($/account/month for a representative account of `c_s` seats), and within-segment spread `σ_s`. Feature catalog `F`. An **offer** `o` has feature set `F_o` and list price `p_o`; flat `p_o` is $/account/month, while per-seat `p_o` is $/seat/month and has effective account price `P_s(o) = p_o · c_s`. Offer value `V_s(o) = Σ_{f ∈ F_o} v[s,f]` is always the account-level value for that segment (additive valuation — complementarity is v2). The Model UI explicitly labels `W_s` as total account WTP at the stated seat count; it is not a per-seat WTP field.

### 4.1 Buyer model

Within segment `s`, an individual buyer draws a scale factor `ε ~ LogNormal(0, σ_s²)` (median 1) and values offer `o` at `ε · V_s(o)`. Buyer utility: `u(o) = ε·V_s(o) − P_s(o)`; outside option `u = 0`.

- Structure: **horizontal** differentiation across segments (different value _vectors_), **vertical** within a segment (one-dimensional scale ε). Within a segment, single-crossing holds by construction: offers rank identically for all buyers by `V_s`, and higher-ε buyers gain more from higher-V offers. This is a mixture of textbook vertical models (Mussa–Rosen / Tirole §3.5; Shapiro–Varian versioning), which is exactly the screening structure the product teaches.
- Input mapping: user enters median total WTP `W_s` for the full catalog and allocation shares `w[s,f]` (Σ_f w = 1) → `v[s,f] = W_s · w[s,f]`. Advanced view edits `v` directly.
- Two distinct uncertainty knobs, never conflated (UI must teach this): `σ_s` = _how much buyers within the segment differ_ (analytic, §4.2); the P10/P90 **confidence bands** around base/P50 `W_s` and `n_s` = _how unsure the user is_ (Monte Carlo, §4.8).
- Lognormal band contract: all base values and quantiles are strictly positive. Base `x` is P50, so the fitted band must satisfy `x = sqrt(q10·q90)`. The UI edits a symmetric log-space width around `x` (or mirrors the opposite bound when one bound changes), rather than accepting three inconsistent quantiles. Given `(q10, q90)`, `μ = (ln q10 + ln q90)/2 = ln x`, `σ = ln(q90/q10) / (2·z90)`, `z90 = 1.2815515655446004`. `q10 = q90 = x` is the explicit deterministic branch (`σ = 0`), not a validation error.

Tests — **T-STAT-01** Φ matches reference values to 1e-7: Φ(0)=0.5, Φ(1)=0.8413447461, Φ(1.96)=0.9750021049, Φ(−3)=0.0013498980. **T-STAT-02** Φ⁻¹(Φ(x))=x to 1e-9 on the interior [−6, 6] grid and to 1e-8 at the ±6 endpoints (D-32: binary64 rounding yields 8.85e-9 at +6). **T-STAT-03** band fit round-trips: quantile(fit(q10,q90), .1)=q10 and (.9)=q90 to 1e-9 rel. **T-STAT-04** lognormal partial expectation (§4.3) matches numeric integration (Simpson, 1e-6 rel) on 20 random (σ, a, b).

### 4.2 Offer selection — the upper envelope (the core primitive)

Buyer with scale ε chooses `argmax_o { ε·V_s(o) − P_s(o) }` including the outside option `(V=0, P=0)`. Exact ties (equal utility within the tie tolerance, §4.12) are resolved by an explicit **tie mode** — a parameter of `selectOffers`, default `'conservative'`:

- **`'conservative'`** — the product simulator everywhere. Break to **lower effective price, then lower value**, and prefer the outside option when a paid offer ties it. Conservative for revenue, deterministic, documented in-UI. This is the rule D-16 governs.
- **`'seller-favorable'`** — the closed-form-oracle validation harness only (§4.5 screening, §4.6 bundling), always at the σ→0 point-mass path. Break to **higher value, then higher price**, and prefer _participation_ over the outside option on a tie. This is the δ→0 limit of pricing strictly inside each binding constraint: the textbook menus price served buyers exactly at a binding value, so the indifferent buyer is assumed to participate and take the intended (highest-value) offer. The two modes are exact mirror images.

**Exact own/competitor identity policy (D-31).** If an own offer and a competitor have identical effective `(V, P)`, attribute the full tied mass to the competitor before either tie mode is applied. This is the explicitly conservative policy: it does not inflate own revenue and preserves the five-term accounting by assigning the value to `CompetitorLoss`. Stable offer ID remains only the deterministic fallback among otherwise equivalent offers of the same owner class.

Running the screening/bundling oracle fixtures under `'conservative'` sends every indifferent buyer to the outside option and reports revenue far below the textbook result (see the guard in §4.5) — that is a _test-configuration_ error, not an engine bug. Fixtures not specifically exercising tie behavior should price strictly inside participation (no exact ties) so they read identically under either mode (D-20).

In ε-space each offer is a line `u_o(ε) = V_o·ε − P_o`. The chosen offer as a function of ε is the **upper envelope** of these lines: a sequence of active offers with increasing V and increasing breakpoints

```
ε*(o_k → o_{k+1}) = (P_{k+1} − P_k) / (V_{k+1} − V_k)
```

Algorithm (convex-hull trick): dedupe equal-V offers keeping min P; sort by V ascending; stack-scan popping any line whose intersection with its predecessor occurs at or before the predecessor's own entry breakpoint. Offers never on the envelope have **zero share** (dominated — the linter reuses this, §4.9).

Share of segment s choosing active offer k, with `Φ_ln(x) = Φ(ln(x)/σ_s)` and breakpoint interval `(a_k, b_k]` clipped to ε > 0:

```
share_k = Φ_ln(b_k) − Φ_ln(a_k)
```

Degenerate case σ_s = 0: all mass at ε = 1; choose by direct argmax under the active tie mode (§4.2). The screening/bundling oracles (§4.5, §4.6) exercise exactly this path with `tieMode = 'seller-favorable'`.

**Offer expansion.** The simulated offer set per segment = paid/free tiers × subsets of ≤ 3 add-ons not already contained in the tier (composite value = union of features; composite price = sum), plus outside option, plus (when Positioning is active, §4.11) any competitor alternatives valued for that segment. Add-on purchase is therefore _jointly_ optimal with tier choice — no greedy approximation. Cap: ≤ 5 tiers × 2³ add-on subsets + 1 outside + up to 6 competitors = ≤ 47 offers/segment.

Tests — **T-ENV-01** dominated offer (V ≤, P ≥ another) gets zero share for every σ. **T-ENV-02** breakpoints strictly increasing; shares sum to 1 (incl. outside) to 1e-12. **T-ENV-03** _brute-force cross-validation_: for 200 fast-check-random offer sets and σ values, sample 1,000 ε quantile points; direct argmax agrees with envelope interval assignment at every point (away from breakpoint ties by > 1e-9). **T-ENV-04** σ=0 reproduces point-WTP argmax with documented tie-breaking. **T-ENV-05** free tier `(V>0, P=0)`: outside option gets zero share for ε > 0; free absorbs the low-ε mass. **T-ADD-01** add-on expansion agrees with brute-force enumeration over tier × subset combos on random fixtures. **T-CMP-08** pins competitor-first own/competitor identity attribution and input-order independence.

### 4.3 Economics readouts & the conservation identity

With lognormal partial expectation `L(a,b) = E[ε·1(a<ε≤b)] = e^{σ²/2}·[Φ((σ²−ln a)/σ) − Φ((σ²−ln b)/σ)]` (limits: `ln 0 → −∞`), per segment s over active offers k on intervals `(a_k, b_k]`:

```
Revenue_s      = n_s · Σ_{k ∈ own tiers/add-ons} share_k · P_k
OwnBuyerSurplus_s = n_s · Σ_{k ∈ own offers (paid or free)} [ V_k · L(a_k, b_k) − P_k · share_k ]
FencingGap_s   = n_s · Σ_{k ∈ own offers (paid or free)} (V_full − V_k) · L(a_k, b_k)      where V_full = V_s(F)
Unserved_s     = n_s · V_full · L(outside interval)
CompetitorLoss_s = n_s · Σ_{k ∈ competitors} V_full · L(a_k, b_k)       (only when Positioning active)
Potential_s    = n_s · E[ε] · V_full ,   E[ε] = e^{σ²/2}
```

**Conservation identity (must hold exactly):** `Potential = Revenue + OwnBuyerSurplus + FencingGap + Unserved + CompetitorLoss`. This is deliberately an _our-catalog potential_ identity: each buyer's `ε·V_full` is assigned to an own offer (price paid + buyer utility + features withheld), to non-conversion, or to a competitor. A free fenced offer participates in `FencingGap` even though its price is zero. Competitor utility/revenue is intentionally **not** folded into `OwnBuyerSurplus`; it may be reported separately as a non-conserved comparison metric, never in this waterfall. When no competitors are active, `CompetitorLoss = 0` and the identity collapses to the four-term form.

KPIs: `MRR = Σ_s Revenue_s`; `paid conversion = paid buyers to us / Σ n_s`; `ARPA = MRR / paid buyers to us`; **capture rate** `= MRR / Σ Potential_s` (headline metric); **competitor loss share** `= Σ CompetitorLoss / Σ Potential_s` (headline metric when Positioning is on). Counterfactual diffs: re-run with an offer removed (e.g., free tier, a competitor) → `Δ MRR` = that offer's leakage/contribution (used by linter E5, E7 and the add-on and competitor analyses).

Tests — **T-ECON-01** hand-computed 2-segment, 2-tier fixture matches all readouts to 1e-9. **T-ECON-02** (property, fast-check) conservation holds to 1e-6·Potential on random scenarios _with and without_ competitor alternatives. **T-ECON-03** (property) raising one offer's price weakly decreases its own share. **T-ECON-04** analytic own-buyer surplus matches numeric integration on random fixtures (1e-6 rel). **T-ECON-05** counterfactual remove-offer: removing a zero-share offer changes nothing (to 1e-12). **T-ECON-06** has two hand-computed guards: a fenced free tier contributes its withheld value to `FencingGap`, and a competitor selection contributes only `CompetitorLoss` (not `OwnBuyerSurplus`); both preserve the identity exactly.

### 4.4 Price sweeps (demand & revenue curves)

For a selected tier, sweep its **list-price unit** over a 400-point base grid plus the exact current price, recomputing the envelope at each point. The initial upper bound is `max(current price, 1.5 × max_s V_full,s)` for flat pricing and `max(current price, 1.5 × max_s (V_full,s / c_s))` for per-seat pricing. If revenue is still rising at the upper boundary or the best point lies in the top 5% of the range, double the upper bound and recompute, up to 8 expansions. If the expansion cap is reached with a boundary optimum, label the result “best in searched range,” show the range, and do not imply an optimum. Changing a tier price shifts every composite offer derived from that tier; `Q(p)` and `R(p)` aggregate the selected tier plus those composites. Render current-price and best-in-range markers. This is the residual demand curve given the rest of the menu (and any active competitors), labeled as such.

Tests — **T-SWP-01** the exact current price is included and equals the scenario's simulated values (1e-9). **T-SWP-02** `Q(p)` weakly decreases in own price (property). **T-SWP-03** golden fixture: argmax within one grid step of independently computed optimum. **T-SWP-04** a high-spread fixture whose peak lies beyond the initial 1.5× bound triggers expansion and returns an interior best point; an expansion-cap fixture reports the boundary warning.

### 4.5 Second-degree price discrimination oracle (screening correctness)

The classic two-type menu result the engine must reproduce (Mussa–Rosen; σ→0). Types L, H; tiers Basic ⊂ Pro; values `V_LB, V_LP, V_HB, V_HP` with single crossing (`V_HB ≥ V_LB`, `V_HP − V_HB ≥ V_LP − V_LB`). Optimal serve-both menu:

```
p_B = V_LB                       (L's IR binds — full extraction on Basic)
p_P = V_HP − V_HB + V_LB         (H's IC binds — H keeps information rent V_HB − V_LB)
Exclude L entirely  iff  n_H·(V_HB − V_LB) > n_L·V_LB   (then p_P = V_HP)
```

Canonical fixture: `V_LB=40, V_LP=55, V_HB=60, V_HP=100`, `n_L=100, n_H=50` → `p_B=40, p_P=80`, revenue `8000`; exclusion variant `n_L=10` → Pro-only at `p_P=100`, revenue `5000 > 4400`.

**Tie-convention guard — read before implementing these tests.** This menu prices each served type exactly at a binding value (L's IR: `p_B = V_LB`; H's IC: `p_P` leaves H indifferent between the two tiers), so every served buyer sits on an exact tie. The engine reproduces the textbook revenue **only** under `tieMode = 'seller-favorable'` at the σ→0 point-mass path (§4.2). Under the simulator's default `'conservative'` mode the same fixture yields ≈2000 (L → outside on its IR tie; H → Basic on its IC tie), and σ=1e-3 under _any_ mode yields ≈5000 (pricing at the segment median drops the below-median half). **If T-SCRN-01 does not return 8000, the tie mode / σ is the suspect — do not modify the envelope or selection engine to force the number.** The engine is correct; the test must run σ=0 with `'seller-favorable'`. (Verified numerically during review S2, D-20.)

Tests (all at **σ=0** with **`tieMode = 'seller-favorable'`** per the guard) — **T-SCRN-01** engine at (40, 80): L→Basic, H→Pro, revenue exactly 8000, L surplus = 0, H surplus = 20/buyer. **T-SCRN-02** perturb `p_P` to 85 → H switches to Basic (cannibalization; strict preference, no tie), revenue 6000. **T-SCRN-03** exclusion variant: menu {Pro@100} beats serve-both 4400, L takes outside option. **T-SCRN-04** no-distortion-at-top sanity: at the optimal menu, H buys the highest-value tier.

### 4.6 Bundling analyzer (Adams–Yellen on the envelope engine)

Question it answers: _should capability X be a tier fence, a separate add-on, or both/mixed?_ Model two goods A, B (feature bundles) with per-segment values from the same matrix. Regimes as offer sets on the standard engine (§4.2):

```
Pure components : {A@p_A, B@p_B, A+B@(p_A+p_B)}     (buying both is allowed)
Pure bundle     : {A+B@p_AB}
Mixed bundling  : {A@p_A, B@p_B, A+B@p_AB}, p_AB ≤ p_A + p_B
```

Within-segment ε is perfectly correlated across goods (one scale factor), so bundling gains come from _across-segment_ value dispersion — the honest SaaS interpretation, stated in-UI. Optimizer: exhaustive enumeration of the documented finite candidate grid for each regime's prices on the closed-form revenue (segment valuations ± spread quantiles, plus a "not offered" sentinel = price above all WTP); report the **best price found under the documented search grid**, regime deltas, and the searched candidates. Comparisons at given prices are exact; the UI never calls a grid-search result a global optimum.

Tests (closed-form optima T-BND-01…03 at **σ=0** with **`tieMode = 'seller-favorable'`**: pricing a bundle at exactly its value is a participation tie, and the textbook optimum assumes the buyer participates — same guard as §4.5) — **T-BND-01** canonical negative-correlation case: segments (A=9,B=1) and (A=1,B=9), equal sizes → pure components optimum 9/9 (rev 18·n), pure bundle 10 (rev 20·n); bundle wins. (Under `'conservative'` the pure-bundle-at-10 fixture yields 0 — the guard applies here too.) **T-BND-02** mixed ≥ max(components, pure bundle) at optima (mixed nests both; property, tolerance = grid resolution). **T-BND-03** σ→0 optimizer matches brute-force grid over type valuations on random 3-segment fixtures. **T-BND-04** the simulator's default `'conservative'` mode: between two _offered_ options of equal utility the buyer takes the cheaper one — an offer-vs-offer tie, distinct from the participation tie the other tests exercise — documenting why "not offered" sentinels matter.

### 4.7 Van Westendorp Price Sensitivity Meter

Survey-first stance: the PSM module analyzes _fielded_ responses (manual entry or CSV paste: 4 prices per respondent). A model-generated illustrative mode exists but is labeled "simulated from your assumptions — for intuition, not evidence" (mapping documented in-UI; ledger D-11).

Construction: per respondent quadruple `(too cheap ≤ cheap ≤ expensive ≤ too expensive)`; violators flagged and excluded (count shown — data hygiene is part of the pedagogy). Cumulative curves on the union grid of response prices: "too cheap" and "cheap" descending; "expensive" and "too expensive" ascending; `not cheap = 100% − cheap`, `not expensive = 100% − expensive`. Crossings by piecewise-linear interpolation:

```
PMC = too cheap × not cheap      PME = too expensive × not expensive
IPP = cheap × expensive          OPP = too cheap × too expensive
Acceptable range = [PMC, PME]
```

(Conventions vary in the literature; ours pinned to the standard operationalization of van Westendorp 1976, stated in the explainer.) No crossing → point reported "undefined for this data" — never fabricated.

Tests — **T-VW-01** monotonicity validation drops exactly the violating respondents on a fixture. **T-VW-02** symmetric synthetic dataset (quadruples mirrored around 50) → OPP = IPP = 50 exactly; PMC, PME symmetric about 50. **T-VW-03** hand-computed 5-respondent fixture matches all four points to 1e-9. **T-VW-04** no-crossing fixture returns undefined markers, not numbers.

### 4.8 Monte Carlo & tornado (assumption uncertainty)

Uncertain parameters: each segment's P50/base `W_s` (value scale) and `n_s` (size), via the P50-centered P10/P90 bands in §4.1 → lognormal draws; `σ_s` and prices held fixed. A zero-width band is a constant equal to the base value. PRNG: mulberry32, seed visible in UI and stored in the scenario. K = 1,000 draws (configurable 200–5,000); each draw is evaluated with the closed-form engine (no nested simulation). All A/B designs receive the **same indexed vector of parameter draws** (common random numbers), so a win rate is paired rather than a comparison of unrelated samples; an equal-MRR draw is a tie, not a win. Outputs: MRR distribution (P10/P50/P90 band), per-design; A/B win rate ("B beats A in 78% of draws"); tornado = one-at-a-time low/high (P10/P90) per parameter vs. base, bars sorted by |ΔMRR|. Tornado × provenance tags → the validation to-do list.

Tests — **T-MC-01** fixed seed → byte-identical percentiles and first 5 draws (snapshot). **T-MC-02** zero-width bands → P10 = P50 = P90 = analytic MRR exactly. **T-MC-03** MC mean within 3 standard errors of analytic value on a 1-uncertain-parameter fixture. **T-MC-04** tornado of a parameter with zero-width band has zero-length bar. **T-MC-05** two identical designs consume the same draw vector and produce 100% ties / 0% wins for either side.

### 4.9 Design linter (deterministic critic)

Every rule: id, exact trigger, severity, message, citation where applicable; all computed from the scenario + simulation results, no randomness. Economic rules:

- **E1 dead fence** — feature in no offer, or in all offers including free: fence carries no screening information. Info.
- **E2 dominated offer** — zero envelope share for every segment (§4.2): dead weight _or_ deliberate decoy. Message explains asymmetric dominance honestly: the rational model scores it inert; behavioral evidence (Huber–Payne–Puto 1982) says a dominated decoy can lift the dominating tier — the model won't invent a number for that, but here's the trade-off to consider. Warning.
- **E3 fence inversion** — a higher-priced tier missing a feature a cheaper tier has (non-nested ladder): breaks the upgrade narrative; sometimes intentional ("good-better-different"), so warn with rationale. Warning.
- **E4 downgrade mass / cannibalization** — > 30% of a segment's buying mass chooses an offer with value below the segment's value-maximal tier; message names the price gap and fence causing it (read from breakpoints). Warning with $ quantification.
- **E5 free-tier leakage** — counterfactual remove-free re-run (§4.3): "free absorbs X% of would-be paid demand ≈ $Y MRR." Info/warning by threshold (default: warn > 15% of MRR).
- **E6 add-on cannibalization** — counterfactual remove-add-on: add-on's net MRR contribution after tier-mix shift; negative → warning.
- **E7 competitor loss (Positioning only)** — a segment loses > 25% of its Potential to a single competitor: message names the competitor and the tier(s) it beats on the envelope. Warning with $ quantification.
  Behavioral rules (cited, deterministic):
- **B1 choice overload** — > 4 paid offers visible (Iyengar–Lepper 2000, framed as directional evidence with replication caveats). Info.
- **B2 weak anchor** — top tier takes < 2% share and < 1% of MRR: prune it, or reposition deliberately as an anchor/decoy (explainer covers anchoring; Tversky–Kahneman 1974). Info.

Tests — **T-LNT-01…09** one fixture per rule triggering it exactly, plus a clean fixture triggering none.

### 4.10 Conjoint (CBC) & MaxDiff-lite

**Purpose.** Estimate feature-level preference weights from choice data, then optionally bridge those weights into the value matrix. Positioned as "the survey-driven complement to the assumption-driven model" — the same pedagogical stance as PSM: your assumptions get pressure-tested by real choices.

**Choice-based conjoint (CBC).** User defines 1–5 non-price attributes with 2–4 levels. The bridge requires a **numeric price column** in $/account/month, the same unit as the value matrix; a categorical price attribute may be estimated and charted but cannot enable a WTP bridge. The design generator produces `T` choice tasks (default 12), each a set of `k` (default 3) concepts + an optional "None" alternative. Its random-balanced contract is achievable for arbitrary valid `T`, `k`, and level counts: within each non-price attribute, level appearance counts differ by at most one (exact equality only when `T·k` is divisible by that attribute's level count). D-efficient generation is a later refinement (§2.2, D-17). It rejects duplicate concepts within a task and validates full column rank before a study can be fielded. Respondent data entry is manual or CSV of `respondent_id, task_id, chosen_alternative`.

**Model.** Multinomial logit with effects-coded **non-price** part-worths. For attribute `a` and level `l`, part-worth `β_{a,l}` has identifying constraint `Σ_l β_{a,l} = 0`; implementation estimates `L_a−1` free coefficients and reconstructs the final level. For bridge-enabled studies, the numeric price coefficient `β_p` is utility per $/account/month. Concept `j` has utility `u_j = Σ_a β_{a, level(j,a)} + β_p·price_j`; None utility is `β_None`. Choice probability in set `S_t` for respondent `r`:

```
P(choose j | S_t; β) = exp(u_j) / Σ_{k ∈ S_t} exp(u_k)   (log-sum-exp for numerical stability)
```

Aggregate log-likelihood (pooled across respondents — HB deferred, §2.2):

```
ℓ(β) = Σ_r Σ_t log P(chosen_{r,t} | S_t; β)
```

`ℓ` is concave; it is strictly concave only when the design is full rank and the observed choices are not separated. Estimate via **damped Newton-Raphson** with analytic gradient and Hessian, backtracking only on likelihood-improving steps, to `‖∇ℓ‖∞ < 1e-8` or 50 iterations. Return one of `ok`, `nonIdentifiable`, `separated`, or `nonConverged`; only `ok` with invertible observed information may report `SE(β̂) = √diag(−H(β̂)⁻¹)`, 90% CIs, or a WTP bridge. The UI explains failure states instead of fabricating coefficients or CIs. Overall hit rate is training-set descriptive only, never validation accuracy.

**MaxDiff-lite** (importance scoring, no price required). User defines `m` total items (up to 12); the design generator produces tasks each showing `k` (3–5) items; the respondent picks best and worst per task. Before scoring, every defined item must have `times_i_appeared ≥ 1`; otherwise return a validation error naming the unseen items, never `NaN`. Analysis in the first MaxDiff release uses best–worst counting scores

```
s_i = (times_i_chosen_best − times_i_chosen_worst) / times_i_appeared
```

then linearly rescaled so `Σ_i normalized_s_i = 100` and `min ≥ 0` (shift-then-normalize: subtract `min_i s_i`, then scale to sum 100). **Degenerate branch (required):** when all raw `s_i` are equal — the symmetric case that T-MXD-01 feeds — the shift makes every value 0 and the sum-to-100 scaling divides by zero; return the uniform distribution `100/m` across the `m` total scored items. Full MNL best-worst estimation is a later refinement.

**Bridge to the value matrix.** If the study has numeric account-month price, status `ok`, and `β̂_p` is significantly negative (`β̂_p + 1.645·SE(β̂_p) < 0`), a non-price part-worth contrast converts to account-month WTP: for a feature-attribute contrast between level `l₁` and `l₀`,

```
ΔWTP = −(β̂_{a,l₁} − β̂_{a,l₀}) / β̂_p
```

Because the first release estimates one pooled `β`, each `ΔWTP` is an **aggregate proposal**, not a respondent- or segment-specific estimate. Before applying, the user must map each chosen contrast to a catalog feature, explicitly select the segment cell(s) that should receive that aggregate proposal, and confirm the account-month period. The UI shows a separate proposed diff for every selected `v[s,f]` cell and never overwrites silently. Confirmed cells receive `pooled conjoint (N=<respondents>)` provenance. Per-segment refits require their own rank, separation, sample-size, and SE gates and are deferred; respondent mapping alone cannot manufacture segment part-worths. Categorical/no price, a non-negative or insignificant price coefficient, or any non-`ok` status disables the bridge while keeping relative part-worths visible.

Tests — **T-CNJ-01** recovery: simulate 500 respondents from a known `β` on a full-rank 3-attribute × 3-level design with numeric price → estimated `β̂` within 3·SE of truth on every coefficient. **T-CNJ-02** log-likelihood strictly increases on every accepted Newton step until the gradient stop condition. **T-CNJ-03** the observed Hessian is negative-definite at the `ok` optimum of that full-rank, non-separated recovery fixture. **T-CNJ-04** effects-coding constraint `Σ_l β̂_{a,l} = 0` holds to 1e-10 per attribute in the returned estimate. **T-CNJ-05** an exactly balanced β=0 fixture returns near-zero part-worths and no bridge. **T-CNJ-06** bridge is disabled when numeric `β̂_p` is not significantly negative. **T-CNJ-07** rank-deficient and separated fixtures return the named status, no CIs, and no bridge. **T-CNJ-08** generated level counts differ by at most one for every attribute across valid non-divisible `T·k` fixtures. **T-MXD-01** best-worst counting: symmetric fixture across `m` total items → all scores equal (`100/m`) after normalization via the degenerate branch. **T-MXD-02** normalized scores sum to 100 ± 1e-9 and are non-negative. **T-MXD-03** an item with zero appearances returns the named validation error and no scores.

### 4.11 Competitive price-value map & competitor alternatives

**Two coupled surfaces powered by the same data.**

**(1) Positioning map.** Values vary by segment, so the map is explicitly **segment-scoped**: the user selects one segment and every competitor/tier point is plotted with that segment's value and effective price. Axes are value on X and price on Y. A zero-utility ray obeys `P = εV`, so its slope is `ε`, never `1/ε`. Because every segment has median `ε=1`, the UI shows selected-segment P10/P50/P90 rays (derived from that segment's `σ`) rather than pretending there are different median rays. Competitor points are the Pareto non-dominated set, not a convex hull: competitors are discrete alternatives and cannot be mixed (D-21). The map may draw a step-style visual connector, but no line is a market offer.

**(2) Competitor as an alternative in the envelope engine.** Each competitor becomes a per-segment offer `(V_s(competitor), P_competitor)` in that segment's offer set (§4.2), with a flag marking it as a competitor. Simulator computes:

- **Choice share going to a competitor** in a segment = **switching/loss risk** for that segment (headline number).
- Revenue accounting: competitor choice does **not** contribute to `Revenue_s`; it feeds `CompetitorLoss_s` in the conservation identity (§4.3). Our KPIs (MRR, capture rate) stay uncontaminated; a separate "competitor loss share" KPI surfaces when Positioning is active.
- Wind tunnel dot panel adds competitor swatches so churn/loss is _visible_, not just aggregated.

**Frontier construction and verdict.** Given competitor points `{(V_i, P_i)}`, drop dominated points (`V_i ≤ V_j ∧ P_i ≥ P_j` for some j, strict in one component), then sort survivors by V ascending. There is no linear interpolation and no vertical "distance to frontier": either would invent an unavailable competitor offer. A tier receives `directly dominated` only when a competitor has `V_c ≥ V_t ∧ P_c ≤ P_t` (strict in one); otherwise it receives `not directly dominated`. The envelope-engine competitor share remains the quantitative trade-off measure.

Tests — **T-CMP-01** frontier construction: 5-competitor canonical fixture matches an independently computed Pareto set — include a competitor that is Pareto-efficient but off the convex hull, to pin the discrete choice; single-competitor edge case returns that competitor. **T-CMP-02** a ray at slope `ε` passes through `(V, εV)` and a selected segment's P10/P50/P90 slopes match its lognormal quantiles. **T-CMP-03** duplicate competitor points collapse in the frontier (no double-count). **T-CMP-04** direct-dominance verdict triggers only for the stated discrete predicate; a point between two competitors is never judged by interpolation. **T-CMP-05** competitor as engine offer: on a fixture where a competitor priced below every tier at similar value exists, competitor share exceeds 0, paid conversion to us falls, all offer/outside shares still sum to 1, and the five-term conservation identity holds. The test does **not** assert a zero delta in `paid conversion + competitor share`: a competitor may attract previously unserved buyers. **T-CMP-06** identity preservation: enabling Positioning with an empty competitor set leaves all KPIs and shares unchanged (to 1e-12). **T-CMP-07** conservation with competitors: `Potential = Revenue + OwnBuyerSurplus + FencingGap + Unserved + CompetitorLoss` holds on random fixtures with 0–5 competitors (property). **T-CMP-08** pins competitor-first attribution of an own and competitor offer with identical `(V,P)` and proves input order cannot change attributed shares (P1) or KPIs (P2+).

### 4.12 Numerical conventions

Money as floating dollars (modeling tool, not accounting; display-rounded); prices ≥ 0; `σ_s` UI range [0.05, 2.0] with labeled presets (Low 0.25 / Medium 0.5 / High 0.9); tie tolerance 1e-9 (equal utility within this is a tie, resolved by the active tie mode, §4.2); percentages to 1 dp; currency USD-formatted via `Intl.NumberFormat` (multi-currency v2). Φ via a rational-approximation implementation tested to 1e-7 (T-STAT-01); Φ⁻¹ via Acklam/AS-241, tested by round-trip. Softmax via log-sum-exp for numerical stability (Conjoint MNL). All engine randomness flows through the injected seeded PRNG.

---
