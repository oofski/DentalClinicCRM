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

  .note-block { margin-bottom: 8px; page-break-inside: avoid; }
  .note-block .ntype { font-weight: 700; color: ${COLORS.azure}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  .note-block .ncontent { margin-top: 2px; }
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
