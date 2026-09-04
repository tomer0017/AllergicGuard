# AllergicGuard — בדיקת אלרגיית בוטנים

A mobile-first tool for Israeli kindergarten staff caring for a child with a
severe peanut allergy. Scan a product barcode, and get **one** unmistakable
answer in Hebrew.

No registration, no login, no accounts, no database, no dashboard.

```
OPEN APP → SCAN BARCODE → QUERY DATA SOURCES → ANALYZE PEANUT EVIDENCE
        → RED / ORANGE / GREEN → SHOW WHERE THE ANSWER CAME FROM → SCAN AGAIN
```

---

## SAFETY-CRITICAL DESIGN DECISIONS

**Read this section before changing anything in `src/domain/` or `src/services/`.**

### 1. NO DATA ≠ SAFE

Missing information can never produce a green result. Every one of the
following produces **ORANGE**, never green:

product not found · API unavailable · network error · timeout · malformed JSON ·
schema mismatch · missing allergens field · missing traces field · empty
allergen field · conflicting sources · identity-only source · provider error ·
parse failure · unknown reliability · no provider enabled · invalid barcode

### 2. THE APPLICATION DOES NOT DECLARE FOOD SAFE

The green state is worded **"לא נמצא סימון לבוטנים במידע הזמין"** — no peanut
indication was found in the available information. It never says "בטוח", "safe",
or anything equivalent, and it always carries the disclaimer that a
life-threatening allergy still requires reading the package label.

There is **no `isSafe` property anywhere in this codebase**. The domain model is
a discriminated union of `danger | insufficient_data | no_known_risk`, and every
`switch` over it is exhaustive (`assertNever`).

### 3. Positive evidence can never be cancelled

If one source reports peanuts and another is silent — or even reports complete,
clean data — the result stays RED. Silence is not counter-evidence. The
disagreement is recorded as an `ALLERGEN_EVIDENCE_CONFLICT` and shown to the
user; it is never hidden.

### 4. "May contain" is treated as danger

A declared trace/"עלול להכיל" is RED, not orange. For a severe allergy, a
precautionary label is an instruction, not a hint.

### 5. An empty field means "unknown", not "none"

Open Food Facts returns `traces: ""` both when a contributor checked and found
no traces *and* when nobody ever filled the field in. The two are
indistinguishable through the API, so the normalizer records `empty`, and the
engine refuses to clear the product. **This is why many real products return
ORANGE rather than GREEN.** That is intended.

The engine additionally refuses to clear a source that claims complete allergen
data while carrying no allergens, no traces and no ingredients text
(`ALLERGEN_DATA_INSUBSTANTIAL`) — defense in depth against a buggy provider.

### 6. Green requires *positive* completeness

`no_known_risk` is reachable only when **all** of the following hold:

1. at least one enabled, allergen-capable source returned evidence,
2. that source actively reported **both** a "contains" list and a
   "may contain"/traces list,
3. it carries substantive content (allergens, traces or ingredients),
4. its reliability is `medium` or better,
5. no peanut indication was found in structured fields **or** free text,
6. no source conflicts were detected.

This is enforced by `assessAllergenRisk` and locked down by the invariant tests
in `src/domain/allergy/__tests__/assessAllergenRisk.test.ts`.

---

## The three results

| State | Icon | Headline | Meaning |
|---|---|---|---|
| **RED** | ⛔ | נמצא סיכון לבוטנים | Do **not** give the product. |
| **ORANGE** | ⚠️ | אין מספיק מידע — חייבים לבדוק | Do **not** assume it is safe. Check the package. |
| **GREEN** | ✅ | לא נמצא סימון לבוטנים במידע הזמין | No indication found — still verify the label. |

---

## Setup

```bash
npm install
cp .env.example .env   # optional; every value has a safe default
npm run dev            # http://localhost:5173
```

The camera requires a secure context. `localhost` works; on a phone use HTTPS
(e.g. `npm run dev -- --host` behind a tunnel) or the manual barcode entry.

