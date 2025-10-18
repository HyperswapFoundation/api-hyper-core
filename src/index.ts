import { ethers } from 'ethers'
import * as dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import { fillOrder } from './utils/fillOrder'
import { parseFillOrderRequest } from './utils/parseFillOrderRequest'

dotenv.config()

// ---- Config ----
const CHAIN_ID = 999
const RPC_URL = process.env.RPC_URL_HYPEREVM || 'https://rpc.hyperliquid.xyz/evm'

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
  return new ethers.Wallet(pk, provider)
}

// ---- Express App ----
const app = express()

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }))
app.options('*', cors())
app.use(express.json())

// ---- Health Check / Visual Status Endpoint ----
app.get('/', (_req, res) => {
  res.send(`
    <html>
      <head><title>Hypercore Router API</title></head>
      <body style="font-family: monospace; padding: 2rem; background: #0f0f0f; color: #00ff90;">
        <h2>✅ Hypercore Router API is live</h2>
        <p>Chain ID: ${CHAIN_ID}</p>
        <p>RPC URL: ${RPC_URL}</p>
        <p>Available endpoint: <strong>POST /fill-order</strong></p>
      </body>
    </html>
  `)
})

// ---- Main Endpoint ----
app.post('/fill-order', async (req, res) => {
  try {
    const parsed = parseFillOrderRequest(req.body)
    const signer = getNextSigner()
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

// ✅ Export app for Vercel
export default app
