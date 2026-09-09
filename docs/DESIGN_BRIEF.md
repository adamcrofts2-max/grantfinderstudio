# Design brief — make it feel like a product, not a document

A prompt for a full visual pass over Grant Finder Studio. Written after a
screen-by-screen audit of the running app on 8 September 2026.

Use it as the whole instruction for a session. Everything below is either a
measured observation of the current code or a decision with its reason
attached — argue with the reasons, not the taste.

---

## 1. What is actually wrong

The product is honest, well-written and **visually inert**. Measured, not
felt:

- **478 lines of CSS contain zero `transition`, zero `@keyframes`, zero
  `animation`.** Nothing in the entire product acknowledges a click, a load, a
  save or a state change. A button press and a page render look identical.
- **Zero `<svg>` and zero charts across eleven screens.** Every quantity in the
  product — award medians and quartiles, hours of effort, days remaining,
  questions answered, unsupported claims, grant counts — is rendered as a
  sentence.
- **Every screen has the same rhythm**: a page header, then a vertical stack of
  identical white cards. Opportunities, tracker, funders, documents and
  applications are visually indistinguishable at a glance.
- **The colour system is barely used.** Four semantic pairs are defined and
  appear almost exclusively in small pill badges. The canvas is one flat
  off-white.
- **Buttons carry no hierarchy of consequence.** "Draft from my facts" (an AI
  call that costs money) and "Remove" (destructive) are the same size and
  weight as everything else.
- **Empty states are apologetic paragraphs.** There is no first-run moment
  anywhere that feels like the beginning of something.
- **No sense of progress.** An application that is 1 of 8 questions answered
  and one that is 7 of 8 look the same until you read the text.

What is genuinely good and must survive: the writing, the token system, the
dark mode, the mobile behaviour, and the refusal to invent numbers.

---

## 2. The direction — and one word I would change

"Playful" is the wrong target, and chasing it would damage the product.

Someone opens this to decide whether to spend twenty evenings on an
application that might fund their youth programme. The feeling to design for is
**confident, alive and momentum-giving** — not jolly. No mascots, no confetti,
no illustrations of people pointing at graphs.

Where genuine delight belongs, in order of value:

1. **Responsiveness.** Everything acknowledges you instantly. This alone will
   do more than any illustration.
2. **Making the numbers visible.** The product already knows more than it
   shows. A chart that reveals "your £30,000 sits right inside what this funder
   actually gives" is more exciting than any decoration, because it is *news*.
3. **Momentum.** Progress that can be seen accumulating: facts confirmed,
   questions answered, a deadline moving from red to green.
4. **Moments that land.** Submitting an application should feel like something
   happened. One well-judged moment, not fifty.

Reference points: Linear's density and speed, Stripe's clarity with data,
Monzo's warmth in copy. Not: a marketing site, a dashboard template, or
anything with a hero gradient.

---

## 3. Hard constraints — breaking these fails the work

1. **Never manufacture certainty the product refuses to claim.** This is the
   whole architecture. Specifically forbidden, permanently:
   - any pie, donut, gauge or ring showing "eligibility", "fit" or "match"
   - any percentage that could be read as a likelihood of being funded
   - any single composite score across signals the product deliberately keeps
     separate (see `PRODUCT_ARCHITECTURE.md` — three honest signals, never one
     number)
   - readiness rendered as one ring; it is completeness across named
     components and must stay componentised
2. **Colour is never the only carrier of meaning.** Every state keeps its word
   and its mark. The product must survive greyscale.
3. **WCAG 2.2 AA holds.** Contrast, focus visibility, hit targets, motion
   respecting `prefers-reduced-motion`.
4. **Mobile stays fixed.** Form controls ≥16px at ≤820px (iOS zoom), no
   horizontal overflow at 390px, media queries stay last in the cascade.
5. **Dark mode is designed, not flipped.** Every new colour gets a chosen dark
   value.
6. **Tokens only.** No ad-hoc hex, no ad-hoc spacing. Extend
   `src/app/globals.css`; do not add a component library.
