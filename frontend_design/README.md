# Handoff: Airbase — Operator App + Technician PWA

## Overview

Airbase is an AI-native operating system for home-services companies (plumbing, HVAC, electrical). AI agents book, dispatch, invoice, and follow up; the human **supervises** — approving the few decisions that need a second set of eyes and handling true exceptions. The guiding principle across every screen: **most surfaces are monitoring interfaces, not action interfaces.** A dispatcher should be able to glance at a screen and know everything is fine without doing anything. Action is the exception.

This bundle contains the design system plus five high-fidelity reference screens covering the operator web app (desktop-first) and the technician app (mobile-first PWA).

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior. **They are not production code to copy directly.** Each `.dc.html` file is a self-contained component prototype (it uses a small runtime, `support.js`, purely so the prototypes are interactive in a browser — you do **not** need or want that runtime in production).

Your task is to **recreate these designs in the target codebase's existing environment**, using its established patterns and libraries. The brief indicates the current stack is **React + Tailwind + shadcn/ui + Lucide icons**; recreate the UI with those. If no environment exists yet, choose the most appropriate framework and implement there.

**How to view the references:** open any `.dc.html` file in a browser. They are interactive — buttons, toggles, sliders, step navigation, and tab switching all work, so you can see intended behavior, not just static layout.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, and interactions are all intentional and specified below. Recreate the UI pixel-faithfully using the codebase's libraries. The one thing you should freely adapt is *implementation* (component structure, state management) to match codebase conventions — the *visual result* should match.

---

## Design Tokens

### Color — warm, light-first ("Passage" palette)

The interface is carried entirely by warm neutrals. **There is no brand-accent color.** Identity and primary actions are ink (near-black). Semantic colors are low-chroma so nothing shouts.

| Token | Hex | Use |
|---|---|---|
| `bone` | `#F1EBE1` | App background / page |
| `paper` | `#FBF8F3` | Card surface |
| `raised` | `#FEFCF9` | Raised surface (inputs, tiles on cards) |
| `panel-warm` | `#F4EFE6` | Window chrome, sub-nav backgrounds |
| `ink` | `#292420` | Primary text, **primary buttons** |
| `ink-hover` | `#3a342d` | Primary button hover |
| `ink-2` | `#6F6658` | Secondary text |
| `muted` | `#9A9082` | Tertiary text, metadata |
| `faint` | `#B0A691` | Disabled text, placeholders |
| `line` | `#E6DECF` | Borders / dividers |
| `line-2` | `#EFE9DE` / `#F1EBE1` | Inner row dividers |
| `field-border` | `#D8CEBC` | Input borders |

### AI accent — the one deliberately cool note

| Token | Hex | Use |
|---|---|---|
| `ai` | `#5B6B9E` | The AI accent (periwinkle) |
| `ai-ink` | `#46537F` / `#3F4664` | AI text on tint |
| `ai-tint` | `#F3F1F8` | AI surface background |
| `ai-tint-border` | `#D3D9EC` / `#C7CFE6` | AI surface border |
| `ai-chip-bg` | `#EEF0F7` | Small AI badge background |

**The single most important rule in the product:** the cool periwinkle never decorates. **If something is periwinkle, the AI proposed it and a human has not yet confirmed it.** The moment a human confirms, it turns warm — ink text on paper, or the green "confirmed" pill. AI-generated *content* (briefings, suggestions, reasoning, drafts) always sits on the `ai-tint` surface, with a `✦` glyph, and frequently a left border (`border-left: 3px solid #5B6B9E`). Human-entered content is ink on paper.

### Semantic colors (low-chroma)

| Meaning | Text | BG | Border | Dot/solid |
|---|---|---|---|---|
| Confirmed / done / paid | `#4C6749` | `#ECF1EC` | `#CFE0CD` | `#5E7A5A` |
| Waiting / flagged / review | `#8A6A22` | `#F8F1E1` | `#ECDDBF` | `#B0822F` |
| Blocked / emergency | `#A85A40` | `#F7ECE6` / `#FBF4F1` | `#E8CFC2` | `#A85A40` |
| Scheduled (neutral state) | `#6F6658` | `#FEFCF9` | `#E6DECF` | `#8A7F9E` |
| En route | `#6F6658` | `#FEFCF9` | `#E6DECF` | `#7C8A66` |

### Typography

- **Single typeface: Hanken Grotesk** (Google Fonts), weights 400/500/600/700. Used for both dense data and natural-language AI output. No display serif.
- **Numbers are always tabular:** `font-variant-numeric: tabular-nums` on all IDs, money, times, percentages, counts.
- Scale: Display 30/600 (-0.01em) · Heading 22/600 · Card title 16–18/600 · Body 15/400 (line-height 1.55) · Small 13/400 · **Label 11/600 uppercase, letter-spacing 0.08em, color `muted`**.

