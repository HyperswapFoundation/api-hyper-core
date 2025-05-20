import { ethers } from 'ethers'
import * as dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import { UserProxyFactory__factory } from './hypercore/types'
import { USER_PROXY_FACTORY_ADDRESS } from './constants'

dotenv.config()

// ---- Config ----
const CHAIN_ID = 999
const CHUNK_SIZE = parseInt(process.env.INTENT_CHUNK_SIZE || '10', 10)
const RPC_URL_MAP: { [chainId: number]: string } = {
  999: process.env.RPC_URL_HYPEREVM || 'https://rpc.hyperliquid.xyz/evm',
}

// ---- Provider ----
function getProvider(chainId: number) {
  const rpcUrl = RPC_URL_MAP[chainId]
  if (!rpcUrl) throw new Error(`Unsupported chainId: ${chainId}`)

  if (rpcUrl.startsWith('ws')) {
    const wsProvider = new ethers.providers.WebSocketProvider(rpcUrl, chainId)
    wsProvider._websocket.on('close', () => {
      console.error('[Provider] WebSocket closed, attempting reconnect...')
      setTimeout(() => getProvider(chainId), 5000)
    })
    return wsProvider
  }
  return new ethers.providers.JsonRpcProvider(rpcUrl, chainId)
}

const provider = getProvider(CHAIN_ID)

// ---- Signers + Factories ----
function getSignerFactoryPairs(chainId: number) {
  const rpcUrl = RPC_URL_MAP[chainId]
  if (!rpcUrl) throw new Error(`Unsupported chainId: ${chainId}`)

  const pkList = (process.env.SIGNER_PRIVATE_KEY_MAP || '')
    .split(',')
    .map((pk) => pk.trim())
    .filter(Boolean)

  if (pkList.length === 0) throw new Error('No private keys in SIGNER_PRIVATE_KEY_MAP')

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl, chainId)

  return pkList.map((pk) => {
    const wallet = new ethers.Wallet(pk, provider)
    const factory = UserProxyFactory__factory.connect(
      USER_PROXY_FACTORY_ADDRESS,
      wallet
    )
    return { wallet, factory }
  })
}

const SIGNER_FACTORY_PAIRS = getSignerFactoryPairs(CHAIN_ID)

// ---- Intent State ----
const INTENT_MAP: Map<string, number> = new Map()
let signerIndex = 0

function getNextFactory() {
  const { factory } = SIGNER_FACTORY_PAIRS[signerIndex]
  signerIndex = (signerIndex + 1) % SIGNER_FACTORY_PAIRS.length
  return factory
}

// ---- Queue Processor ----
async function processQueue() {
  if (INTENT_MAP.size === 0) return

  console.log('starting to execute issue intents')
  const users = Array.from(INTENT_MAP.keys()).slice(0, CHUNK_SIZE)

  const snapshot: Record<string, number> = {}
  for (const user of users) {
    const count = INTENT_MAP.get(user)
    if (count !== undefined) {
      snapshot[user] = count
      INTENT_MAP.delete(user)
    }
  }

  const factory = getNextFactory()

  try {
    const tx = await factory.estimateGas.executeIntent(users)
      .then(gasLimit => gasLimit.mul(120).div(100))
      .then(gasLimit => factory.executeIntent(users, { 
        gasLimit
      }))
    const receipt = await tx.wait()

    console.log(
      `[Queue] Executed intents for ${users.join(', ')} in block ${receipt.blockNumber}`
    )

    for (const user of users) {
      const remaining = snapshot[user] - 1
      if (remaining > 0) {
        INTENT_MAP.set(user, remaining)
      }
    }
  } catch (err) {
    console.error('[Queue] executeIntent failed:', err)

    // restore snapshot
    for (const user of users) {
      INTENT_MAP.set(user, snapshot[user])
    }
  }
}

// ---- API Handlers ----
async function handleSignalRequest(source: any, res: express.Response) {
  try {
    const { userAddress, numberOfCalls } = source;
    if (!userAddress) throw new Error('Missing userAddress');
    if (!numberOfCalls) throw new Error('Missing numberOfCalls');

    INTENT_MAP.set(userAddress, numberOfCalls);
    console.log(
      `intent registered user=${userAddress} calls=${numberOfCalls}`
    );

    res.json({ ok: true });
  } catch (err: any) {
    console.error('handleSignalRequest error:', err);
    res.status(500).json({ error: err.message });
  }
}

// ---- Replace the block listener with a timer ----
let isRunning = false;

setInterval(async () => {
  if (isRunning) return; // prevent overlapping runs
  isRunning = true;
  try {
    await processQueue();
  } catch (e) {
    console.error('[processQueue] tick error:', e);
  } finally {
    isRunning = false;
  }
}, 1000);


// ---- Express App ----
const app = express()
app.use(express.json())
app.use(cors())

app.post('/signal', async (req: any, res: express.Response) => {
  await handleSignalRequest(req.body, res)
})

const port = process.env.PORT || 3009
app.listen(port, () => {
  console.log(`API server listening on port ${port}`)
  console.log(`POST /signal endpoint available`)
})
