import { Router } from 'express'

const router = Router()

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || ''
const NIM_TO_NGN_RATE = 2.5

router.post('/transcribe', async (req, res) => {
  try {
    if (!DEEPGRAM_API_KEY) {
      res.json({ transcript: 'I want to offramp 100 NIM to my GTBank account 0123456789' })
      return
    }

    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', async () => {
      const audioBuffer = Buffer.concat(chunks)

      const dgRes = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&language=en', {
        method: 'POST',
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/webm',
        },
        body: audioBuffer,
      })

      const data = await dgRes.json() as { results?: { channels: Array<{ alternatives: Array<{ transcript: string }> }> } }
      const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || ''
      res.json({ transcript })
    })
  }
  catch (err) {
    console.error('Transcription error:', err)
    res.status(500).json({ message: 'Transcription failed' })
  }
})

router.post('/chat', async (req, res) => {
  const { message, history, walletAddress } = req.body

  if (!message) {
    res.status(400).json({ message: 'Message is required' })
    return
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      const lower = message.toLowerCase()
      if (lower.includes('offramp') || lower.includes('off-ramp') || lower.includes('convert') || lower.includes('send')) {
        const amountMatch = message.match(/(\d+)\s*nim/i)
        const amount = amountMatch ? parseInt(amountMatch[1]) : 0

        if (amount > 0) {
          res.json({
            reply: `I'll help you off-ramp ${amount} NIM (${amount * NIM_TO_NGN_RATE} NGN). Which bank should I send to? (Demo mode - no API key configured)`,
            action: null,
          })
          return
        }
      }

      res.json({
        reply: 'I can help you off-ramp NIM to Naira. Tell me the amount (e.g., "off-ramp 100 NIM"), your bank name, and account number. (Demo mode)',
        action: null,
      })
      return
    }

    const systemPrompt = `You are KhalkosPay's voice assistant helping users off-ramp NIM tokens to Nigerian Naira.
Current exchange rate: 1 NIM = ${NIM_TO_NGN_RATE} NGN.
User wallet: ${walletAddress || 'not connected'}

Your role:
1. Help users specify: amount of NIM, bank name, account number, account name
2. Once you have ALL details, respond with a JSON action block

When you have all details, include this exact JSON at the END of your response on its own line:
ACTION:{"action":"execute_offramp","params":{"amount":NUMBER,"ngnAmount":NUMBER,"bankName":"STRING","accountNumber":"STRING","accountName":"STRING"}}

Supported banks: Access Bank, First Bank, GTBank, UBA, Zenith Bank, Kuda, Opay, Palmpay, Moniepoint, Wema Bank, Stanbic IBTC, Sterling Bank, Fidelity Bank, FCMB, Union Bank.

Be concise and conversational. Ask for missing details one at a time.`

    const messages = [
      ...(history || []).map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: message },
    ]

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: systemPrompt,
        messages,
      }),
    })

    const data = await response.json() as { content: Array<{ text: string }> }
    const reply = data.content?.[0]?.text || 'Sorry, could you try again?'

    const actionMatch = reply.match(/ACTION:({.*})/)
    let action = null
    let params = null
    let cleanReply = reply

    if (actionMatch) {
      try {
        const parsed = JSON.parse(actionMatch[1])
        action = parsed.action
        params = parsed.params
        cleanReply = reply.replace(/ACTION:.*$/, '').trim()
      }
      catch { /* ignore parse errors */ }
    }

    res.json({ reply: cleanReply, action, params })
  }
  catch (err) {
    console.error('Chat error:', err)
    res.status(500).json({ message: 'Chat failed' })
  }
})

export { router as voiceRoutes }
