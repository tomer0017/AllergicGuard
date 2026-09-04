# Research note — September 2026

Decisions behind the "data coverage + smart photo analysis" iteration. Written
so the next person can tell what was *measured* from what was *assumed*, and so
a rejected option can be reopened when its blocker goes away.

---

## 1. What field testing actually showed

Four barcodes, scanned on real shelves in Israel, measured against the live
Open Food Facts API on 2026-09-04:

| Barcode | Product | OFF identity | OFF allergens | OFF traces | Verdict |
| --- | --- | --- | --- | --- | --- |
| `7290000446547` | B&D natural peanut butter | ✅ + image | `en:peanuts` | empty | **RED** |
| `037600309417` | Skippy peanut butter | ✅ + image | `en:peanuts` | empty | **RED** |
| `7290000074184` | Osem Petit Beurre | ✅ + image | — | — | **ORANGE** |
| `7290105693341` | Bamba | ✅ + image | — | — | **ORANGE** |

Two findings, one of them uncomfortable:

**Identity coverage is good; allergen coverage is not.** All four products were
identified, with names, brands and images. Only two carried allergen data.

**Bamba is the worst case in the whole app.** It is a ~50% peanut snack, the
single most likely thing a kindergarten actually has on the shelf, and Open Food
Facts holds a name and nothing else — no ingredients, no allergens, no traces.
It is correctly ORANGE rather than GREEN, so the safety model holds, but no
amount of database tuning fixes it. **This is the case the package photo exists
for**, and it is why the photo path was made the primary action on ORANGE
rather than an afterthought.

### The Skippy bug (fixed in the previous iteration, re-verified here)

Skippy was previously reported as "product not found". Open Food Facts had it
all along: it stores 12-digit UPC-A codes zero-padded to EAN-13, and the
provider's barcode-echo guard read `0037600309417` as a different product.
`isSameBarcode` now compares GTINs rather than strings.

---

## 2. Additional data providers

Measured or read from current official documentation. Nothing here is assumed
from older notes.

### Open Food Facts — **ACTIVE**

The only source that answers today with no credential. Good Israeli identity
coverage including Hebrew names and images; allergen coverage is roughly a coin
flip. Crowdsourced, so an empty field means "nobody filled it in" — which is why
the engine refuses to read an empty allergen list as "contains nothing".

### FatSecret Platform — **ADAPTER PREPARED, DISABLED**

Three independent blockers, all verified against
`platform.fatsecret.com/docs/v2/food.find_id_for_barcode`:

1. **Barcode lookup is Premier-only.** `GET /rest/food/barcode/find-by-id/v2` is
   marked "Premier Exclusive". A free account cannot call it, so there is
   nothing to benchmark and nothing to ship.
2. **Allergens are gated separately from Premier.** FatSecret carries 10
   allergens including peanuts, but the docs state allergen/dietary/image access
   is granted separately, and that allergen coverage is complete for *generic*
   foods with branded foods "added over time". Israeli branded products are
   exactly our case and there is no evidence they are covered.
3. **OAuth secrets cannot live in a static build.** Both OAuth 1.0 and 2.0 need
   a client secret; GitHub Pages ships every byte to the browser.

Worth reopening if a Premier subscription with allergen access appears — it is
the only researched source with real `contains` / `does not contain` / *unknown*
semantics. The adapter records that mapping, including the trap: FatSecret's
`-1` means **unknown**, and treating it as "does not contain" is the one mistake
that could turn it into a source of false GREEN.

### Edamam Food Database — **REJECTED, NO ADAPTER**

Supports UPC lookup and carries allergen labels, and has a free developer tier.
Rejected anyway: `app_id` + `app_key` are query parameters, so browser use
publishes them, and its ~700k UPC catalogue is US/UK-centric with no documented
Israeli coverage. Building an adapter we cannot test, for a catalogue unlikely
to contain פתי בר or במבה, would add architecture without adding answers.

### GS1 Israel — **NO PUBLIC API, DOCUMENTED ONLY**