### npm commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build |
| `npm run preview` | Serve the production build |
| `npm test` | Run the full test suite (no network) |
| `npm run test:watch` | Watch mode |
| `npm run typecheck` | `tsc -b --force` |
| `npm run lint` | oxlint |
| `npm run verify` | typecheck + lint + test + build |
| `npm run check:barcode -- <barcode>` | **Dev tool:** run a real barcode against the live providers and print everything |

---

## Architecture

```
BARCODE SCANNER      camera / manual entry — emits a validated barcode only
        ↓
PRODUCT DATA PROVIDERS   one adapter per source, all behind one interface
        ↓
EVIDENCE NORMALIZATION   raw API shapes → ProductEvidence (missing stays explicit)
        ↓
EVIDENCE AGGREGATION     product identity + conflict detection
        ↓
ALLERGY SAFETY ENGINE    pure function, no I/O, no React
        ↓
UI                       renders a decision it did not make
```

Hard boundaries, all enforced by the module layout:

* React components contain **no** allergy logic — `ResultScreen` only renders
  what `presentAssessment` maps from a domain assessment.
* External API shapes never leave the provider folder; the rest of the app sees
  `ProductEvidence` only.
* The safety engine performs **no** network access and imports nothing from
  React or the services layer.
* Providers never decide the final UI state; they return evidence + diagnostics.

### Directory structure

```
src/
  app/              composition root, App shell, scan flow state machine
  config/           appConfig — the only reader of import.meta.env
  domain/
    allergy/        AllergenCode, matchers, assessment types, THE SAFETY ENGINE
    errors/         AppError model (code + technical message + Hebrew message)
    product/        ProductEvidence, ProductIdentity, SourceConflict
  features/
    scanner/        camera hook, BarcodeDetector/ZXing readers, ScannerPanel
    manual-barcode/ manual entry fallback
    product-result/ result screen, Hebrew wording, source transparency
    debug/          development-only inspector
  infrastructure/
    http/           fetch + timeout + retry + Zod validation, never throws
    logging/        correlation-id logger with a ring buffer
    cache/          short-TTL evidence cache (localStorage)
  services/
    product-data/
      providers/
        openFoodFacts/   ACTIVE
        gs1Israel/       prepared, disabled
        israelRetail/    prepared, disabled
      providerRegistry.ts
      createProviderRegistry.ts
      evidenceAggregator.ts
      productLookupService.ts
  testing/          shared test fixtures
  utils/            barcode normalization + GS1 check digit
scripts/            check:barcode dev tool
```

### Scanner architecture

`useBarcodeScanner` is an explicit state machine:
`idle → requesting_camera → scanning → barcode_detected` (or `error`).

* Prefers the native **BarcodeDetector** API; falls back to **ZXing**, which is
  lazily imported so browsers with native support never download it (~450 kB).
* Formats: EAN-13, EAN-8, UPC-A, UPC-E.
* A **scan lock** stops emission after the first hit, plus a per-barcode
  **cooldown** (`VITE_SCAN_COOLDOWN_MS`, default 3 s).
* Every decoded value must pass the **GS1 mod-10 check digit** before lookup —
  a misread barcode could otherwise show a different product's allergens.
* Camera tracks are stopped on unmount, on stop, and on detection.

### Provider architecture

Every source implements `ProductDataProvider`:

```ts
interface ProductDataProvider {
  id: string; name: string; enabled: boolean;
  sourceType: SourceType; reliability: SourceReliability;
  providesAllergenEvidence: boolean;   // false = identity-only, can never clear
  identityPriority: number;            // separate from…
  allergenEvidencePriority: number;    // …allergen trust
  lookupByBarcode(barcode, context): Promise<ProductSourceResult>;
}
```

Identity trust and allergen trust are deliberately **separate**: a retail
dataset can be the best source of a Hebrew product name while being useless for
allergen clearance.

`ProviderRegistry` is the only place that knows which providers exist;
`createProviderRegistry` is the only place that constructs them.

### ProductLookupService

1. normalize + validate the barcode (reject → ORANGE, no network call),
2. query **all** enabled providers **in parallel** (never "first success wins"),
3. read/refresh the short-TTL evidence cache,
4. normalize every result into `ProductEvidence`,
5. aggregate identity and detect conflicts,
6. run the pure safety engine,
7. return `{ requestId, barcode, product, assessment, evidence, providerResults, conflicts, generatedAt }`.

