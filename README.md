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
| **ORANGE** | ⚠️ | אין מספיק מידע — חייבים לבדוק | Do **not** assume it is safe. Offers **📷 צלם את סימון האלרגנים** as the primary next step. |
| **GREEN** | ✅ | לא נמצא סימון לבוטנים במידע הזמין | No indication found — still verify the label. |

ORANGE is a statement about data coverage, not an application error, and it is
never a dead end: see [Package photo analysis](#package-photo-analysis-active).

## The flow

Three ways in, all visible on Home without scrolling — barcode scanning is the
primary path, and the package photo is a **first-class entry point**, not an
ORANGE fallback. A user abroad, or holding a product no database has heard of,
can go straight to the camera.

```
OPEN APP
   ↓
SCAN BARCODE  ·  TYPE BARCODE  ·  PHOTOGRAPH THE PACK
   ↓                                      ↓
   ↓                          (no barcode: straight to analysis)
   ↓
CONFIRM       "האם זה המוצר שסרקת?"   ← barcode ↔ package, nothing more
   ↓                └─ "לא" → lookup discarded, scanner reopens
RESULT        identity + verdict + one action, in the first viewport
   ↓
if ORANGE:  📷 photo → analysis starts automatically
   ↓
RED or ORANGE   (never GREEN from a photo)
   ↓
if the label could not be read: retake, with specific guidance
```

### Why confirmation exists

A scanner can misread a digit, and on a packed shelf it can pick up the
neighbouring box. Showing an allergen verdict for the wrong product is the
worst thing this app could do, so the user sees the product image, name, brand
and barcode and answers one question before any verdict appears.

**Confirming approves the BARCODE ↔ PACKAGE match and nothing else.** It is not
an approval that the product is safe, it never influences the verdict (which is
already computed), and it is not persisted anywhere — no login, no database,
component state for this session only. Answering "לא" discards the lookup
entirely, because allergen data for the wrong product is worse than none.

### Results-first layout

The target user is kindergarten staff, often holding a child. Every result
screen answers three questions, top to bottom, once each:

1. **what product am I checking?** — image, name, brand. The 13-digit barcode is
   deliberately quiet; it is a machine identifier that was competing with the
   product name while helping nobody read it.
2. **what did we conclude?** — the verdict.
3. **what do I do now?** — one action.

Provider names, reliability grades, timestamps, missing fields, evidence and
conflicts live inside a collapsed `פרטי הבדיקה והמקורות`. Nothing was removed —
it is one tap away — it simply stopped competing with the answer.

### The three states are not one component in three colours

This is the most important rule in the interface. Visual intensity follows
meaning, not the amount of data we happen to hold:

| State | Meaning | Treatment |
| --- | --- | --- |
| **RED** | a real, known risk | loud on purpose: full danger block, large mark, the reason spelled out and the package wording quoted verbatim |
| **ORANGE** | we do not know enough yet | a compact status line. No panel, no border, no drama — it is a step in a process, and the screen's weight belongs to the action that follows it |
| **GREEN** | no indication found | calm and positive, with the "this is not a safety claim" caveat kept small rather than shouted |

Making ORANGE look like RED taught users to ignore both. On a 390×844 phone the
whole ORANGE interaction — product, status, instruction, camera button — lands
inside the first ~520px, with no scrolling.

### No bottom navigation

Deliberately. Every primary action already lives on Home, one tap away, and the
app has exactly one task: *can I use this product?* A tab bar would have added a
permanent strip of chrome to duplicate visible buttons, on the same screens
where vertical space decides whether the verdict is visible without scrolling.

### Brand

The supplied logo lives in `public/` and is loaded by URL, so replacing the file
needs no code change: `logo.png` is the full lockup (Home only), `logo-mark.png`
the shield alone (compact headers, favicon), and `icon-192/512.png` the PWA
icons. All are the supplied artwork — trimmed, cropped and resized, never
redrawn. `BrandMark` falls back to a neutral shield if a file is missing, since
a wrong logo is worse than no logo. Although the shield contains a peanut, the
surrounding UI stays allergen-agnostic so the product can add allergens without
a rebrand.

### Design tokens

`src/ui/tokens.css` holds every colour, space, radius, shadow and type step. If
a value is not there it should not appear in a component. Colour is semantic:
`--danger` means "a real, known allergen risk", never "an error"; `--warn` means
"we do not know enough yet", which is actionable rather than alarming.

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
    package/        PackageEvidence + the bridge that keeps Vision from clearing
    product/        ProductEvidence, ProductIdentity, SourceConflict
  features/
    scanner/        camera hook, BarcodeDetector/ZXing readers, ScannerPanel
    manual-barcode/ manual entry fallback
    package-scan/   camera/gallery capture, auto-analysis, retake guidance
    product-confirm/ "is this the product you scanned?" step
    product-result/ result screen, Hebrew wording, source transparency
    debug/          development-only inspector
  infrastructure/
    http/           fetch + timeout + retry + Zod validation, never throws
    logging/        correlation-id logger with a ring buffer
    cache/          short-TTL evidence cache (localStorage)
  services/
    package-analysis/
      packageAnalysisProvider.ts   the OCR/Vision provider contract
      packageTextAnalysis.ts       pure text -> PackageEvidence rules
      tesseractOcrProvider.ts      ACTIVE, browser-only, no API key
      remoteVisionProvider.ts      prepared, disabled, proxy-only
      imagePreparation.ts          resize + greyscale + contrast + focus score
      packageScanService.ts        orchestration + PACKAGE_SCAN logging
    product-data/
      providers/
        openFoodFacts/   ACTIVE
        fatSecret/       prepared, disabled (Premier + OAuth proxy)
        gs1Israel/       prepared, disabled
        israelRetail/    prepared, disabled
      providerRegistry.ts
      createProviderRegistry.ts
      evidenceAggregator.ts
      productLookupService.ts
  testing/          shared test fixtures
  utils/            barcode normalization + GS1 check digit
docs/               research notes
scripts/            check:barcode + benchmark dev tools
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
[PRODUCT][abc123] lookup completed, awaiting confirmation { productName: '…' }
[CONFIRM][abc123] user confirmed the product
[PROVIDER][abc123][open-food-facts] lookup started
[PROVIDER][abc123][open-food-facts] product found
[PROVIDER][abc123][open-food-facts] allergen fields  { allergensStatus: 'reported', tracesStatus: 'empty' }
[ASSESSMENT][abc123] status: insufficient_data { reasonCode: 'MAY_CONTAIN_DATA_MISSING' }
```

A package photo continues the same correlation id — see
[Developer logging](#developer-logging) under package photo analysis.

The **debug panel** (request id, provider table, HTTP status, timings, fields
present/missing, package scans with recognized text and before/after status,
evidence, conflicts, decision + reason, log tail) is imported
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
npm test     # 261 tests, no network access
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
* **Package photo analysis** — every mandated escalation phrase in Hebrew and
  English, precautionary vs. contains classification, front-of-pack product
  names, OCR error tolerance, and the "free from" cases that must NOT escalate.
* **The Vision invariant** — a photo can never produce GREEN, asserted both
  against the real safety engine and against the literals in the bridge source.
* **Merging** — every combination of barcode verdict × photo finding
  (ORANGE+peanut → RED, ORANGE+nothing → ORANGE, GREEN+peanut → RED,
  RED+nothing → RED, and a later empty photo never cancelling an earlier find).
* **Scan session** — jsdom + Testing Library over `useProductScan`: the verdict
  is withheld until confirmation, rejection discards the lookup, a photo starts
  analysis by itself, a bad photo asks for a retake, a good one does not, a
  failed analysis leaves the verdict untouched, and photo state resets between
  products.
* **Quality gate** — every POOR and PARTIAL trigger, plus the contract that it
  never suppresses a peanut finding.
* **Focus scoring** — sharp vs. blurred vs. featureless buffers, and the
  fail-safe that an unmeasurable image is never called sharp.
* **Provider escalation** — stops on explicit danger, stops on a good empty
  read, escalates only on a poor/partial read, survives a broken provider, and
  reports an error rather than empty evidence when all of them fail.
* **Remote Vision** — disabled without a proxy, sends no credential, runs proxy
  text through the same rules, and cannot clear a product whatever it returns.
* **Presentation** — Home offers all three check methods and no history
  destination; ORANGE shows the photo CTA outside any disclosure and states the
  missing-data fact exactly once; RED leads with danger, reason and instruction
  and offers no further photo; GREEN never says "safe" and keeps its caveat;
  technical detail stays collapsed but present; retake and processing states
  render without diagnostics; confirmation asks about identity only and never
  leaks the verdict. Behaviour, not CSS values.
* **Aggregator, matchers, HTTP layer, cache, barcode validation.**

Unit tests never touch the live API. For real-world checks use the dev tool:

```bash
npm run check:barcode -- 7290000066318 7290004131074 0000000000000

# The real-world regression set from field testing in Israel:
npm run check:barcode -- 7290000446547 037600309417 7290000074184
```

Expected today (September 2026):

| Barcode | Product | Barcode-only result |
| --- | --- | --- |
| `7290000446547` | B&D natural peanut butter | RED — `CONTAINS_DECLARED` |
| `037600309417` | Skippy peanut butter | RED — `CONTAINS_DECLARED` |
| `7290000074184` | Osem Petit Beurre | ORANGE — `ALLERGEN_DATA_MISSING` |

The Skippy case used to be ORANGE: Open Food Facts stores 12-digit UPC-A codes
zero-padded to 13 digits, and the provider's barcode-echo guard read that as a
different product. `isSameBarcode` now compares GTINs, not strings.

The Osem case is genuine missing data and stays ORANGE — that is the case the
package photo exists for. To exercise it by hand, scan `7290000074184`, tap
**צלם את סימון האלרגנים**, and photograph a label; the debug panel shows the
recognized text, the detected terms and the before/after status.

It prints the barcode, whether the product was found, name, provider, whether
ingredients/allergens/traces were available, the raw relevant fields, the
normalized evidence, conflicts, and the final assessment with its reason.

---

## Data providers

Researched September 2026 — see [`docs/research-2026-09.md`](docs/research-2026-09.md)
for the measurements and the full reasoning.

| Provider | State | Why |
| --- | --- | --- |
| **Open Food Facts** | **ACTIVE** | The only source that answers with no credential. Good Israeli identity coverage (Hebrew names, images); allergen coverage is roughly a coin flip. |
| FatSecret Platform | adapter prepared, **disabled** | Barcode lookup is Premier-only, allergen access is granted separately again, and OAuth secrets cannot ship in a static build. |
| Edamam Food Database | **rejected**, no adapter | Keys travel as query parameters (published by a browser build), and its ~700k UPC catalogue is US/UK-centric with no documented Israeli coverage. |
| GS1 Israel | skeleton, **disabled** | No free, publicly documented API exists. The skeleton deliberately contains no URL. |
| Israeli retail transparency | skeleton, **disabled** | Excellent Hebrew identity, **zero** allergen data. Permanently `providesAllergenEvidence: false`. |
| Manufacturer pages / web search | **not built** | Fragile HTML with no GTIN in the markup; would need a backend. Recorded as a RED-only future source: it could escalate, never clear. |

**No second provider was enabled**, because none offers accessible allergen
coverage for Israeli products today. Adding one to raise the provider count
would be theatre. The measured coverage gap is real, and the package photo is
the answer to it.

### The benchmark

```bash
npm run benchmark                       # the field-testing regression set
npm run benchmark -- 7290000066318      # or any barcodes you like
```

Prints, per provider per barcode: found, name, brand, image, ingredients,
allergen status, traces status, peanut signal (and which field it came from),
reliability, last updated, duration and errors — then a summary table and the
final verdict. It **never fabricates a result**: a provider without credentials
reports `not-implemented` and is listed as such, because that is a finding.

Measured on 2026-09-04:

| Barcode | Product | Identity | Allergens | Verdict |
| --- | --- | --- | --- | --- |
| `7290000446547` | B&D peanut butter | ✅ | `en:peanuts` | **RED** |
| `037600309417` | Skippy peanut butter | ✅ | `en:peanuts` | **RED** |
| `7290000074184` | Osem Petit Beurre | ✅ | — | ORANGE |
| `7290105693341` | Bamba | ✅ | — | ORANGE |

Bamba is the uncomfortable one: a ~50% peanut snack, the most likely thing a
kindergarten actually has on the shelf, and the database holds a name and
nothing else. It is correctly ORANGE rather than GREEN — but no database tuning
fixes it, which is precisely why the photo path is the primary ORANGE action.

### Optional serverless proxies (none deployed)

**No serverless infrastructure was added.** Everything ships as static files.
Two future features would each need one minimal, stateless function — no
database, no auth, no session:

```
FatSecret       GET  <proxy>/fatsecret/barcode/:gtin13
                holds FATSECRET_CLIENT_ID / FATSECRET_CLIENT_SECRET

Remote Vision   POST <proxy>
                { "image": "<base64>", "mimeType": "image/png" }
                → { "text": "<verbatim label text>" }
                holds the model API key
```

The Vision proxy must return **text only** — never a verdict, never a boolean.
Remote text runs through the same `analyzePackageText` rules as local OCR, so a
remote model cannot invent a decision path of its own. Set
`VITE_*_PROXY_URL` to the proxy origin; a key must never appear in any `VITE_*`
variable, because everything prefixed `VITE_` is bundled into the browser.

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

## Package photo analysis (ACTIVE)

When the databases cannot answer, the package itself can. ORANGE is no longer a
dead end: it offers **📷 צלם את סימון האלרגנים**.

```
barcode → providers → assessment
   RED   → shown as RED, nothing more to ask
   GREEN → shown as GREEN, photo offered as an optional double-check
   ORANGE→ photo capture offered as the primary action
              ↓
      photo → quality gate → OCR → PackageEvidence → re-assessed together
              ↓                          with the barcode evidence
      explicit peanut wording → RED
      good read, nothing found → still ORANGE
      poor / partial read      → still ORANGE + ask for a retake
```

Choosing a photo starts the analysis **immediately**. There is no second
"analyze" tap: the extra click bought nothing, and every tap between a worried
adult and an answer is a tap too many.

### The quality gate — knowing when we did NOT read the label

Field testing showed the real problem was not OCR accuracy. It was that a
*failed* read looks exactly like a *successful* read that found nothing. Both
produce an empty result, and only one of them means anything.

So every photo gets a pragmatic `good` / `partial` / `poor` verdict, from
signals that are cheap because the pixels are already in hand:

| Signal | Where it comes from |
| --- | --- |
| Focus (variance of the Laplacian) | the greyscale buffer, during preprocessing |
| Resolution | the decoded image |
| OCR confidence | Tesseract |
| Readable character count | recognized text |
| Meaningful line count | an allergen panel is several lines; one stray line is not |
| Text coverage of the frame | Tesseract block bounding boxes — catches "photographed the front of the box" |

**The gate governs how we describe a photo, never whether danger counts.** A
blurry, tiny, low-confidence photo that still reads `PEANUT` is RED. The gate
only decides how loudly the app says *finding nothing here proves nothing*, and
whether to ask for another photo. That contract is asserted by a test.

`poor` and `partial` both keep the result ORANGE and ask for a retake with
specific guidance — מקרוב · ישר מול האריזה · באור טוב · ללא השתקפות · כל אזור
הרכיבים בתמונה — rather than reporting an error the user cannot act on. A
retake is never requested when the photo already found peanuts: there is
nothing left to look for.

### THE VISION SAFETY RULE

**A photo may escalate to RED. A photo may NEVER create GREEN.**

This is structural, not a convention someone has to remember.
`domain/package/packageEvidence.ts` holds the only bridge from image analysis
into the safety engine, and it hard-codes

```ts
allergenDataStatus:   'empty',
mayContainDataStatus: 'empty',
```

as literals with no parameter and no caller able to change them. The engine
treats `'empty'` as *unknown*, so a `package_scan` source can never reach the
clearing branch of `assessAllergenRisk` — while positive findings still land in
`containsAllergens` / `mayContainAllergens` / `ingredientsText`, all of which the
engine reads as danger. `packageEvidence.test.ts` asserts both the behaviour and
the literals in the source text.

Consequences, all covered by tests:

| Situation | Result |
| --- | --- |
| Photo reads `מכיל בוטנים` / `Peanut Butter` / `arachis hypogaea` | RED |
| Photo reads `עלול להכיל בוטנים` / `may contain peanuts` | RED |
| Photo reads nothing / is blurry / analysis crashes | unchanged (ORANGE stays ORANGE) + retake asked |
| Photo is only a partial read | unchanged + retake asked |
| Remote Vision fails or is unreachable | unchanged |
| Photo reads `ללא בוטנים` | unchanged — a photographed claim is not a verified record |
| Barcode was GREEN, photo finds peanuts | RED, with a conflict flag |
| Barcode was RED, photo finds nothing | RED |
| A second, emptier photo after a peanut finding | still RED — findings are appended, never replaced |

### Why browser-side OCR and not a cloud Vision API

Options evaluated for a static GitHub Pages app:

| Option | Hebrew | Key needed | Backend | Verdict |
| --- | --- | --- | --- | --- |
| **Tesseract.js (WASM)** | ~92-96% on clean print | none | none | **chosen** |
| Gemini / OpenAI Vision | excellent | yes | yes — a secret cannot ship in a Vite bundle | rejected for the MVP |
| Cloud OCR (Google/Azure) | very good | yes | yes | rejected for the MVP |
| `TextDetector` (Shape Detection API) | n/a | none | none | rejected: effectively unshipped |

The deciding argument is the shape of the task. This is **keyword detection on a
label**, not document understanding: the app must recognize a handful of peanut
spellings. Tesseract is good enough for that, and the failure mode is aligned
with the safety model — every OCR miss degrades to ORANGE ("check the package"),
never to a false GREEN. A paid API would buy accuracy that mostly converts
ORANGE into ORANGE, at the cost of a serverless proxy, a billable key, and
sending photos of a customer's shopping to a third party.

**No backend or serverless proxy was introduced.** The photo never leaves the
device. Nothing in `appConfig` holds a credential, and nothing may.

### Preprocessing — benchmarked, not assumed

Resize to a 1600px long edge, greyscale, conservative contrast stretch. Tried
and **rejected**: self-binarisation, hard sharpening, and upscaling small
images — all three lost accuracy against Tesseract's own adaptive
thresholding. Over-processing makes OCR worse, so the pipeline stops early on
purpose. See [`docs/research-2026-09.md`](docs/research-2026-09.md).

Engine assets (WASM core ~4 MB, `heb` ~0.6 MB, `eng` ~3 MB) come from the
jsDelivr CDN **on first use only** and are cached by Tesseract.js in IndexedDB.
The library is behind a dynamic `import()`, so a user who never photographs a
package downloads none of it — the main bundle is unchanged. Point
`VITE_PACKAGE_SCAN_CORE_PATH` / `VITE_PACKAGE_SCAN_LANG_PATH` at a self-hosted
mirror if the CDN is unacceptable.

### How the text is interpreted

`packageTextAnalysis.ts` is a pure function, so every provider gets identical
rules. It analyzes **one label segment at a time** rather than the whole blob: a
label reading `ללא גלוטן. מכיל בוטנים.` must not have its `ללא` attached to the
wrong allergen. Findings are then written into declaration lists, which the
engine matches without negation, so a finding cannot be lost downstream.

Three matching passes, in order:

1. **Strict** — the shared `PEANUT_MATCHER`, with its own negation handling.
2. **Latin look-alike correction** — `PEANU7 8UTTER` → `peanut butter`.
3. **Distance-1 fuzzy** — `בוטנימ` → `בוטנים`, English `peanut(s)`.

Passes 2 and 3 never run inside a segment that declares the allergen's absence,
so a misread `ללא בוטנים` cannot become a warning. Any finding that needed
correction is flagged `viaOcrCorrection` and labelled as such in the UI.

Image quality (`good` / `partial` / `poor`) is derived from recognized text
length and OCR confidence. It **only** changes how loudly the app says that
finding nothing proves nothing — it never suppresses a finding. A blurry photo
that still reads `PEANUT` is RED.

### Source transparency

A photo-driven result never pretends to be manufacturer data. The result screen
shows the exact text that was read:

```
מקור הסיכון: צילום האריזה
נמצא בצילום האריזה: "מכיל: בוטנים, סויה."
מקור: צילום האריזה   שיטת ניתוח: OCR בדפדפן (Tesseract.js)
```

### Adding a Vision provider later

Implement `PackageAnalysisProvider`, route the recognized text through
`analyzePackageText`, and register it in `appServices.ts`. Nothing else changes,
and the safety rule holds automatically because the bridge is the only way in.
If that provider needs a credential it needs a minimal serverless proxy
(Cloudflare Worker / Vercel function) holding the key as an environment secret —
the browser may only ever see a proxy URL.

### Developer logging

Every scan is logged under the `PACKAGE_SCAN` stage with the barcode scan's
correlation id, then the merge under `ASSESSMENT`:

```
[PACKAGE_SCAN][abc123] image selected            { imageBytes, imageType }
[PACKAGE_SCAN][abc123] analysis started          { providerId, analysisMethod }
[PACKAGE_SCAN][abc123] image prepared            { original, prepared }
[PACKAGE_SCAN][abc123] text extracted            { durationMs, extractedTextLength, textConfidence, imageQuality }
[PACKAGE_SCAN][abc123] peanut evidence detected: true { detectedTerms, containsStatements, mayContainStatements }
[ASSESSMENT][abc123]   package scan merged: insufficient_data -> danger { escalated: true }
```

The image itself and the recognized text are **never** logged — only lengths,
matched terms and counts. Full text lives in the development debug panel, which
cannot reach a production bundle.

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
* **Product confirmation depends on the user.** If someone taps "כן" for the
  wrong product the app will report that product's data. The identity card
  shows image, name, brand and barcode precisely so that mistake is visible.
* **OCR is not a reader of intent.** Tesseract reads clean printed labels well
  and struggles with curved foil, low contrast, glare and stylised type. Every
  such failure lands on ORANGE, so it costs a retake, never a wrong clearance.
* **The quality gate is heuristic, not a measurement.** Its thresholds were
  calibrated on greyscale 1600px images of printed labels, and it can call a
  usable photo `partial`. It errs that way on purpose: an extra retake is
  cheap, a confident "we read the label" that is false is not.
* **A perfect read of the wrong panel still reads nothing useful.** Text
  coverage catches the obvious "photographed the front of the box" case, but
  the app cannot tell an ingredients panel from a nutrition table.
* **Product-name matching is a blunt instrument.** A product whose name
  contains a peanut word is RED even if it is peanut-free in fact. That is the
  intended direction of error, but it will occasionally over-warn.
* **Photo analysis needs one CDN fetch.** The first scan on a device downloads
  the engine (~8 MB, then cached in IndexedDB). Offline, the barcode path still
  works and the photo option reports that analysis is unavailable.

## Roadmap

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