### Spacing, radius, elevation

- **4px base grid.** Common steps: 4, 8, 16 (rows), 24 (card padding), 40 (between sections), 64 (page gutters).
- **Radius:** inputs/buttons 8–9px · cards 12–14px · large panels/app shells 16–18px · pills 99px.
- **Elevation (warm-tinted, soft):**
  - Resting card: `0 1px 2px rgba(41,36,32,.04)`
  - Raised: `0 1px 2px rgba(41,36,32,.04), 0 10px 28px -14px rgba(41,36,32,.16)`
  - App shell / overlay: `0 2px 4px rgba(41,36,32,.05), 0 40px 90px -40px rgba(41,36,32,.32)`

### Controls

- **Primary button:** `background:#292420; color:#F1EBE1`, hover `#3a342d`, height 42–44px (56px in the field app), radius 8–10px, weight 600. **This is the only filled button on a screen.**
- **Green is never an action fill — only a confirmed/done *state*.** A "Confirm" button is ink; the *result* becomes a green "Confirmed" pill.
- **Secondary:** `background:#FEFCF9; border:1px solid #D8CEBC; color:#292420`. **Ghost:** transparent, `color:#6F6658`, hover `background:#F1EBE1`. **Destructive:** `background:#F7ECE6; border:1px solid #E3C9BD; color:#A85A40`.
- **Input focus:** `border-color:#5B6B9E; box-shadow:0 0 0 3px rgba(91,107,158,.14)`.
- **Toggle (on):** track `#5B6B9E`, white knob. **Segmented control:** track `#F1EBE1` padding 3px; active segment `#FEFCF9` with `0 1px 2px rgba(41,36,32,.06)`.

### Icons

Use **Lucide** (matches current codebase). The `✦` AI glyph in the prototypes is a stand-in for a consistent "sparkle/AI" mark — use Lucide `Sparkles` (or a single chosen mark) everywhere AI presence is indicated.

---

## The AI status & confidence system (build this first)

This is the backbone shared by every screen. Implement it as reusable primitives.

### AI decision lifecycle

`Proposed → Approved → Auto-executed` and the off-paths `Flagged` and `Reversed`.

| State | Treatment |
|---|---|
| **Proposed** | AI tint surface, `✦`, confidence shown. Has Confirm (ink) + an alternative action. Waiting on a human. |
| **Approved** | Green pill `✓`, warm. Logged, shows an Undo affordance. |
| **Auto-executed** | **Solid periwinkle** badge (`background:#5B6B9E; color:#fff; ✦ Auto · 96%`). The AI acted on its own because confidence cleared the tenant threshold. Always reversible (Undo, ~24h), always logged. *This state did not exist in prior FSM tools — it's core to Airbase.* |
| **Flagged** | Amber `⚠` pill, "Review required". |
| **Reversed** | Strikethrough, muted. |

### Confidence

Always show confidence as a percentage with `tabular-nums`, in an AI-tinted chip (`✦ 94%`). Below a tenant threshold the AI proposes and waits; above, it auto-executes. **Money never moves autonomously** regardless of confidence — financial actions always require a named human confirm (show a `🔒` lock affordance).

### Provenance tags (for any field/value)

- `✦ AI suggested · 92%` (AI tint)
- `✓ Confirmed` (green)
- `✎ Entered manually` (warm neutral)

---

## Screens / Views

> File map: the design system, the Dashboard, and the Dispatch board all live in **`Airbase Design System.dc.html`** (one scrollable reference doc with a left nav). The other four screens are their own files.

### 1. Operator Dashboard — *"a morning briefing, not a report"*
**File:** `Airbase Design System.dc.html` (section `#dashboard`)
**Purpose:** The first thing the operator sees each morning — what needs them, in plain English, with everything else shown as "running."
**Layout:** App shell (window chrome bar → top bar with org switcher, ⌘K command/search, "+ New job", avatar). Content padding 24px.
- **Briefing block** (AI tint, full width): `✦ Morning briefing` + timestamp, one plain-language paragraph, then a stack of action rows. The top row is an interactive dispatch **Proposed** card (Confirm = ink → on click becomes a green "assigned + Undo" row). A second row is a flagged invoice (amber).
- **KPI strip:** 4 cards — Revenue today, Open jobs, Unassigned (amber when >0), and `✦ AI-handled today` (AI tint). Big number is 26px/600 tabular.
- **Two-column row:** "Agent activity" live feed (left, 1.5fr) with per-agent colored glyph chips + timestamps and a live pulse dot; "Next services" timeline (right, 1fr) with time / colored dot / job.