A provider that throws is caught and degraded to an error record — it can never
remove information from the decision.

### Active provider: Open Food Facts

Documented public read API, no credentials:

```
GET https://world.openfoodfacts.org/api/v2/product/{barcode}.json?fields=…
```

Fields used: `product_name`, `product_name_he`, `brands`, `quantity`,
`ingredients_text`, `ingredients_text_he`, `allergens`, `allergens_tags`,
`traces`, `traces_tags`, `image_front_url`, `last_modified_t`, `states_tags`.

It is **crowdsourced**: `sourceType: 'crowdsourced'`, `reliability: 'medium'`,
shown to the user as "מאגר קהילתי / אמינות בינונית". It is never described as
manufacturer-authoritative, and no confidence percentages are invented.

Real-world quirk handled: OFF tags are not always canonical — Israeli products
return values such as `en:בוטנים` (Hebrew text behind an `en:` prefix). The
matcher normalizes language prefixes and matches Hebrew, English and scientific
spellings (`arachis hypogaea`, `arachide`, …).

### Allergy engine

`src/domain/allergy/assessAllergenRisk.ts` — pure, deterministic, allergen-generic.

Priority order:

1. structured **contains** peanut → RED
2. structured **may contain**/traces peanut → RED
3. peanut mentioned in ingredients/warning text (not a "free from" claim) → RED
4. conflicting evidence → the more conservative outcome
5. missing allergen data → ORANGE
6. missing "may contain" data → ORANGE
7. reliability below threshold → ORANGE
8. complete, clean, unconflicted data → GREEN

Spelling variants live in `allergenMatchers.ts`, separate from the engine, so
adding an allergen means adding a matcher definition — `AllergenCode` already
covers tree nuts, milk, egg, sesame, soy, fish, shellfish and gluten. Only the
peanut matcher is wired up; the MVP UI is peanut-only by design.

Negation handling is deliberately narrow: "ללא בוטנים" / "peanut free" are not
treated as indications, but a re-assertion between the negation and the hit
("ללא גלוטן. מכיל בוטנים") keeps the match.

### Error handling

`AppError` carries `code`, a developer-facing `technicalMessage`, a Hebrew
`userMessage`, an optional `providerId`, and a `cause` that is logged but never
rendered. Users never see stack traces. Every provider failure degrades to
ORANGE.

### Logging & debug mode

`Logger` tags every line `[STAGE][requestId][providerId]`, so one scan is fully
reconstructable from the console:

```
[SCAN][abc123] barcode detected              { barcode: '7290000066318', format: 'EAN_13' }
[LOOKUP][abc123] lookup started              { enabledProviders: ['open-food-facts'] }
[PROVIDER][abc123][open-food-facts] lookup started
[PROVIDER][abc123][open-food-facts] product found
[PROVIDER][abc123][open-food-facts] allergen fields  { allergensStatus: 'reported', tracesStatus: 'empty' }
[ASSESSMENT][abc123] status: insufficient_data { reasonCode: 'MAY_CONTAIN_DATA_MISSING' }
```

The **debug panel** (request id, provider table, HTTP status, timings, fields
present/missing, evidence, conflicts, decision + reason, log tail) is imported
behind `import.meta.env.DEV`, so it is dropped from production bundles entirely —
verified by grepping `dist/`.

### Caching

A short-TTL (`10 min`) `localStorage` cache of **normalized evidence only**.
The safety engine re-runs on every scan, so a cached green decision can never be
replayed. Errors, timeouts and not-found results are never cached. Expired,
corrupt or barcode-mismatched entries are discarded and re-fetched. No database.

### PWA

`public/manifest.webmanifest` plus a network-first app-shell service worker
registered in production only. The worker **never** caches cross-origin provider
responses, so allergen data is never served stale.

---

## Tests

```bash
npm test     # 112 tests, no network access
```

Coverage focuses on what can hurt a child:

* **Safety engine** — every RED trigger (Hebrew, English, scientific spellings,
  structured and free-text), every ORANGE trigger, the narrow GREEN path.
