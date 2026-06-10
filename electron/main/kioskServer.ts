// Local-network tablet check-in server.
//
// The desktop app runs a small HTTP server on the clinic's local network (a router or a
// Windows hotspot — no internet required). A tablet/laptop opens the tokenised link in
// its browser, the patient completes intake + consent + signature, and the check-in is
// written straight into this computer's database (patient + signed consent PDF), tagged
// to the active event. The page is fully self-contained (no external resources).
import http from 'node:http'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { Patients, Consents, ActiveEvent, Settings, Audit, Users } from './repositories'
import { buildConsentHtml } from './templates/consent'
import { renderHtmlToPdf } from './pdf'
import { patientDirs, writeFileBuffer, timestampName } from './files'
import { CONSENT_CONTENT } from '@shared/consent'
import { INTAKE_STRINGS, COMMON_ALLERGIES, COMMON_CONDITIONS } from '@shared/intakeStrings'
import { logoLockupSvg } from '@shared/branding'
import type { Language, PatientInput, KioskServerStatus } from '@shared/types'

const DEFAULT_PORT = 8765
const MAX_BODY = 5 * 1024 * 1024

let server: http.Server | null = null
let token = ''
let port: number | null = null

function lanUrls(): string[] {
  if (!port) return []
  const urls: string[] = []
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`http://${net.address}:${port}/checkin/${token}`)
      }
    }
  }
  return urls
}

export function kioskServerStatus(): KioskServerStatus {
  return { running: !!server, urls: lanUrls(), port }
}

export async function startKioskServer(): Promise<KioskServerStatus> {
  if (server) return kioskServerStatus()
  token = randomUUID()
  server = http.createServer(handleRequest)
  await new Promise<void>((resolve, reject) => {
    server!.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Fall back to an ephemeral port if the default is taken.
        server!.listen(0, '0.0.0.0', () => resolve())
      } else {
        server = null
        reject(err)
      }
    })
    server!.listen(DEFAULT_PORT, '0.0.0.0', () => resolve())
  })
  const addr = server!.address()
  port = typeof addr === 'object' && addr ? addr.port : DEFAULT_PORT
  return kioskServerStatus()
}

export function stopKioskServer(): KioskServerStatus {
  if (server) {
    server.close()
    server = null
    port = null
    token = ''
  }
  return kioskServerStatus()
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url || ''
  if (req.method === 'GET' && url === `/checkin/${token}`) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(buildCheckinPage())
    return
  }
  if (req.method === 'POST' && url === `/api/checkin/${token}`) {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        res.writeHead(413).end()
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      void processCheckin(Buffer.concat(chunks).toString('utf-8'), res)
    })
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('Not found')
}

