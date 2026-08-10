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
// Small instruct model that interprets the dictation. Runs in-process through the same
// ONNX/WebAssembly runtime as Whisper — no Ollama, no second process, no network.
const LLM_ID = 'Xenova/Qwen1.5-0.5B-Chat'
const hf = (id, rel) => `https://huggingface.co/${id}/resolve/main/${rel}`
const OUT = path.join(ROOT, 'resources', 'models', MODEL_ID)
const LLM_OUT = path.join(ROOT, 'resources', 'models', LLM_ID)

const LLM_FILES = [
  { rel: 'config.json' },
  { rel: 'tokenizer.json' },
  { rel: 'tokenizer_config.json' },
  { rel: 'generation_config.json', optional: true },
  { rel: 'onnx/decoder_model_merged_quantized.onnx' }
]

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

async function download({ rel, optional }, id = MODEL_ID, outDir = OUT) {
  const dest = path.join(outDir, rel)
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`  = ${rel} (cached)`)
    return
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const url = hf(id, rel)
  const res = await fetch(url)
  if (!res.ok) {
    if (optional) {
      console.log(`  ~ ${rel} (optional, not published — skipped)`)
      return
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  // Guard against a truncated download being silently baked into the installer.
  const expected = Number(res.headers.get('content-length') || 0)
  if (expected && buf.length !== expected) {
    throw new Error(`Truncated download for ${rel}: got ${buf.length} of ${expected} bytes`)
  }
  // Write to a temp file and rename, so an interrupted run can't leave a partial file
  // that the "cached" check above would later accept.
  const tmp = `${dest}.part`
  fs.writeFileSync(tmp, buf)
  fs.renameSync(tmp, dest)
  console.log(`  + ${rel} (${(buf.length / 1048576).toFixed(1)} MB)`)
}

// The ONNX runtime's .wasm binaries ship inside the npm package; copy them next to
// the model so the renderer can load everything through the gsmodel:// protocol.
// With numThreads = 1 the runtime only ever requests the SIMD build (and the plain
// build as a fallback if SIMD is unsupported). The two *-threaded binaries need
// SharedArrayBuffer, which a file:// page cannot have, so shipping them would add
// ~19 MB to the installer for files that can never load.
const ORT_WASM = ['ort-wasm-simd.wasm', 'ort-wasm.wasm']

function copyOrtWasm() {
  const src = path.join(ROOT, 'node_modules', '@xenova', 'transformers', 'dist')
  const dst = path.join(ROOT, 'resources', 'models', 'ort')
  if (!fs.existsSync(src)) throw new Error('@xenova/transformers is not installed — run npm install first')
  fs.mkdirSync(dst, { recursive: true })
  for (const f of ORT_WASM) {
    const from = path.join(src, f)
    if (!fs.existsSync(from)) throw new Error(`Required ONNX runtime binary missing: ${f}`)
    fs.copyFileSync(from, path.join(dst, f))
    console.log(`  + ort/${f} (${(fs.statSync(from).size / 1048576).toFixed(1)} MB)`)
  }
}

console.log(`Fetching offline speech model ${MODEL_ID} …`)
for (const f of FILES) await download(f)
console.log(`Fetching offline language model ${LLM_ID} …`)
for (const f of LLM_FILES) await download(f, LLM_ID, LLM_OUT)
copyOrtWasm()
console.log('Done. Models are in resources/models/ and will be bundled into the installer.')
