import { Router } from 'express'

const router = Router()

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || ''

const bankCodes: Record<string, string> = {
  'Access Bank': '044',
  'First Bank': '011',
  'GTBank': '058',
  'UBA': '033',
  'Zenith Bank': '057',
  'Kuda': '50211',
  'Opay': '999992',
  'Palmpay': '999991',
  'Moniepoint': '50515',
  'Wema Bank': '035',
  'Stanbic IBTC': '221',
  'Sterling Bank': '232',
  'Fidelity Bank': '070',
  'FCMB': '214',
  'Union Bank': '032',
}

router.post('/', async (req, res) => {
  const { txHash, nimAmount, ngnAmount, bankCode, accountNumber, accountName, senderAddress } = req.body

  if (!txHash || !nimAmount || !ngnAmount || !bankCode || !accountNumber || !accountName) {
    res.status(400).json({ message: 'Missing required fields' })
    return
  }

  try {
    const paystackBankCode = bankCodes[bankCode]
    if (!paystackBankCode) {
      res.status(400).json({ message: 'Unsupported bank' })
      return
    }

    if (!PAYSTACK_SECRET) {
      console.log('DEMO MODE: Offramp processed', { txHash, nimAmount, ngnAmount, bankCode, accountNumber })
      res.json({
        success: true,
        message: 'Off-ramp processed (demo mode)',
        reference: `DEMO-${Date.now()}`,
      })
      return
    }

    const recipientRes = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'nuban',
        name: accountName,
        account_number: accountNumber,
        bank_code: paystackBankCode,
        currency: 'NGN',
      }),
    })

    const recipientData = await recipientRes.json() as { status: boolean; data: { recipient_code: string }; message: string }
    if (!recipientData.status) {
      res.status(400).json({ message: recipientData.message || 'Failed to create recipient' })
      return
    }

    const transferRes = await fetch('https://api.paystack.co/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(ngnAmount * 100),
        recipient: recipientData.data.recipient_code,
        reason: `KhalkosPay offramp: ${nimAmount} NIM - tx:${txHash}`,
      }),
    })

    const transferData = await transferRes.json() as { status: boolean; data: { reference: string; transfer_code: string }; message: string }
    if (!transferData.status) {
      res.status(400).json({ message: transferData.message || 'Transfer failed' })
      return
    }

    res.json({
      success: true,
      reference: transferData.data.reference,
      transferCode: transferData.data.transfer_code,
    })
  }
  catch (err) {
    console.error('Offramp error:', err)
    res.status(500).json({ message: 'Internal server error' })
  }
})

export { router as offrampRoutes }