async function processCheckin(raw: string, res: http.ServerResponse): Promise<void> {
  const json = (code: number, payload: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  try {
    const data = JSON.parse(raw) as {
      language: Language
      patient: Partial<PatientInput>
      signedByName: string
      signatureDataUrl: string | null
    }
    const p = data.patient || {}
    if (!p.first_name?.trim() || !p.last_name?.trim() || !p.date_of_birth) {
      return json(400, { ok: false, error: 'Missing required fields' })
    }
    const language: Language = ['english', 'spanish', 'arabic'].includes(data.language)
      ? data.language
      : 'english'
    const opt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

    const input: PatientInput = {
      first_name: String(p.first_name).trim(),
      last_name: String(p.last_name).trim(),
      date_of_birth: String(p.date_of_birth),
      phone: opt(p.phone),
      email: opt(p.email),
      address: opt(p.address),
      emergency_contact: opt(p.emergency_contact),
      emergency_phone: opt(p.emergency_phone),
      allergies: opt(p.allergies),
      medical_conditions: opt(p.medical_conditions),
      medications: opt(p.medications),
      dental_history: opt(p.dental_history),
      insurance_info: null,
      referring_doctor: null,
      preferred_language: language,
      event_id: null
    }

    const eventId = ActiveEvent.getId()
    const patient = Patients.create(input, eventId)

    // Generate + archive the signed consent through the standard pipeline.
    const signedAt = new Date().toISOString()
    const html = buildConsentHtml({
      clinic: Settings.getAll(),
      patient,
      language,
      signatureDataUrl: data.signatureDataUrl || null,
      signedByName: data.signedByName?.trim() || `${patient.first_name} ${patient.last_name}`,
      signedAt,
      providerName: null
    })
    const pdf = await renderHtmlToPdf(html)
    const dirs = patientDirs(patient.patient_id)
    const path = writeFileBuffer(dirs.consents, timestampName(`Consent_${language}`, 'pdf'), pdf)
    Consents.create(
      patient.id,
      'general_consent',
      language,
      data.signedByName?.trim() || `${patient.first_name} ${patient.last_name}`,
      signedAt,
      path
    )

    const actorId = Users.list()[0]?.id ?? 1
    Audit.log(actorId, patient.id, 'kiosk_checkin', `Tablet check-in: ${patient.patient_id}`)

    // Notify open app windows so the front desk / doctor sees the arrival instantly.
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('live:checkin', {
        id: patient.id,
        name: `${patient.first_name} ${patient.last_name}`,
        patient_id: patient.patient_id
      })
    }

    json(200, { ok: true, patientId: patient.patient_id })
  } catch (e) {
    json(500, { ok: false, error: e instanceof Error ? e.message : 'Check-in failed' })
  }
}