7. **All 828 tests stay green**, and `npm run lint`, `tsc -b`, `npm run build`
   stay clean.

---

## 4. The visual system to build

### Motion — the single highest-value change
Add a motion scale to tokens and use it everywhere:

```
--motion-fast: 120ms;   /* hover, focus, colour */
--motion-base: 200ms;   /* enter, expand, reveal */
--motion-slow: 320ms;   /* page-level, celebratory */
--ease: cubic-bezier(0.2, 0, 0, 1);   /* decelerate — arrives, never bounces */
```

- Every interactive surface transitions background, border and shadow.
- Cards lift on hover (`--shadow-sm` → `--shadow-md`, 1px translate).
- Submitted forms show progress in the button itself, not only as text.
- Charts draw in once on mount (bars grow from the baseline, ~400ms, staggered
  30ms) and never re-animate on re-render.
- **Wrap all of it in `@media (prefers-reduced-motion: reduce)`** and reduce to
  opacity only.

### Depth and surface
Three levels, currently one: `--canvas` → `--surface` (cards) →
`--surface-raised` (hover, popovers). Introduce a subtle canvas texture or a
very soft gradient on the canvas only — never on cards.

### Type
The scale tops at `--t-2xl` (30px), which is small for a page title and gives
every screen the same voice. Add `--t-3xl: 2.5rem` and `--t-4xl: 3.25rem` for
hero numbers and first-run moments. Tighten tracking on large sizes.

### Buttons — hierarchy by consequence
Four levels, visually distinct:
- **Primary** — the one action this screen exists for. One per screen.
- **Secondary** — supporting.
- **Quiet** — tertiary, text-weight.
- **Destructive** — remove, reject. Never the same weight as primary.

Actions that spend money or call a model (drafting, reviewing, reading a
document) say so in the button and show elapsed feedback while running.

### Icons
Adopt one line-icon set (Lucide, tree-shaken — not an icon font). Replace the
current single-character glyphs (`◎ ◷ ✎ ⌂ ❒ ⌕ ⚙ ＋ ◈`), which render
inconsistently across platforms. Icons are always paired with a label in
navigation; icon-only is allowed only where the label is adjacent.

---

## 5. Data visualisation — form first, colour last

Method: `references/choosing-a-form.md` from the dataviz skill. **The job picks
the form; sometimes the answer is a stat tile, not a chart.**

### On pie charts, since they were asked about
Use one only where the data genuinely is **parts of one whole**. In this
product that is true in exactly one place — a budget breakdown, when budgets
ship. Everywhere else the data is a distribution, a position in time, or a
count, and a pie would be the wrong shape and harder to read. Bars, ranges and
timelines carry all of it better. **A pie chart of eligibility would be a
serious error**, not a stylistic choice.

### The charts worth building, in order of value

**1. Funder award distribution — `/funders`. Build this first.**
Job: where does my ask sit against what they actually give?
Form: horizontal range bar — min→max, a quartile box, a median tick, and
**your ask marked on it**. Nothing else in the product turns data into a
decision this directly.

**2. Tracker timeline — `/tracker`.**
Job: position in time. Form: a horizontal track per item running today →
latest-start marker → deadline, coloured by state. This makes the product's
central insight — *the last day you can still start* — visible rather than a
sentence.

**3. Effort composition — `/opportunities/[id]`.**
Job: what makes up this total? Form: a horizontal stacked bar, one labelled
segment per driver. This is the one true parts-of-a-whole in the product today,
and a stacked bar still beats a pie because the labels stay readable and it
compares across opportunities.

**4. Application progress — `/applications`, `/applications/[id]`.**
Job: completion, and *which* parts. Form: a segmented bar, one segment per
question — answered, unanswered, or carrying an unsupported claim. Not a
percentage ring: a ring invites reading as a score.

**5. Stat tiles — top of `/`, `/tracker`, `/organisation`.**
Job: a headline number. Form: a hero number with a one-line label. No plot.
Examples: hours of work outstanding, funds needing attention this week, facts
confirmed.

