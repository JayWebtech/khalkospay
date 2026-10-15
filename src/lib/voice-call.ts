import { wsUrl, type Order, type Quote } from './api'

export type CallPhase = 'idle' | 'connecting' | 'live' | 'ending' | 'ended' | 'error'
export type AgentActivity = 'listening' | 'thinking' | 'speaking'

export interface TranscriptLine {
  id: number
  role: 'user' | 'assistant'
  text: string
}

export interface VoiceCallEvents {
  phase: (phase: CallPhase, message?: string) => void
  activity: (activity: AgentActivity) => void
  transcript: (line: TranscriptLine) => void
  walletRequest: (order: Order) => void
  orderUpdate: (order: Order) => void
  quote: (quote: Quote) => void
}

const MIC_RATE = 16_000
const AGENT_RATE = 24_000
const MIC_CHUNK = 800

// Resamples mic audio to 16 kHz mono PCM16 in ~50 ms chunks and reports RMS level for the UI.
const MIC_WORKLET = `
class KpMic extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.step = sampleRate / options.processorOptions.targetRate
    this.chunk = options.processorOptions.chunk
    this.out = new Int16Array(this.chunk)
    this.n = 0
    this.t = 0
    this.last = 0
    this.sq = 0
    this.count = 0
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (!input || input.length === 0) return true
    let t = this.t
    while (t < input.length - 1) {
      const i = Math.floor(t)
      const a = i < 0 ? this.last : input[i]
      const b = input[i + 1]
      const s = Math.max(-1, Math.min(1, a + (b - a) * (t - i)))
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (this.n === this.chunk) {
        this.port.postMessage(this.out.buffer, [this.out.buffer])
        this.out = new Int16Array(this.chunk)
        this.n = 0
      }
      t += this.step
    }
    this.t = t - input.length
    this.last = input[input.length - 1]
    for (let k = 0; k < input.length; k++) this.sq += input[k] * input[k]
    this.count += input.length
    if (this.count >= 2048) {
      this.port.postMessage({ level: Math.sqrt(this.sq / this.count) })
      this.sq = 0
      this.count = 0
    }
    return true
  }
}
registerProcessor('kp-mic', KpMic)
`

export function voiceCallUnsupportedReason(): string | null {
  if (!window.isSecureContext) return 'Voice calls need a secure HTTPS connection.'
  if (!navigator.mediaDevices?.getUserMedia) return "This device can't share its microphone with KhalkosPay."
  if (typeof AudioWorkletNode === 'undefined') return "This browser doesn't support live audio."
  return null
}

export class VoiceCall {
  private ws: WebSocket | null = null
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private mic: AudioWorkletNode | null = null
  private speaker: GainNode | null = null
  private speakerMeter: AnalyserNode | null = null
  private meterBuffer = new Float32Array(512)
  private sources = new Set<AudioBufferSourceNode>()
  private playhead = 0
  private oddByte: number | null = null
  private micLevel = 0
  private lineId = 0
  private streaming = false
  private phase: CallPhase = 'idle'
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private events: VoiceCallEvents
  private userAddress: string | null
  muted = false

  constructor(events: VoiceCallEvents, userAddress: string | null) {
    this.events = events
    this.userAddress = userAddress
  }

