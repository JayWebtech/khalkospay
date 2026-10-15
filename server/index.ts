import cors from 'cors'
import express from 'express'
import { giftCardRoutes } from './routes/giftcards.js'
import { offrampRoutes } from './routes/offramp.js'
import { voiceRoutes } from './routes/voice.js'
import { biteBuddyRoutes } from './routes/bitebuddy.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.use('/api/offramp', offrampRoutes)
app.use('/api/giftcards', giftCardRoutes)
app.use('/api/voice', voiceRoutes)
app.use('/api/bitebuddy', biteBuddyRoutes)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`KhalkosPay server running on port ${PORT}`)
})
