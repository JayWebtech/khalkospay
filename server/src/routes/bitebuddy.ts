import Anthropic from '@anthropic-ai/sdk'
import { Router } from 'express'
import { prisma } from '../lib/prisma'

export const biteBuddyRouter = Router()

biteBuddyRouter.post('/analyze', async (req, res) => {
  try {
    const { image, mealType, userId } = req.body
    if (!image) {
      res.status(400).json({ message: 'No image provided' })
      return
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      const demo = { name: 'Sample Meal (Demo)', score: 65, nutrients: { calories: 450, protein: 25, carbs: 55, fat: 15, fiber: 8 } }
      res.json(demo)
      return
    }

    const client = new Anthropic({ apiKey })
    const base64 = image.replace(/^data:image\/\w+;base64,/, '')
    const mediaType = image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'

    const response = await client.messages.create({
      model: 'claude-sonnet-5-5',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: `Analyze this ${mealType || 'meal'} image. Return ONLY valid JSON with this exact structure: {"name":"meal name","score":0-100,"nutrients":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0}}. Score 80-100 = very healthy, 50-79 = moderate, 0-49 = unhealthy. Estimate realistic nutritional values.` },
        ],
      }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      res.status(500).json({ message: 'Failed to parse AI response' })
      return
    }

    const result = JSON.parse(jsonMatch[0])

    await prisma.mealLog.create({
      data: {
        userId: userId || null,
        mealType: mealType || 'unknown',
        name: result.name,
        score: result.score,
        calories: result.nutrients.calories,
        protein: result.nutrients.protein,
        carbs: result.nutrients.carbs,
        fat: result.nutrients.fat,
        fiber: result.nutrients.fiber,
      },
    })

    res.json(result)
  } catch (e) {
    console.error('BiteBuddy error:', e)
    res.status(500).json({ message: 'Failed to analyze meal' })
  }
})