  async start() {
    this.setPhase('connecting')
    try {
      // Some WebViews never settle the permission request, so don't wait forever.
      this.stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new DOMException('timeout', 'NotAllowedError')), 15_000)),
      ])
    } catch (e) {
      const blocked = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      this.fail(blocked ? 'Microphone access is blocked. Allow it for Nimiq Pay and try again.' : "Couldn't start your microphone.")
      return
    }
    if (this.phase !== 'connecting') return this.cleanup()

    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      this.ctx = ctx
      await ctx.resume()
      const moduleUrl = URL.createObjectURL(new Blob([MIC_WORKLET], { type: 'application/javascript' }))
      await ctx.audioWorklet.addModule(moduleUrl)
      URL.revokeObjectURL(moduleUrl)

      this.mic = new AudioWorkletNode(ctx, 'kp-mic', { processorOptions: { targetRate: MIC_RATE, chunk: MIC_CHUNK } })
      ctx.createMediaStreamSource(this.stream).connect(this.mic)
      const silent = ctx.createGain()
      silent.gain.value = 0
      this.mic.connect(silent).connect(ctx.destination)
      this.mic.port.onmessage = (ev) => this.onMicMessage(ev.data)

      this.speakerMeter = ctx.createAnalyser()
      this.speakerMeter.fftSize = 512
      this.speaker = ctx.createGain()
      this.speaker.connect(this.speakerMeter).connect(ctx.destination)
    } catch {
      this.fail("Couldn't start audio on this device.")
      return
    }

    const ws = new WebSocket(wsUrl('/api/voice/call'))
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => ws.send(JSON.stringify({ type: 'start', sampleRate: MIC_RATE, userAddress: this.userAddress }))
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') this.onServerEvent(JSON.parse(ev.data))
      else this.play(ev.data as ArrayBuffer)
    }
    ws.onclose = () => {
      if (this.phase === 'connecting') this.fail("Couldn't connect the call. Please try again.")
      else if (this.phase === 'live') this.finishAfterPlayback()
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (muted) this.micLevel = 0
  }

  sendWalletResult(result: { ok: true; tx: string } | { ok: false }) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'wallet_result', ...result }))
  }

  hangUp() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'end' }))
    if (this.phase === 'connecting' || this.phase === 'live' || this.phase === 'ending') {
      this.cleanup()
      this.setPhase('ended')
    }
  }

  /** Current mic and agent loudness in 0..1, sampled by the UI on each animation frame. */
  levels() {
    let agent = 0
    if (this.speakerMeter) {
      this.speakerMeter.getFloatTimeDomainData(this.meterBuffer)
      let sum = 0
      for (const v of this.meterBuffer) sum += v * v
      agent = Math.sqrt(sum / this.meterBuffer.length)
    }
    return { mic: Math.min(1, this.micLevel * 4), agent: Math.min(1, agent * 4) }
  }

  private onMicMessage(data: unknown) {
    if (data instanceof ArrayBuffer) {
      if (this.streaming && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(this.muted ? new ArrayBuffer(data.byteLength) : data)
      }
    } else if (data && typeof data === 'object' && 'level' in data) {
      this.micLevel = this.muted ? 0 : Number((data as { level: number }).level)
    }
  }

  private onServerEvent(msg: { type: string; [key: string]: unknown }) {
    switch (msg.type) {
      case 'ready':
        this.streaming = true
        this.setPhase('live')
        break
      case 'transcript':
        this.events.transcript({ id: ++this.lineId, role: msg.role === 'user' ? 'user' : 'assistant', text: String(msg.content ?? '') })
        break
      case 'user_speaking':
        this.stopPlayback()
        this.events.activity('listening')
        break
      case 'agent_thinking':
        this.events.activity('thinking')
        break
      case 'agent_speaking':
        this.events.activity('speaking')
        break
      case 'agent_done':
        this.afterPlayback(() => this.events.activity('listening'))
        break
      case 'wallet_request':
        this.events.walletRequest(msg.order as Order)
        break
      case 'order_update':
        this.events.orderUpdate(msg.order as Order)
        break
      case 'quote':
        this.events.quote(msg.quote as Quote)
        break
      case 'error':
        this.fail(String(msg.message ?? 'The call dropped.'))
        break
      case 'ended':
        this.finishAfterPlayback()
        break
    }
  }

  private play(chunk: ArrayBuffer) {
    const ctx = this.ctx
    if (!ctx || !this.speaker) return
    let bytes = new Uint8Array(chunk)
    if (this.oddByte !== null) {
      const joined = new Uint8Array(bytes.length + 1)
      joined[0] = this.oddByte
      joined.set(bytes, 1)
      bytes = joined
      this.oddByte = null
    }
    if (bytes.length % 2 === 1) {
      this.oddByte = bytes[bytes.length - 1]
      bytes = bytes.subarray(0, bytes.length - 1)
    }
    if (bytes.length === 0) return

    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2)
    const buffer = ctx.createBuffer(1, pcm.length, AGENT_RATE)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.speaker)
    const startAt = Math.max(ctx.currentTime + 0.03, this.playhead)
    source.start(startAt)
    this.playhead = startAt + buffer.duration
    this.sources.add(source)
    source.onended = () => this.sources.delete(source)
  }

  private stopPlayback() {
    for (const source of this.sources) {
      try {
        source.stop()
      } catch {
        // Already stopped.
      }
    }
    this.sources.clear()
    this.playhead = 0
    this.oddByte = null
  }

  private afterPlayback(fn: () => void) {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    const remaining = this.ctx ? Math.max(0, this.playhead - this.ctx.currentTime) : 0
    this.idleTimer = setTimeout(fn, remaining * 1000 + 100)
  }

  private finishAfterPlayback() {
    if (this.phase !== 'live') return
    this.setPhase('ending')
    this.afterPlayback(() => {
      this.cleanup()
      this.setPhase('ended')
    })
  }

  private fail(message: string) {
    this.cleanup()
    this.setPhase('error', message)
  }

  private setPhase(phase: CallPhase, message?: string) {
    this.phase = phase
    this.events.phase(phase, message)
  }

  private cleanup() {
    this.streaming = false
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.stopPlayback()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    if (this.mic) this.mic.port.onmessage = null
    if (this.ws) {
      this.ws.onclose = null
      this.ws.onmessage = null
      if (this.ws.readyState <= WebSocket.OPEN) this.ws.close()
      this.ws = null
    }
    void this.ctx?.close().catch(() => {})
    this.ctx = null
  }
}