No free, publicly documented barcode/allergen API exists. Access to GS1-sourced
catalogue data is commercial and credential-gated. The existing skeleton
deliberately contains **no URL** — inventing an endpoint would be worse than
having no provider. Unchanged from the previous iteration.

### Israeli retail price-transparency data — **IDENTITY ONLY**

Excellent for Hebrew product identity, carries **no allergen information**, and
needs per-chain credentials plus a backend ingestion job over published files —
not a browser fetch. Permanently `providesAllergenEvidence: false`: it could
improve a displayed name, never clear a product.

### Manufacturer pages / web search — **NOT IN THIS ITERATION**

Osem and other Israeli manufacturers publish product pages with ingredients, but
they are HTML with no stable identifiers and no GTIN in the markup. A scraper
would be a fragile safety-critical dependency, and doing it properly needs a
backend plus a search API. Recorded as a RED-only future source: web evidence
could escalate, never clear. Not built.

**Conclusion: no second provider was enabled.** None offers accessible allergen
coverage for Israeli products today. Adding one to raise the provider count
would be theatre. The coverage gap is real and the photo path is the answer to
it — which is where the effort went instead.

---

## 3. OCR and Vision

### What the field test showed

Tesseract.js reads allergen panels correctly **when the panel fills the frame**.
It fails when the text is small, distant, angled or partly out of shot — and
critically, a failed read looks exactly like a successful read that found
nothing. That ambiguity, not raw accuracy, was the real problem.

### The decision

Keep browser-side Tesseract.js, and spend the effort on **knowing when it
failed** rather than on a stronger model.

| Option | Hebrew | Key | Backend | Verdict |
| --- | --- | --- | --- | --- |
| Tesseract.js alone | ~92-96% on clean print | none | none | insufficient — silent failures |
| **Tesseract.js + quality gate** | same | none | none | **chosen** |
| Gemini / OpenAI Vision | excellent | yes | yes | prepared, disabled |
| Google Cloud Vision OCR | very good | yes | yes | rejected — same blocker, less capable |

A stronger model does not fix a photo of the wrong side of the box, and every
hosted option needs a key that a static build cannot hold. The quality gate
fixes the actual failure mode for zero cost, zero latency and zero privacy
exposure.

### Preprocessing — benchmarked, not assumed

Resize to a 1600px long edge, greyscale, conservative contrast stretch. Tried
and **rejected**: self-binarisation, hard sharpening, and upscaling small
images. All three lost accuracy against Tesseract's own adaptive thresholding.
Over-processing makes OCR worse, so the pipeline stops early on purpose.

Added: variance-of-Laplacian focus scoring on the greyscale buffer that is
already in hand. It costs one pass over pixels we have already touched and
turns "OCR found nothing" into "OCR found nothing **because the photo is
blurred**" — which is a sentence the user can act on.

### Optional remote Vision fallback — prepared, disabled

`RemoteVisionProvider` exists and is off. It would run **only** where local OCR
admits it failed:

```
photo → Tesseract → explicit peanut wording? → RED, stop (no remote call)
                  → good read, nothing found? → ORANGE, stop
                  → poor or partial read?     → remote Vision
```

So the overwhelming majority of photos never leave the device, and the ones that
would are exactly the ones worth paying for. The provider talks to a **proxy
URL**, never to a model vendor, and the proxy contract returns **text only** —
never a verdict, never a boolean. Remote text goes through the same
`analyzePackageText` rules as local OCR, so a remote model cannot invent a
decision path of its own and, like every package source, cannot clear a product.

No proxy is deployed and no credentials exist in this repository. The provider
stays disabled until both are real.

---

## 4. Serverless

**None was added.** Everything ships as static files on GitHub Pages. Two future
features would each need one minimal function (Cloudflare Worker or equivalent),
and both are documented in the README with their exact contract:

- FatSecret — to hold the OAuth secret.
- Remote Vision — to hold the model API key.

Neither is a backend: no database, no auth, no session. A single stateless
handler each.
