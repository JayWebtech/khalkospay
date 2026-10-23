import { encode, QrCodeDataType } from 'uqr'

export interface QrMatrix {
  size: number
  /** true = dark module */
  data: boolean[][]
  /** Which modules belong to the three finder squares, drawn as one shape each. */
  finder: boolean[][]
}

/** Medium error correction: survives a scuffed or partly covered print without making the code dense. */
export function qrMatrix(text: string): QrMatrix {
  const qr = encode(text, { ecc: 'M', border: 0 })
  return { size: qr.size, data: qr.data, finder: qr.types.map((row) => row.map((t) => t === QrCodeDataType.Position)) }
}

/** Top-left corners of the three finder squares, in modules. */
export function finderOrigins(size: number): [number, number][] {
  return [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ]
}

/** One SVG path for every dark data module, merged into horizontal runs to keep it small. */
export function qrDataPath(m: QrMatrix) {
  let d = ''
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!m.data[y][x] || m.finder[y][x]) continue
      let run = 1
      while (x + run < m.size && m.data[y][x + run] && !m.finder[y][x + run]) run++
      d += `M${x} ${y}h${run}v1h-${run}z`
      x += run - 1
    }
  }
  return d
}

interface Detected {
  rawValue: string
}

interface QrDetector {
  detect(source: ImageBitmapSource | HTMLVideoElement): Promise<Detected[]>
}

let detector: Promise<QrDetector> | null = null

/**
 * The platform's BarcodeDetector where it reads QR codes (Chrome on Android, so Nimiq Pay's Android WebView), else
 * ZXing compiled to WebAssembly (iOS WebViews have no BarcodeDetector). The WASM file ships with the app instead
 * of coming from a CDN, so scanning works wherever the app itself loads.
 */
export function qrDetector(): Promise<QrDetector> {
  detector ??= (async (): Promise<QrDetector> => {
    const Native = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): QrDetector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector
    if (Native) {
      try {
        if ((await Native.getSupportedFormats()).includes('qr_code')) return new Native({ formats: ['qr_code'] })
      } catch {
        // Fall through to ZXing.
      }
    }
    const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
      import('barcode-detector/ponyfill'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ])
    prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } })
    return new BarcodeDetector({ formats: ['qr_code'] })
  })()
  detector.catch(() => {
    detector = null
  })
  return detector
}

/** Reads a QR code from a photo (the fallback when the live camera isn't available). */
export async function decodeQrImage(file: Blob): Promise<string | null> {
  const [qr, bitmap] = await Promise.all([qrDetector(), createImageBitmap(file)])
  try {
    const found = await qr.detect(bitmap)
    return found[0]?.rawValue ?? null
  } finally {
    bitmap.close()
  }
}
