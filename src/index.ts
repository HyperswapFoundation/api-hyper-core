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

let signerIndex = 0
function getNextSigner() {
  const pk = pkList[signerIndex]
  signerIndex = (signerIndex + 1) % pkList.length
  return new ethers.Wallet(pk, provider)
}

// ---- Handlers ----
async function handleFillOrderRequest(source: any, res: express.Response) {
  try {
    const parsed = parseFillOrderRequest(source)
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
    console.error('handleFillOrderRequest error:', err)
    res.status(400).json({ error: err.message })
  }
}

// ---- Express App ----
const app = express()
app.use(express.json())
app.use(cors())

app.post('/fill-order', async (req, res) => {
  await handleFillOrderRequest(req.body, res)
})

const port = process.env.PORT || 3009
app.listen(port, () => {
  console.log(`API server listening on port ${port}`)
  console.log(`POST /fill-order endpoint ready`)
})
