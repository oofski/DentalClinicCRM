# Product screenshots — Giving Smiles v1.5.6

Real screenshots of the application running, not mockups. Captured from the actual
Electron build driven end to end (activate → sign in → create patient → dictate an exam →
apply to chart → generate the report PDF), at 2x for retina.

| File | Screen |
| --- | --- |
| `01-sign-in.png` | Clinic sign-in |
| `02-dashboard.png` | Dashboard |
| `03-patients-list.png` | Patients list |
| `04-patient-record.png` | Patient record |
| `05-examination.png` | Full examination screen |
| `06-tooth-chart.png` | Tooth chart |
| `07-dental-scribe.png` | Dental Scribe — dictation to chart |
| `08-clinical-note.png` | Composed clinical note |
| `09-treatment-plan.png` | Treatment plan |
| `10-settings.png` | Settings |
| `11-check-in.png` | Patient check-in |
| `12-patient-report.pdf` | The report PDF the app generated |

`06` and `07` are the pair worth leading with: the dictation shown in `07` is what
produced the chart in `06` — extractions on #1, #16, #17, #32, cavities on #11 and #14,
treatment on #30 and #31, the other 24 teeth healthy.

## The patients are invented

Maria Delgado, James Okonkwo, Aisha Rahman, Tomás Ferreira and Grace Whitfield are not
real people. The phone numbers are 555 numbers and the addresses are example.com. These
images must never be captioned or presented as a real clinic's records.

## Chart colours carry clinical meaning

These seven are not decoration — each one is a condition a dentist reads off the chart at
a glance, so a redesign must not recolour them:

| Condition | Colour |
| --- | --- |
| Healthy | `#46B26A` |
| Cavity | `#F2C53D` |
| Filled | `#3B82C4` |
| Missing | `#9AA7B2` |
| Implant | `#E8893B` |
| Needs Treatment | `#E0524A` |
| Extraction | `#9B59B6` |

Full-screen shots are 3200x2000 (a 1600x1000 window at 2x). Cropped cards are their own
natural size.
