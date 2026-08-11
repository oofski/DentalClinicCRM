import { COLORS } from '@shared/branding'

// Print-optimised stylesheet shared by the consent form and treatment report.
// Designed for US Letter with safe margins, controlled page breaks, and colours
// that render correctly when printed (printBackground is enabled).
export function documentCss(): string {
  return `
  @page { size: Letter; margin: 16mm 16mm 18mm 16mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    color: ${COLORS.text};
    font-size: 12px;
    line-height: 1.5;
    background: #fff;
  }
  .doc { max-width: 720px; margin: 0 auto; padding: 8px 0 0; }

  .doc-header {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; padding-bottom: 12px; border-bottom: 3px solid ${COLORS.azure};
  }
  .doc-header .brand svg { display: block; }
  .doc-header .clinic { text-align: right; font-size: 11px; color: ${COLORS.muted}; }
  .doc-header .clinic .name { font-size: 15px; font-weight: 700; color: ${COLORS.navy}; }
  [dir="rtl"] .doc-header .clinic { text-align: left; }

  .doc-title {
    margin: 18px 0 14px; font-size: 19px; font-weight: 700; color: ${COLORS.navy};
    text-align: center; letter-spacing: 0.2px;
  }

  .meta {
    display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px;
    background: ${COLORS.azureSoft}; border: 1px solid ${COLORS.border};
    border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 11.5px;
  }
  .meta .row { display: flex; gap: 6px; }
  .meta .row .k { color: ${COLORS.muted}; min-width: 92px; }
  .meta .row .v { color: ${COLORS.text}; font-weight: 600; }

  .alert {
    border: 1px solid ${COLORS.danger}; background: #FDECEA; color: #8B2A23;
    border-radius: 8px; padding: 8px 12px; margin-bottom: 14px; font-size: 11.5px;
  }
  .alert b { color: ${COLORS.danger}; }

  section { margin-bottom: 14px; page-break-inside: avoid; }
  section h2 {
    font-size: 13px; font-weight: 700; color: ${COLORS.navy};
    margin: 0 0 4px; padding-bottom: 3px; border-bottom: 1px solid ${COLORS.border};
  }
  section p { margin: 4px 0; }

  .consent-section { margin-bottom: 10px; page-break-inside: avoid; }
  .consent-section h3 { font-size: 12.5px; color: ${COLORS.navy}; margin: 0 0 2px; }
  .consent-section p { margin: 0; text-align: justify; }

  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid ${COLORS.border}; padding: 6px 8px; text-align: left; vertical-align: top; }
  thead th { background: ${COLORS.navy}; color: #fff; font-weight: 600; }
  [dir="rtl"] th, [dir="rtl"] td { text-align: right; }

  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; color: #fff; }
  .badge.urgent { background: ${COLORS.danger}; }
  .badge.important { background: ${COLORS.warning}; color: #5b4a00; }
  .badge.routine { background: ${COLORS.success}; }

  .counts { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 4px; }
  .count-chip {
    border: 1px solid ${COLORS.border}; border-radius: 999px; padding: 3px 10px;
    font-size: 10.5px; display: flex; align-items: center; gap: 6px;
  }
  .count-chip .dot { width: 10px; height: 10px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.18); }

  .chart-wrap { text-align: center; margin: 6px 0 2px; }
  .chart-wrap svg { max-width: 100%; height: auto; }

  /* ---------- Odontogram ----------
     The chart carries a colour AND a fill pattern per finding, because a printed chart is
     photocopied, faxed and read in greyscale. printBackground is on and print-color-adjust
     is exact (see the reset above), so the patterns survive the trip to paper — never
     override the fills here with a flat colour. */
  .og-block { page-break-inside: avoid; }
  .og-chart { text-align: center; margin: 6px 0 2px; }
  .og-chart svg { max-width: 100%; height: auto; }
  .og-legend { margin: 4px 0 2px; page-break-inside: avoid; }
  .og-legend svg { max-width: 100%; height: auto; }
  .og-legend-title {
    font-size: 10px; font-weight: 700; color: ${COLORS.muted};
    text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px;
  }

  /* A findings table can legitimately run past one page, so it breaks between ROWS instead
     of being shoved whole onto the next page, and repeats its header when it does. */
  .og-table-section { margin-bottom: 14px; page-break-inside: auto; }
  .og-table-section h2 {
    font-size: 13px; font-weight: 700; color: ${COLORS.navy};
    margin: 0 0 4px; padding-bottom: 3px; border-bottom: 1px solid ${COLORS.border};
  }
  .og-table { margin-bottom: 6px; }
  .og-table thead { display: table-header-group; }
  .og-table tr { page-break-inside: avoid; }
  .og-table td.og-tooth { white-space: nowrap; }
  .og-table .og-sub { font-size: 10px; color: ${COLORS.muted}; margin-top: 1px; }
  .og-dot {
    display: inline-block; width: 9px; height: 9px; border-radius: 50%;
    border: 1px solid rgba(0,0,0,0.2); margin-right: 5px; vertical-align: -1px;
  }
  .og-tag {
    display: inline-block; padding: 0 5px; border-radius: 8px; font-size: 9.5px;
    background: ${COLORS.azureSoft}; color: ${COLORS.navy}; border: 1px solid ${COLORS.border};
  }
  /* Proposed work is dashed here for the same reason it is dashed on the chart: a plan that
     looks like a completed treatment is how a patient gets treated twice. */
  .og-pill {
    display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 9.5px;
    font-weight: 700; white-space: nowrap;
  }
  .og-pill.present { border: 1.4px solid ${COLORS.navy}; color: ${COLORS.navy}; background: #fff; }
  .og-pill.proposed { border: 1.4px dashed ${COLORS.azure}; color: ${COLORS.azure}; background: #fff; }
  .og-plan-block { margin-bottom: 10px; page-break-inside: auto; }
  .og-plan {
    font-size: 11.5px; font-weight: 700; color: ${COLORS.navy};
    margin: 6px 0 3px; padding-left: 2px;
  }
  .og-table tr.og-phase td {
    background: ${COLORS.azureSoft}; font-weight: 700; color: ${COLORS.navy};
    font-size: 10.5px; padding: 3px 8px;
  }

  .note-block { margin-bottom: 8px; page-break-inside: avoid; }
  .note-block .ntype { font-weight: 700; color: ${COLORS.azure}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  /* pre-wrap keeps the indentation of a written-up examination note (FINDINGS,
     TREATMENT PLAN, ...) instead of collapsing it into one run-on paragraph.
     nl2br has already consumed the newlines, so this cannot double the line breaks. */
  .note-block .ncontent { margin-top: 2px; white-space: pre-wrap; }
  .note-block .teeth { color: ${COLORS.muted}; font-size: 10.5px; }

  .signatures { margin-top: 22px; display: flex; gap: 40px; page-break-inside: avoid; }
  .sig-box { flex: 1; }
  .sig-img { height: 70px; border-bottom: 1.5px solid ${COLORS.text}; display: flex; align-items: flex-end; }
  .sig-img img { max-height: 64px; max-width: 100%; }
  .sig-line { border-bottom: 1.5px solid ${COLORS.text}; height: 40px; }
  .sig-label { font-size: 10.5px; color: ${COLORS.muted}; margin-top: 4px; }
  .sig-meta { font-size: 11px; margin-top: 2px; }

  .footer {
    margin-top: 22px; padding-top: 8px; border-top: 1px solid ${COLORS.border};
    font-size: 9.5px; color: ${COLORS.muted}; text-align: center;
  }
  .page-break { page-break-before: always; }
  `
}

export function htmlShell(opts: {
  title: string
  dir?: 'ltr' | 'rtl'
  body: string
}): string {
  return `<!DOCTYPE html>
<html lang="en" dir="${opts.dir ?? 'ltr'}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${opts.title}</title>
  <style>${documentCss()}</style>
</head>
<body>${opts.body}</body>
</html>`
}
