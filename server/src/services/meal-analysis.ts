import Anthropic from '@anthropic-ai/sdk'
import { MealSlot } from '@prisma/client'
import { config } from '../config'
import { HttpError } from '../lib/http-error'

export interface MealAnalysis {
  name: string
  score: number
  nutrients: { calories: number; protein: number; carbs: number; fat: number; fiber: number }
}

const DEMO: MealAnalysis = { name: 'Sample Meal (Demo)', score: 65, nutrients: { calories: 450, protein: 25, carbs: 55, fat: 15, fiber: 8 } }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0)

export async function analyzeMeal(image: string, slot: MealSlot): Promise<MealAnalysis> {
  if (!config.anthropicApiKey) return DEMO

  const client = new Anthropic({ apiKey: config.anthropicApiKey })
  const base64 = image.replace(/^data:image\/\w+;base64,/, '')
  const mediaType = image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
  const response = await client.messages.create({
    model: 'claude-sonnet-5-5',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          {
            type: 'text',
            text: `Analyze this ${slot.toLowerCase()} image. Return ONLY valid JSON with this exact structure: {"name":"meal name","score":0-100,"nutrients":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0}}. Score 80-100 = very healthy, 50-79 = moderate, 0-49 = unhealthy. If the photo shows no food, use score 0 and name "Not a meal". Estimate realistic nutritional values.`,
          },
        ],
      },
    ],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
  const json = text.match(/\{[\s\S]*\}/)
  if (!json) throw new HttpError(502, "We couldn't read that meal. Try another photo.", 'ANALYSIS_FAILED')
  try {
    const parsed = JSON.parse(json[0]) as Partial<MealAnalysis>
    return {
      name: String(parsed.name || 'Meal').slice(0, 80),
      score: Math.round(Math.min(100, num(parsed.score))),
      nutrients: {
        calories: num(parsed.nutrients?.calories),
        protein: num(parsed.nutrients?.protein),
        carbs: num(parsed.nutrients?.carbs),
        fat: num(parsed.nutrients?.fat),
        fiber: num(parsed.nutrients?.fiber),
      },
    }
  } catch {
    throw new HttpError(502, "We couldn't read that meal. Try another photo.", 'ANALYSIS_FAILED')
  }
}
