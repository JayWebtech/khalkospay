import { Router } from 'express'

const router = Router()

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''

router.post('/analyze', async (req, res) => {
  const { image, mealType } = req.body

  if (!image) {
    res.status(400).json({ message: 'Image is required' })
    return
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      const demoMeals: Record<string, { name: string; score: number; nutrients: { calories: number; protein: number; carbs: number; fat: number; fiber: number } }> = {
        breakfast: { name: 'Oatmeal with Fruits', score: 82, nutrients: { calories: 350, protein: 12, carbs: 55, fat: 8, fiber: 9 } },
        lunch: { name: 'Grilled Chicken & Rice', score: 75, nutrients: { calories: 550, protein: 35, carbs: 60, fat: 15, fiber: 6 } },
        dinner: { name: 'Vegetable Stir Fry', score: 78, nutrients: { calories: 400, protein: 18, carbs: 45, fat: 12, fiber: 10 } },
      }
      const meal = demoMeals[mealType] || demoMeals.lunch
      res.json(meal)
      return
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '')
    const mediaType = image.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/jpeg'

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data },
            },
            {
              type: 'text',
              text: `Analyze this ${mealType} meal photo. Respond ONLY with valid JSON (no markdown, no code fences):
{"name": "meal name", "score": 0-100 health score, "nutrients": {"calories": number, "protein": grams, "carbs": grams, "fat": grams, "fiber": grams}}
Score guidelines: 80+ for whole foods rich in nutrients, 50-79 for balanced but processed, below 50 for junk food.`,
            },
          ],
        }],
      }),
    })

    const data = await response.json() as { content: Array<{ type: string; text: string }> }
    const text = data.content?.[0]?.text || ''
    const parsed = JSON.parse(text)

    res.json({
      name: parsed.name || 'Unknown Meal',
      score: Math.max(0, Math.min(100, parsed.score || 50)),
      nutrients: {
        calories: parsed.nutrients?.calories || 0,
        protein: parsed.nutrients?.protein || 0,
        carbs: parsed.nutrients?.carbs || 0,
        fat: parsed.nutrients?.fat || 0,
        fiber: parsed.nutrients?.fiber || 0,
      },
    })
  }
  catch (err) {
    console.error('Analysis error:', err)
    res.json({
      name: 'Meal (analysis failed)',
      score: 50,
      nutrients: { calories: 400, protein: 20, carbs: 50, fat: 15, fiber: 5 },
    })
  }
})

export { router as biteBuddyRoutes }
