import { BigNumber, ethers } from 'ethers';
import {
  AlphaRouter,
  NATIVE_NAMES_BY_ID,
  nativeOnChain,
  SwapType,
} from '@uniswap/smart-order-router';
import {
  ChainId,
  Currency,
  CurrencyAmount,
  Percent,
  SWAP_ROUTER_02_ADDRESSES,
  Token,
  TradeType,
} from '@uniswap/sdk-core';
import * as dotenv from 'dotenv';
import { Protocol, SwapRouter as SwapRouter02 } from '@uniswap/router-sdk';
import express from 'express';
import cors from 'cors';
import { serializeRoute } from './utils/routeSerializer';

dotenv.config();

const RPC_URL_MAP: { [chainId: number]: string } = {
  [ChainId.HYPEREVM]: process.env.RPC_URL_HYPEREVM || 'https://rpc.hyperliquid.xyz/evm',
  [ChainId.HYPEREVM_TESTNET]: 'https://rpc.hyperliquid-testnet.xyz/evm',
};

// Global router cache to maintain state between requests
const routerCache: { [chainId: number]: AlphaRouter } = {};

function initializeRouters() {
  Object.entries(RPC_URL_MAP).forEach(([chainId, rpcUrl]) => {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    routerCache[parseInt(chainId)] = new AlphaRouter({
      chainId: parseInt(chainId),
      provider,
    });
  });
}

initializeRouters();

async function executeSmartOrderRouterSwap(
  inputCurrencyAmount: CurrencyAmount<Currency>,
  output: Currency,
  recipient: string,
  slippageTolerance: Percent,
  deadline: number,
  isExactIn: boolean,
) {
  if (!recipient || !ethers.utils.isAddress(recipient) || recipient === ethers.constants.AddressZero) {
    throw new Error('❌ Invalid recipient');
  }

  const chainId = output.chainId;
  const router = routerCache[chainId];
  if (!router) throw new Error(`❌ No router found for chainId: ${chainId}`);

  const route = await router.route(
    inputCurrencyAmount,
    output,
    isExactIn ? TradeType.EXACT_INPUT : TradeType.EXACT_OUTPUT,
    {
      type: SwapType.SWAP_ROUTER_02,
      recipient,
      slippageTolerance,
      deadline,
    },
    { protocols: [Protocol.MIXED, Protocol.V2, Protocol.V3] },
  );

  if (!route || !route.trade) return;

  const swapRouterAddress = SWAP_ROUTER_02_ADDRESSES(chainId);
  if (!swapRouterAddress) return;

  const { calldata, value } = SwapRouter02.swapCallParameters(route.trade, {
    recipient,
    slippageTolerance,
    deadlineOrPreviousBlockhash: deadline,
    inputTokenPermit: undefined,
  });

  return {
    recipient,
    bestPath: {
      input: route.trade.inputAmount.quotient.toString(),
      output: route.trade.outputAmount.quotient.toString(),
      calldata,
      value,
      route: serializeRoute(route.trade.routes[0]),
      swapRouterAddress,
    },
  };
}

function getTokenOrNative(
  chainId: ChainId,
  address: string,
  symbol: string,
  decimals: number = 18,
): Currency {
  return NATIVE_NAMES_BY_ID[chainId]?.includes(address)
    ? nativeOnChain(chainId)
    : new Token(chainId, address, decimals, symbol);
}

function parseSwapParams(source: any) {
  const {
    inputTokenAddress,
    outputTokenAddress,
    inputTokenDecimals = '18',
    outputTokenDecimals = '18',
    inputTokenSymbol = 'INPUT',
    outputTokenSymbol = 'OUTPUT',
    amountIn,
    recipient,
    slippageTolerance = '50',
    deadlineMinutes = '20',
    chainId = ChainId.HYPEREVM.toString(),
    isExactIn = true,
  } = source;

  if (!inputTokenAddress || !outputTokenAddress || !amountIn || !recipient) {
    throw new Error(
      'Missing required parameters: inputTokenAddress, outputTokenAddress, amountIn, recipient',
    );
  }

  if (!ethers.utils.isAddress(recipient)) {
    throw new Error('Invalid recipient address');
  }

  const numericChainId = parseInt(chainId);
  const inputDecimals = parseInt(inputTokenDecimals);
  const outputDecimals = parseInt(outputTokenDecimals);
  const slippage = new Percent(slippageTolerance.toString(), '10000');
  const deadline =
    Math.floor(Date.now() / 1000) + 60 * parseInt(deadlineMinutes);

  const inputCurrency = getTokenOrNative(
    numericChainId,
    inputTokenAddress,
    inputTokenSymbol,
    inputDecimals,
  );
  const outputCurrency = getTokenOrNative(
    numericChainId,
    outputTokenAddress,
    outputTokenSymbol,
    outputDecimals,
  );
  const inputCurrencyAmount = CurrencyAmount.fromRawAmount(
    inputCurrency,
    amountIn.toString(),
  );

  const isExactInBool =
    typeof isExactIn === 'string'
      ? isExactIn.toLowerCase() === 'true' || isExactIn === '1'
      : Boolean(isExactIn);

  return {
    inputCurrencyAmount,
    outputCurrency,
    recipient,
    slippage,
    deadline,
    isExactIn: isExactInBool,
  };
}

async function handleSignalRequest(source: any, res: express.Response) {

  const { userAddress } = source;
}

async function handleSwapRequest(source: any, res: express.Response) {
  try {
    const {
      inputCurrencyAmount,
      outputCurrency,
      recipient,
      slippage,
      deadline,
      isExactIn,
    } = parseSwapParams(source);

    const result = await executeSmartOrderRouterSwap(
      inputCurrencyAmount,
      outputCurrency,
      recipient,
      slippage,
      deadline,
      isExactIn,
    );

    if (!result) {
      return res.status(404).json({ error: 'No route found' });
    }

    res.json(result);
  } catch (err: any) {
    console.error('Swap error:', err);
    res.status(400).json({ error: err.message || 'Unknown error' });
  }
}

const app = express();
app.use(express.json());
app.use(cors());

app.get('/swap', async (req, res) => {
  await handleSwapRequest(req.query, res);
});

app.post('/swap', async (req, res) => {
  await handleSwapRequest(req.body, res);
});

app.post('/signal', async (req, res) => {
  await handleSignalRequest(req.body, res);
})

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
  console.log(`POST /swap and GET /swap endpoints available`);
});