### 2. Dispatch Board — Gantt timeline
**File:** `Airbase Design System.dc.html` (section `#dispatch`)
**Purpose:** See the whole crew's day at a glance; the only thing pulling the eye is unassigned/proposed work.
**Layout:** Toolbar (title, segmented **Timeline / List / Map**, `✦ AI placed N of M today` pill, filters). Below it a **Gantt timeline**: a left column of technician rows, a horizontal time axis (business hours), and job blocks positioned by start time and sized by duration.
- Job blocks carry status color (on-site green w/ pulse, en route, scheduled, done = ink + strikethrough, completed).
- AI-assigned blocks show an ambient `✦ AI · 91%` mark; **auto-assigned** blocks show the solid-periwinkle badge.
- An **Unassigned / proposals** rail holds emergency jobs with AI suggestions and an Accept (ink) action that resolves to a green "assigned" state. High-confidence single suggestions vs. lower-confidence "your call" two-option proposals are visually distinguished.
**Interactions:** In production this is drag-to-assign (drag a job block onto a tech row/time slot). The prototype shows accept-from-proposal; treat drag as the primary assign gesture plus the proposal accept path.

### 3. Booking Inbox — live command center
**File:** `Booking Inbox.dc.html`
**Purpose:** Where AI→human escalations land. SMS and live voice calls in one inbox. A CSR must be oriented in seconds.
**Layout:** Desktop, ~1240px, three panes inside a dark-rail app shell:
- **Dark left nav** (`#292420`, text `#C9BFAD`): org switcher, nav items, "Booking" active with a red count badge, user footer.
- **Pane 1 — conversation list** (336px): header with live count + segmented All / Escalated / Done; grouped "**Needs a human**" (escalated SMS, live voice call w/ pulse) vs "**AI handling · monitor only**". Each row: channel icon (`✉`/`☏`), name, member badge, preview, time. Selected row gets a tinted background (terracotta tint for escalated, AI tint for the call).
- **Pane 2 — thread** (flex): header (avatar, name, member badge, channel). Message bubbles — **customer** = `#FEFCF9` border, left-aligned, radius `14 14 14 4`; **AI (`✦ JORDAN (AI)`)** = AI tint, right-aligned, radius `14 14 4 14`. An **escalation divider** (terracotta pill) explains *why* the AI handed off ("customer asked for a person · stressed · 62% confident to continue"). Composer starts **locked** ("Jordan handed this to you") with a **Take over** button (ink); after takeover it shows quick-reply chips that prefill a draft + textarea + Send (ink). Selecting the voice conversation swaps the thread to a live-call view (transcript bubbles + "Listen in" / "Take the call").
- **Pane 3 — context** (330px): "**What Jordan already knows**" (problem, address ✓, deadline, priority), the customer record, and a `✦` **draft job ready to confirm** with a "Create & dispatch" (ink) button.
**State:** `selected` conversation (c1 SMS / c2 voice); `takenOver` boolean (locks/unlocks composer); `draft` text; `sent` appended CSR messages.

### 4. Onboarding — clickable 5-step wizard
**File:** `Onboarding.dc.html`
**Purpose:** Self-serve setup from sign-up to going live.
**Layout:** Centered, max 760px. Brand row + step counter → **stepper** (pills; completed = green check + clickable to jump back, current = ink, todo = muted) → card with the step body (min-height 392px) → footer (Back / step counter / Continue, where Continue becomes "Go live" on the last step).
**Steps:** ① **Company** (name, trade chips, service area, timezone) · ② **Phone** (provision AI booking line / port a number, AI-tint feature card) · ③ **Pricebook** (a `✦`-extracted review table — Item / Type / Price / per-item confidence chip — treated as a *normal* step, not the hero) · ④ **Team** (technician rows with skills + Active/Invited states) · ⑤ **Go live** (green summary checklist). Completing → a centered success screen ("Steward Home Services is live") with "Open dashboard" / "View booking inbox" + "Run setup again".
**State:** `step` (0–4), `done` boolean, `trade` selection. Stepper jumps are allowed to completed/earlier steps.

### 5. AI Settings — per-agent autonomy
**File:** `AI Settings.dc.html`
**Purpose:** Translate model choice + confidence thresholds into plain language a trades owner understands.
**Layout:** Centered, max 880px. Header (breadcrumb, title, intro). One **card per agent** (Booking, Dispatch, Invoice, Follow-up): colored icon + name + role + a current-autonomy badge in the header; an **autonomy slider** (0–3) inside a raised tile; a "thinking style" segmented control; and (invoice only) a financial lock note.
**The autonomy ladder (slider stops):** *Suggests only → Acts when sure → Acts when fairly sure → Acts almost always.* Each stop shows a one-sentence behavior description and a **quiet** secondary threshold ("auto above ~85%") — **plain language is primary, the % is muted fine print.** A matching badge restates the current setting.
**Model selection is abstracted** to **Balanced / Most capable / Fastest** ("Thinking style") — **never expose real model names.**
**Invoice agent** always shows `🔒 Always asks you before moving money`, regardless of slider position.
**State:** per-agent `level` (0–3) and `model` string.