// ---------------------------------------------------------------------------
// Self-contained check-in page (no external resources — works fully offline).
// ---------------------------------------------------------------------------
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function buildCheckinPage(): string {
  const clinic = Settings.getAll()
  const i18n = safeJson(INTAKE_STRINGS)
  const consent = safeJson(CONSENT_CONTENT)
  const allergies = safeJson(COMMON_ALLERGIES)
  const conditions = safeJson(COMMON_CONDITIONS)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<title>${clinic.clinic_name} — Patient Check-In</title>
<style>
  :root { --navy:#16335B; --azure:#2FA8DF; --soft:#E8F4FB; --border:#D8E3EC; --muted:#5A6B7B; --danger:#E0524A; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:'Segoe UI',Arial,sans-serif; color:#1B2B40; background:linear-gradient(160deg,#e8f4fb,#f4f8fb); min-height:100vh; }
  header { background:#fff; border-bottom:1px solid var(--border); padding:12px; text-align:center; }
  .wrap { max-width:680px; margin:0 auto; padding:18px 14px 60px; }
  .card { background:#fff; border:1px solid var(--border); border-radius:14px; padding:18px; margin-bottom:16px; box-shadow:0 4px 14px rgba(16,37,66,.06); }
  h1 { color:var(--navy); font-size:24px; margin:0 0 6px; }
  h3 { color:var(--navy); margin:0 0 10px; }
  p.muted { color:var(--muted); margin:4px 0 14px; }
  label { display:block; font-size:13px; font-weight:600; color:var(--muted); margin:10px 0 4px; }
  .req { color:var(--danger); }
  input, textarea { width:100%; font:inherit; padding:12px; border:1px solid var(--border); border-radius:10px; }
  input:focus, textarea:focus { outline:none; border-color:var(--azure); box-shadow:0 0 0 3px rgba(47,168,223,.16); }
  textarea { min-height:70px; resize:vertical; }
  .row2 { display:grid; grid-template-columns:1fr 1fr; gap:0 14px; }
  @media (max-width:560px){ .row2{ grid-template-columns:1fr; } }
  .chips { display:flex; flex-wrap:wrap; gap:7px; margin:4px 0 8px; }
  .chip { border:1px solid var(--border); background:#fff; border-radius:999px; padding:9px 14px; font:inherit; font-size:14px; cursor:pointer; }
  .chip.on { border-color:var(--azure); background:var(--soft); color:var(--navy); font-weight:700; }
  .btn { display:inline-block; border:none; border-radius:10px; padding:14px 26px; font:inherit; font-size:17px; font-weight:700; cursor:pointer; }
  .btn-primary { background:var(--azure); color:#fff; }
  .btn-ghost { background:#fff; border:1px solid var(--border); color:#1B2B40; }
  .btn:disabled { opacity:.5; }
  .actions { display:flex; justify-content:space-between; gap:10px; margin-top:18px; }
  .lang { display:flex; gap:8px; justify-content:center; margin:10px 0 16px; flex-wrap:wrap; }
  .consent-box { max-height:300px; overflow:auto; border:1px solid var(--border); border-radius:10px; padding:12px 16px; background:#fff; font-size:14px; }
  .consent-box h4 { color:var(--navy); margin:10px 0 2px; }
  canvas#sig { width:100%; height:190px; border:2px dashed var(--border); border-radius:10px; background:#fff; touch-action:none; }
  .err { color:var(--danger); font-size:13px; margin-top:8px; min-height:18px; }
  .center { text-align:center; }
  .big { font-size:50px; }
  .hidden { display:none; }
</style>
</head>
<body>
<header>${logoLockupSvg({ height: 40 })}</header>
<div class="wrap" id="app"></div>
<script>
const I18N = ${i18n};
const CONSENT = ${consent};
const ALLERGIES = ${allergies};
const CONDITIONS = ${conditions};
const CLINIC = ${safeJson(clinic.clinic_name)};
const LANGS = [["english","English"],["spanish","Español"],["arabic","العربية"]];

let lang = "english";
let step = "welcome";
let picks = { allergies: [], conditions: [] };
const data = {};
let sigEmpty = true, sigDataUrl = null;

const app = document.getElementById("app");
const T = () => I18N[lang];
const optLabel = (o) => lang === "spanish" ? o.es : lang === "arabic" ? o.ar : o.en;

function el(html){ const d=document.createElement("div"); d.innerHTML=html; return d; }
function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function langButtons(){
  return '<div class="lang">' + LANGS.map(([k,l]) =>
    '<button type="button" class="btn ' + (lang===k?"btn-primary":"btn-ghost") + '" data-lang="'+k+'">'+l+'</button>'
  ).join("") + '</div>';
}
function bindLang(node){
  node.querySelectorAll("[data-lang]").forEach(b => b.addEventListener("click", () => { lang = b.dataset.lang; render(); }));
}

function field(id,label,required,type){
  return '<label>'+escapeHtml(label)+(required?' <span class="req">*</span>':'')+'</label>' +
    '<input id="'+id+'" type="'+(type||"text")+'" value="'+escapeHtml(data[id]||"")+'"/>';
}
function chips(kind, options){
  return '<div class="chips">' + options.map(o => {
    const on = picks[kind].includes(o.key);
    return '<button type="button" class="chip'+(on?" on":"")+'" data-kind="'+kind+'" data-key="'+escapeHtml(o.key)+'">'+(on?"✓ ":"")+escapeHtml(optLabel(o))+'</button>';
  }).join("") + '</div>' +
  '<input id="'+kind+'_other" placeholder="'+escapeHtml(T().otherPlaceholder)+'" value="'+escapeHtml(data[kind+"_other"]||"")+'"/>';
}
function bindChips(node){
  node.querySelectorAll(".chip").forEach(b => b.addEventListener("click", () => {
    saveInputs(node);
    const kind=b.dataset.kind, key=b.dataset.key;
    if (key === "None") picks[kind] = picks[kind].includes("None") ? [] : ["None"];
    else { picks[kind] = picks[kind].filter(k=>k!=="None");
      picks[kind] = picks[kind].includes(key) ? picks[kind].filter(k=>k!==key) : picks[kind].concat([key]); }
    render();
  }));
}
function saveInputs(node){
  node.querySelectorAll("input,textarea").forEach(i => { if(i.id) data[i.id]=i.value; });
}

function render(){
  document.documentElement.dir = T().dir;
  if (step === "welcome") renderWelcome();
  else if (step === "form") renderForm();
  else if (step === "consent") renderConsent();
  else renderDone();
}

function renderWelcome(){
  app.innerHTML = '';
  const n = el('<div class="card center">'+
    '<h1>'+escapeHtml(T().welcomeTitle)+'</h1>'+
    '<p class="muted">'+escapeHtml(T().welcomeBody)+'</p>'+
    '<p class="muted">'+escapeHtml(T().chooseLanguage)+'</p>'+ langButtons() +
    '<button class="btn btn-primary" id="begin">'+escapeHtml(T().begin)+'</button></div>');
  bindLang(n);
  n.querySelector("#begin").addEventListener("click", ()=>{ step="form"; render(); });
  app.appendChild(n);
}

function renderForm(){
  const t = T();
  app.innerHTML='';
  const n = el(
   '<h1>'+escapeHtml(t.yourInfo)+'</h1><p class="muted">'+escapeHtml(t.requiredNote)+'</p>'+ langButtons() +
   '<div class="card"><h3>'+escapeHtml(t.sectionPersonal)+'</h3><div class="row2"><div>'+
     field("first_name",t.firstName,true)+'</div><div>'+field("last_name",t.lastName,true)+'</div></div>'+
     '<div class="row2"><div>'+field("date_of_birth",t.dob,true,"date")+'</div><div></div></div></div>'+
   '<div class="card"><h3>'+escapeHtml(t.sectionContact)+'</h3><div class="row2"><div>'+
     field("phone",t.phone)+'</div><div>'+field("email",t.email)+'</div></div>'+field("address",t.address)+
     '<div class="row2"><div>'+field("emergency_contact",t.emergencyName)+'</div><div>'+field("emergency_phone",t.emergencyPhone)+'</div></div></div>'+
   '<div class="card"><h3>'+escapeHtml(t.sectionMedical)+'</h3>'+
     '<label>'+escapeHtml(t.allergies)+'</label>'+chips("allergies",ALLERGIES)+
     '<label>'+escapeHtml(t.conditions)+'</label>'+chips("conditions",CONDITIONS)+
     '<label>'+escapeHtml(t.medications)+'</label><textarea id="medications">'+escapeHtml(data.medications||"")+'</textarea></div>'+
   '<div class="card"><h3>'+escapeHtml(t.sectionDental)+'</h3>'+
     '<label>'+escapeHtml(t.dentalHistory)+'</label><textarea id="dental_history">'+escapeHtml(data.dental_history||"")+'</textarea></div>'+
   '<div class="err" id="err"></div>'+
   '<div class="actions"><button class="btn btn-ghost" id="cancel">'+escapeHtml(t.cancel)+'</button>'+
   '<button class="btn btn-primary" id="next">'+escapeHtml(t.continueConsent)+'</button></div>');
  bindLang(n); bindChips(n);
  n.querySelectorAll("textarea").forEach(a => a.addEventListener("input", ()=>{ data[a.id]=a.value; }));
  n.querySelector("#cancel").addEventListener("click", reset);
  n.querySelector("#next").addEventListener("click", ()=>{
    saveInputs(n);
    if(!data.first_name || !data.last_name || !data.date_of_birth){
      n.querySelector("#err").textContent = t.requiredNote; window.scrollTo(0,0); return;
    }
    step="consent"; render();
  });
  app.appendChild(n);
}

function renderConsent(){
  const t = T(), c = CONSENT[lang];
  app.innerHTML='';
  const sections = c.sections.map(s=>'<h4>'+escapeHtml(s.heading)+'</h4><div>'+escapeHtml(s.body)+'</div>').join("");
  const n = el(
    '<h1>'+escapeHtml(t.consentTitle)+'</h1><p class="muted">'+escapeHtml(t.consentReview)+'</p>'+ langButtons() +
    '<div class="card"><div class="consent-box" dir="'+c.dir+'"><h3 style="text-align:center">'+escapeHtml(c.docTitle)+'</h3>'+sections+
    '<p><b>'+escapeHtml(c.acknowledgement)+'</b></p></div></div>'+
    '<div class="card"><h3>'+escapeHtml(t.signatureTitle)+'</h3>'+
    '<label>'+escapeHtml(c.signatoryNameLabel)+'</label><input id="signed_by" value="'+escapeHtml((data.first_name||"")+" "+(data.last_name||""))+'"/>'+
    '<label>'+escapeHtml(c.signatureLabel)+'</label><canvas id="sig"></canvas>'+
    '<div style="margin-top:8px"><button class="btn btn-ghost" id="clear" type="button">✕</button></div>'+
    '<div class="err" id="err"></div>'+
    '<div class="actions"><button class="btn btn-ghost" id="back">←</button>'+
    '<button class="btn btn-primary" id="submit">'+escapeHtml(t.acceptSave)+'</button></div></div>');
  bindLang(n);
  app.appendChild(n);
  initSig();
  n.querySelector("#clear").addEventListener("click", clearSig);
  n.querySelector("#back").addEventListener("click", ()=>{ step="form"; render(); });
  n.querySelector("#submit").addEventListener("click", submit);
}

function renderDone(msg){
  const t = T();
  app.innerHTML='';
  const n = el('<div class="card center"><div class="big">✅</div><h1>'+escapeHtml(t.thankYouTitle)+'</h1>'+
    '<p class="muted">'+escapeHtml(t.thankYouBody)+'</p>'+
    '<button class="btn btn-ghost" id="again">'+escapeHtml(t.newCheckIn)+'</button></div>');
  n.querySelector("#again").addEventListener("click", reset);
  app.appendChild(n);
}

let ctx=null, drawing=false, canvas=null;
function initSig(){
  canvas = document.getElementById("sig");
  const ratio = Math.max(window.devicePixelRatio||1,1);
  canvas.width = canvas.offsetWidth*ratio; canvas.height = canvas.offsetHeight*ratio;
  ctx = canvas.getContext("2d"); ctx.scale(ratio,ratio);
  ctx.strokeStyle = "#16335B"; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round";
  sigEmpty = true; sigDataUrl = null;
  const pos = (e)=>{ const r=canvas.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; };
  canvas.addEventListener("pointerdown", e=>{ drawing=true; const p=pos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", e=>{ if(!drawing) return; const p=pos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); sigEmpty=false; });
  const up = ()=>{ if(drawing){ drawing=false; if(!sigEmpty) sigDataUrl = canvas.toDataURL("image/png"); } };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
}
function clearSig(){ ctx.clearRect(0,0,canvas.width,canvas.height); sigEmpty=true; sigDataUrl=null; }

async function submit(){
  const err = document.getElementById("err");
  const signedBy = document.getElementById("signed_by").value.trim();
  if (sigEmpty || !sigDataUrl){ err.textContent = "✍"; return; }
  const btn = document.getElementById("submit"); btn.disabled = true;
  const joinPicks = (kind) => {
    const parts = picks[kind].slice();
    const other = (data[kind+"_other"]||"").trim();
    if (other) parts.push(other);
    return parts.join(", ");
  };
  try {
    const res = await fetch(location.pathname.replace("/checkin/","/api/checkin/"), {
      method:"POST", headers:{ "content-type":"application/json" },
      body: JSON.stringify({
        language: lang,
        signedByName: signedBy,
        signatureDataUrl: sigDataUrl,
        patient: {
          first_name:data.first_name, last_name:data.last_name, date_of_birth:data.date_of_birth,
          phone:data.phone, email:data.email, address:data.address,
          emergency_contact:data.emergency_contact, emergency_phone:data.emergency_phone,
          allergies: joinPicks("allergies"), medical_conditions: joinPicks("conditions"),
          medications:data.medications, dental_history:data.dental_history
        }
      })
    });
    const out = await res.json();
    if (out.ok){ step="done"; render(); }
    else { err.textContent = out.error || "Error"; btn.disabled = false; }
  } catch(e){ err.textContent = "Connection error — please call the front desk."; btn.disabled = false; }
}

function reset(){
  for (const k of Object.keys(data)) delete data[k];
  picks = { allergies: [], conditions: [] };
  sigEmpty = true; sigDataUrl = null; step = "welcome"; render();
}
render();
</script>
</body>
</html>`
}
