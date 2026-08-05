# Dental Scribe — how the dictation parser works

The Scribe turns free dictation into structured tooth findings entirely offline
(`shared/scribe.ts`, no ML, no network). This note exists because the parser has a
safety property worth stating plainly:

> **A wrong chart entry is worse than a missing one.** Anything ambiguous is dropped
> and flagged for the doctor rather than guessed at.

## Pipeline

```
correct → segment into clauses → extract tooth refs (veto layer)
        → read clinical intent per clause → bind each tooth to the intent nearest it
        → apply retractions → aggregate
```

**Segmentation** copes with run-on speech: voice typing routinely emits 100+ words
with no punctuation. Boundaries come from sentence punctuation, an ASR
capital-letter cue ("...implant there Other than that..."), discourse markers
("other than that", "along with", "and then also"), clause commas, and a fresh tooth
reference starting a new statement.

**Tooth references** understood: `#14`, `tooth 14`, `number 14`, bare numbers inside a
clinical clause ("15 and 16 both have cavities"), spoken digit pairs ("two four" =
24), number words ("nineteen", "thirty two"), `to 19` where dictation wrote "to" for
"tooth", FDI (`36` → 19, `FDI 26` → 14), Palmer codes (`UR6` → 3), spoken quadrants
("lower left seven" → 18), named teeth ("upper right first molar" → 3), and the
wisdom-teeth group. Matched notation is masked so `UR6` cannot also read as tooth 6.

**Veto layer** — numbers that are never teeth: ages, `mm`, `%`, blood pressure,
recall intervals, x-ray and carpule counts, anaesthetic ratios, probing-depth runs,
admin clauses, and questions. A lone single-digit *word* ("the top two") counts as a
tooth only when anchored or part of a spoken pair.

**Binding** is per clause, so several teeth in one breath each keep their own
condition. Plan items are emitted **only** from a "needs work" clause — "tooth 30 is
an implant with a crown on it" books nothing.

**Blanket statements** ("all the other teeth are healthy") set the mark-others flag
but never consume the findings stated in the same sentence. If a blanket is heard and
*no* individual findings could be read from a dictation that clearly described
problems, the parser refuses to sweep the mouth healthy and flags it for manual
charting.

**Retractions** ("scratch that") undo only the immediately preceding clause.
**Asides** ("for patient notes ...") are kept as notes. **Hedged** findings ("not sure
if that's decay") are flagged, not charted.

## Regression suite

```bash
node scripts/scribe-corpus.mjs
```

35 cases in `scripts/scribe-corpus.json`, including 9 negative cases that must never
produce a tooth entry. `expectTeeth` is an exact set; `expectTreatments` is a required
subset. Add a case here before changing parsing behaviour.