### 6. Company Settings — sub-nav + auto-save
**File:** `Company Settings.dc.html`
**Purpose:** The business-facts layer the agents and apps read. Designed to feel functional and intuitive (the prior version was neither).
**Layout:** App shell, max 1180px. **Left settings sub-nav** (248px, warm panel) lists 7 sections; **content panel** on the right with a header that includes an **auto-save indicator** (`All changes saved` → `Saving…` → `✓ Saved just now`, ~600ms debounce). Content column max 680px. **No save buttons.** Every control has one line of plain-language helper text describing its real-world effect.
**Sections:**
1. **Company profile** — logo tile, company name, legal name, license #, trade chips, address.
2. **Hours & availability** *(most polished)* — 7 day rows each with an open/closed **toggle** + from/to time fields (closed days show "Closed"); plus a 3-way **after-hours policy** radio group (Take a message / Book emergencies only / Book anytime).
3. **Service area** — segmented **Distance from base** (radius slider 5–60mi with a circular radius visual + derived ZIP count) vs **Specific ZIP codes** (chip list + Add).
4. **Customer-facing identity** — SMS sender name, reply-to email, review link, accent-color swatches, and a **live SMS preview** bubble.
5. **Team & access** — **two groups:** *Office & operations* (people with avatar / email / status / role dropdown — Owner, Operator, CSR, Viewer) **and** *Field technicians* (cards with avatar / phone / status and a **tappable skill catalog** — Plumbing, Drain cleaning, Water heater, HVAC, Maintenance, Electrical, Install; selected skills are green-checked). Helper text: skills decide who the dispatch agent can assign.
6. **Plan & billing** — current plan card ($499/location, AI tint), per-location list with add, card on file, billing history rows with PDF links.
7. **Connections** — Phone & SMS (connected), Payments/Stripe (connected), Accounting/QuickBooks (connect) — each a row with status badge + Manage/Connect.
**State:** active `section`; `trade`; `save` indicator state; `days[]` (open + times); `afterHours`; `areaMode` + `radius`; `brand` color; `techs[]` with per-tech `skills[]`. Any edit calls a `touch()` that drives the save indicator.

---

## Interactions & Behavior (cross-cutting)

- **Auto-save** (Company Settings): debounce ~600ms; indicator transitions idle → `Saving…` → `Saved just now`. No modal/save buttons.
- **Confirm → confirmed:** approving an AI proposal swaps the proposal UI for a green confirmed row with an **Undo**. Auto-executed items are reversible for ~24h.
- **Take-over** (Booking Inbox): locked composer → unlocked with quick-reply chips that prefill the draft.
- **Stepper nav** (Onboarding): linear Continue/Back, plus jump-back to completed steps.
- **Sliders/segmented/toggles** update live; the periwinkle/green/amber rules above always hold.
- **Tabular numerals** everywhere numeric.
- **Live pulse** dot animation (`abpulse` keyframe in the prototypes) marks live/on-site states — a 2.4s ease-in-out scale+fade.

## Responsive behavior

- **Operator app is desktop-first.** Booking Inbox (~1240px) and the Dispatch Gantt scroll horizontally below their min width rather than collapsing. The brief flags graceful mobile degradation of operator views as a separate, not-yet-designed task.
- **Technician app is mobile-first** — a **field variant** of the same palette: higher contrast for sunlight, larger type, **56px touch targets**. (The tech screens are demonstrated inside `Airbase Design System.dc.html` under the "Technician App" section: a Today list and a Job detail with a stage stepper — On my way → Arrived → Working → Done → auto invoice-draft handoff.)

## Assets

- **Font:** Hanken Grotesk via Google Fonts.
- **Icons:** Lucide (use the existing codebase set). The `✦` sparkle is the AI mark — pick one Lucide glyph and use it consistently.
- **Logo:** a simple ink rounded-square "A" wordmark stands in; swap for the real Airbase logo when available.
- No raster image assets are required; all UI is CSS.

## Files in this bundle

- `Airbase Design System.dc.html` — foundations (color, type, space, controls, status/provenance, the AI confidence pattern) **+ the Operator Dashboard, the Dispatch Gantt board, and the Technician App screens.**
- `Booking Inbox.dc.html`
- `Onboarding.dc.html`
- `AI Settings.dc.html`
- `Company Settings.dc.html`
- `support.js` — the prototype runtime (lets the `.dc.html` files run interactively in a browser). **Reference only — do not port to production.**

To view any screen: open the `.dc.html` file in a browser. They are interactive.