### Colour for charts
The four semantic colours are **status colours and are reserved** — they must
never become series colours. Verified with the skill's validator:

```
#1c4ed8, #0f6b47, #8a5200, #a01f1f  →  FAILED
  chroma floor: #0f6b47 reads grey
  CVD separation: #a01f1f ↔ #8a5200 ΔE 3.2 (deutan)
  normal vision: ΔE 11.1 — below the 15 floor
```

Use this instead — validated, passes every hard gate in both modes:

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | blue | `#2a78d6` | `#3987e5` |
| 2 | orange | `#eb6834` | `#d95926` |
| 3 | aqua | `#1baf7a` | `#199e70` |
| 4 | yellow | `#eda100` | `#c98500` |

```
light: worst adjacent CVD ΔE 9.1 · normal-vision ΔE 22.9 · ALL CHECKS PASS
dark:  worst adjacent CVD ΔE 8.4 · normal-vision ΔE 19.8 · ALL CHECKS PASS
```

Light mode raises a contrast WARN on aqua and yellow, which **obligates
direct labels** on those marks — not dismissable. Every chart here should carry
direct labels anyway.

Assign slots in fixed order, never cycled. Re-run
`scripts/validate_palette.js` for any change.

### Chart mechanics
Thin marks; 4px rounded data-ends anchored to the baseline; 2px surface gap
between adjacent fills; recessive axes and grid; selective direct labels, never
a number on every point; hover tooltip on every mark; a table view available
for anything a screen reader cannot read from the marks.

---

## 6. Screen by screen

| Screen | The change that matters most |
|---|---|
| `/` opportunities | Stat tiles across the top; each opportunity card gets its three signals as small visual marks, not three paragraphs. Make "worth your time" and "probably not" feel different at a glance. |
| `/funders` | The distribution chart. This screen becomes the most compelling in the product. |
| `/tracker` | Timelines. Turn "Needs you this week" into something that reads in one second. |
| `/applications/[id]` | Progress segmentation, a calmer writing surface, and a review panel that feels like receiving feedback rather than an error list. |
| `/opportunities/[id]` | Effort composition chart; make the eligibility checklist the hero — it is the product's best work and currently looks like a list. |
| `/opportunities/add`, `/documents` | Real drop zones with drag states and read-progress. These are the two "give us something" screens and both are currently a bare input. |
| `/organisation` | Confirming a fact should feel like progress accumulating. Consider a quiet count-up as the confirmed number rises. |
| `/onboarding` | The one screen allowed a genuine first-run moment. Currently the least designed and the most important. |
| `/admin/settings` | Connection states that read instantly: connected, failing, absent. |

---

## 7. Copy and layout

The writing is the strongest thing in the product — **do not rewrite it into
marketing voice**. Specific improvements only:

- Headings currently do the work of both title and explanation. Let the visual
  carry more so the sentence can get shorter.
- Every screen is `page-narrow` (44rem). The funders and tracker screens have
  two-column content and should be allowed to breathe wider.
- Long explanatory paragraphs under headers should become a short line plus a
  disclosure, not disappear — the reasoning is the product's character.
- Empty states get an illustration-free but composed treatment: a large glyph
  or chart skeleton, one sentence, one primary action.

---

## 8. Acceptance

- [ ] A motion scale exists and every interactive surface uses it, wrapped in
      `prefers-reduced-motion`
- [ ] The five chart types above are built as reusable components
- [ ] The validated series palette is in tokens with chosen dark values
- [ ] No forbidden visual exists anywhere (§3.1)
- [ ] Screenshots at 1280px and 390px, light and dark, for all eleven screens
- [ ] No horizontal overflow at 390px; form controls ≥16px
- [ ] `npm run lint`, `tsc -b`, `npm run build` clean; 828 tests green
- [ ] A keyboard-only pass over every new interactive element

---

## 9. What to do if this brief and the architecture disagree

The architecture wins. If a visual would look better by implying a precision
the product does not have, the visual is wrong. The point of this pass is to
make an honest product feel alive — not to make a lively product that is less
honest.
