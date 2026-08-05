// Downloads the offline speech-recognition model used by the Dental Scribe's
// built-in microphone, plus the ONNX WebAssembly runtime, into resources/models/.
//
// Run once before packaging:  npm run fetch-models
// (GitHub Actions runs this automatically; the files are bundled into the installer
// so the clinic app NEVER contacts the network at runtime.)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODEL_ID = 'Xenova/whisper-tiny.en'
const BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`
const OUT = path.join(ROOT, 'resources', 'models', MODEL_ID)

// Quantized ONNX weights keep the installer small (~50 MB total).
// `optional: true` files are nice-to-have — a missing one must not break the build.
const FILES = [
  { rel: 'config.json' },
  { rel: 'preprocessor_config.json' },
  { rel: 'tokenizer.json' },
  { rel: 'tokenizer_config.json' },
  { rel: 'onnx/encoder_model_quantized.onnx' },
  { rel: 'onnx/decoder_model_merged_quantized.onnx' },
  { rel: 'generation_config.json', optional: true }
]

async function download({ rel, optional }) {
  const dest = path.join(OUT, rel)
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`  = ${rel} (cached)`)
    return
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const url = `${BASE}/${rel}`
  const res = await fetch(url)
  if (!res.ok) {
    if (optional) {
      console.log(`  ~ ${rel} (optional, not published — skipped)`)
      return
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
  console.log(`  + ${rel} (${(buf.length / 1048576).toFixed(1)} MB)`)
}

// The ONNX runtime's .wasm binaries ship inside the npm package; copy them next to
// the model so the renderer can load everything through the gsmodel:// protocol.
function copyOrtWasm() {
  const src = path.join(ROOT, 'node_modules', '@xenova', 'transformers', 'dist')
  const dst = path.join(ROOT, 'resources', 'models', 'ort')
  if (!fs.existsSync(src)) throw new Error('@xenova/transformers is not installed — run npm install first')
  fs.mkdirSync(dst, { recursive: true })
  let n = 0
  for (const f of fs.readdirSync(src)) {
    if (f.endsWith('.wasm')) {
      fs.copyFileSync(path.join(src, f), path.join(dst, f))
      n++
    }
  }
  console.log(`  + ${n} ONNX runtime .wasm file(s)`)
}

console.log(`Fetching offline speech model ${MODEL_ID} …`)
for (const f of FILES) await download(f)
copyOrtWasm()
console.log('Done. Models are in resources/models/ and will be bundled into the installer.')