* **The critical invariant** — a parameterized sweep proving no combination of
  missing/empty/undefined/failed/identity-only evidence can produce GREEN,
  individually or all at once.
* **Provider** — mocked HTTP: success, Hebrew and English content, not found,
  HTTP 404/500, invalid JSON, schema mismatch, empty body, timeout, network
  error, barcode mismatch, missing allergens, missing traces, diagnostics.
* **Lookup service** — all providers queried, disabled providers skipped,
  RED preserved against a silent source, identity conflict → ORANGE, a throwing
  provider → ORANGE, identity-only → never GREEN.
* **Aggregator, matchers, HTTP layer, cache, barcode validation.**

Unit tests never touch the live API. For real-world checks use the dev tool:

```bash
npm run check:barcode -- 7290000066318 7290004131074 0000000000000
```

It prints the barcode, whether the product was found, name, provider, whether
ingredients/allergens/traces were available, the raw relevant fields, the
normalized evidence, conflicts, and the final assessment with its reason.

---

## Adding a New Product Data Provider

No React component needs to change.

1. **Implement `ProductDataProvider`** in
   `src/services/product-data/providers/<yourProvider>/`.
2. **Validate the response at runtime** with a Zod schema — never trust external
   JSON (`fetchJson` takes the schema and fails closed).
3. **Normalize into `ProductEvidence`.** The important part: map absent fields to
   `allergenDataStatus`/`mayContainDataStatus` of `missing`, a blank field to
   `empty`, and only actively-reported data to `reported`. Never turn a missing
   array into "no allergens". If the source has no allergen data at all, set
   `providesAllergenEvidence: false` and status `not_supported`.
4. **Choose metadata honestly**: `sourceType`, `reliability`, and the two
   priorities (`identityPriority`, `allergenEvidencePriority`).
5. **Register it** in `createProviderRegistry.ts` and add its flag to
   `appConfig.ts` + `.env.example`.
6. **Add tests** with mocked HTTP, including at least: success, not found,
   timeout, malformed response, and missing allergen fields.

If the provider needs a secret credential, it must be fronted by a backend
proxy — anything in this repo ships to the browser.

---

## Known limitations

* **Coverage.** Open Food Facts is crowdsourced; many Israeli products are
  missing or have incomplete allergen records. Expect ORANGE frequently. That is
  the honest answer, not a bug.
* **Green is rare by design.** Because an empty `traces` field is treated as
  unknown, products whose traces field was never filled in return ORANGE even
  when they list allergens.
* **Only one live source.** With a single provider, cross-source verification
  is not yet possible; conflict detection exists but rarely triggers.
* **Crowdsourced data can be wrong or outdated.** `last_modified_t` is shown so
  staff can judge freshness. The package label remains authoritative.
* **The camera needs HTTPS or localhost**, and older browsers fall back to
  ZXing, which is slower on low-end phones. Manual entry always works.
* **The tool checks peanuts only.** Other allergens are modeled but not surfaced.

## Roadmap

### Future: package photo / Vision (OCR)

`src/services/package-analysis/packageAnalysisProvider.ts` defines the interface.

```
photo of the ingredients/allergen panel → Vision/OCR → structured allergen evidence
```

**CRITICAL RULE, already encoded in the type:** vision evidence may escalate a
product to RED, but must never independently create GREEN. "No peanut detected
by AI" is not evidence of absence — a `package_scan` source must report
`mayContainDataStatus: 'empty'` unless it actually read a full allergen panel.

### Future: GS1 Israel integration

`Gs1IsraelProvider` is a prepared, disabled skeleton with **no invented
endpoint**. Still required: official API/feed documentation, credentials (plus a
backend proxy to hold them), and confirmation of which allergen fields the feed
carries. Expected as `sourceType: 'gs1'`, `reliability: 'high'`, with a higher
identity and allergen priority than Open Food Facts.

### Future: Israeli retail product source

`IsraelRetailProvider` is a prepared, disabled skeleton. Israel's
price-transparency data is excellent for **product identity** in Hebrew but
carries **no allergen information**, so it is permanently marked
`providesAllergenEvidence: false` — it can improve the displayed product name
and never clear a product. Implementing it properly means a backend ingestion
job over per-chain published files, not a browser fetch.
