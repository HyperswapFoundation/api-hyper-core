import { ethers } from 'ethers'
import * as dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import { fillOrder } from './utils/fillOrder'
import { parseFillOrderRequest } from './utils/parseFillOrderRequest'
import type { Request, Response, NextFunction } from 'express'
import { SwapRouter02ExecutorAddress } from './constants'
import { fillOrderHC } from './utils/fillOrderHC'
import { getSDK } from './utils/hypercore-sdk-wrapper'

dotenv.config()

// ---- Config ----
const CHAIN_ID = 999
const RPC_URL = process.env.RPC_URL_HYPEREVM || 'https://rpc.hyperliquid.xyz/evm'
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3009
const LOCAL_MODE = process.env.LOCAL_MODE === 'true'

// ---- Provider ----
const provider = new ethers.providers.JsonRpcProvider(RPC_URL, CHAIN_ID)

// ---- Signers ----
const pkList = (process.env.SIGNER_PRIVATE_KEY_MAP || '')
  .split(',')
  .map((pk) => pk.trim())
  .filter(Boolean)

if (pkList.length === 0) throw new Error('No private keys in SIGNER_PRIVATE_KEY_MAP')

function getNextSigner() {
  const randomIndex = Math.floor(Math.random() * pkList.length)
  const pk = pkList[randomIndex]
  return { wallet: new ethers.Wallet(pk, provider), pk }
}

// ---- Express App ----
const app = express()

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }))
app.use(express.json())

app.use((req: Request, res: Response, next: NextFunction): void => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.status(204).end()
    return
  }
  next()
})

// ---- Health Check ----
app.get('/', (_req, res) => {
  res.send(`
    <html>
      <head><title>Hypercore Router API</title></head>
      <body style="font-family: monospace; padding: 2rem; background: #0f0f0f; color: #00ff90;">
        <h2>✅ Hypercore Router API is live</h2>
        <p>Chain ID: ${CHAIN_ID}</p>
        <p>RPC URL: ${RPC_URL}</p>
        <p>Available endpoints:</p>
        <ul>
          <li><strong>GET /quote</strong></li>
          <li><strong>POST /fill-order</strong></li>
          <li><strong>POST /fill-order-hc</strong></li>
        </ul>
        <p>Filler Address: ${SwapRouter02ExecutorAddress}</p>
      </body>
    </html>
  `)
})

app.get('/quote', async (req, res) => {

})

// ---- API Routes ----
app.post('/fill-order', async (req, res) => {
  try {
    const parsed = parseFillOrderRequest(req.body)
    const signer = getNextSigner().wallet
    const receipt = await fillOrder(
      signer,
      parsed.dutchOrder,
      parsed.account,
      parsed.tokenInAddress,
      parsed.tokenOutAddress,
      parsed.signature,
      parsed.orderMulticallData
    )

    res.json({ status: 'ok', txHash: receipt })
  } catch (err: any) {
    console.error('fill-order error:', err)
    res.status(400).json({ error: err.message })
  }
})

app.post('/fill-order-hc', async (req, res) => {
  try {
    const parsed = parseFillOrderRequest(req.body)
    const signerMeta  = getNextSigner()
    const signer = signerMeta.wallet
    const sdk = getSDK(signerMeta.pk);
    const receipt = await fillOrderHC(
      sdk,
      signer,
      parsed.dutchOrder,
      parsed.tokenInAddress,
      parsed.tokenInDecimals,
      parsed.tokenOutAddress,
      parsed.tokenOutDecimals,
      parsed.signature
    )

    res.json({ status: 'ok', txHash: receipt })
  } catch (err: any) {
    console.error('fill-order-hc error:', err)
    res.status(400).json({ error: err.message })
  }
})

if (LOCAL_MODE || process.env.NODE_ENV === 'development') {
  app.listen(PORT, () => {
    console.log(`🚀 Local Hypercore Router running on http://localhost:${PORT}`)
    console.log(`→ Chain ID: ${CHAIN_ID}`)
    console.log(`→ RPC URL: ${RPC_URL}`)
  })
}

export default app
