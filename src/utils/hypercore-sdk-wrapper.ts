import { Hyperliquid, SpotToken } from "hyperliquid";
import { signalOrderFailed, signalOrderFilled } from "./signals";
import { getERC20DepositTxData, getSystemAddress, MAX_PRICE_DECIMALS, MAX_SPOT_SIG_FIGS } from "./hypercore";
import { BigNumber, Wallet } from "ethers";
import { formatUnits } from "ethers/lib/utils";
import { Percent } from "@hyperswap-labs/sdk-core";

const defaultSlippage = .005;
const SPOT_POSTFIX = "-SPOT";
export const allowedPriceSlippage = new Percent(50, 10_000)

export function getSDK(pk: string) {
  return new Hyperliquid({
    enableWs: true,
    privateKey: pkOrDefault,
    // walletAddress: apiWallet, // only needed if this wallet is an API agent
  });
}

export const HYPE_NATIVE_SPOT_NAME = "HYPE-SPOT";

export interface SpotTokenExtended extends SpotToken {
  assetId: number;
  coin: string;
  midPrice: number | undefined;
  weiDecimals: number;
  evmContract?: { address: string; evm_extra_wei_decimals: number };
}

enum SwapState {
  Pending = 0,
  Delegated = 1,
  OrderPlacedUSD = 2,
  OrderPlacedOutput = 3,
  WithdrawnToFiller = 4,
  Completed = 5,
}

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

export async function delegateFundsToHyperCore(
  orderId: string,
  inputToken: SpotTokenExtended,
  inputAmountRaw: string,
  signer: Wallet
) {
  const fillerAddress = await signer.getAddress();
  console.log(
    `[${orderId}] Delegating ${inputAmountRaw} ${inputToken.name} to ${fillerAddress}`
  );

  const txData = getERC20DepositTxData(fillerAddress, inputAmountRaw, BigNumber.from(inputToken.index), inputToken.evmContract!.address)
  const gasEstimate = await signer.estimateGas({
    to: txData.to,
    from: txData.from ?? fillerAddress,
    data: txData.data,
    value: txData.value,
  })

  const gasLimit = gasEstimate.mul(110).div(100)
  const tx = await signer.sendTransaction({ ...txData, gasLimit })
  await tx.wait()

}

export async function placeLimitOrder(
  sdk: Hyperliquid,
  spotTokenInfo: SpotTokenExtended,
  isBuy: boolean,
  limitPrice: number,
  orderSize: number,
) {

  console.log(`Placing BUY USD → ${spotTokenInfo.name} @ ${limitPrice}`);
  const response = await sdk.exchange.placeOrder({
    coin: spotTokenInfo.coin,
    is_buy: isBuy,
    limit_px: limitPrice,
    sz: orderSize,
    order_type: { limit: { tif: 'Ioc' } },
    reduce_only: false,
  });

  processResponse(response)

  return response;
}

export async function inputSpotWithdrawal(sdk: Hyperliquid, spotTokenInfo: SpotTokenExtended, withdrawalAmount: string) {
  return spotWithdrawImpl(sdk, spotTokenInfo, withdrawalAmount)
}


export async function spotWithdrawal(sdk: Hyperliquid, spotTokenInfo: SpotTokenExtended, orderSize: number) {
  const withdrawalAmount = formatWithdrawalSize(orderSize, spotTokenInfo.weiDecimals)
  return spotWithdrawImpl(sdk, spotTokenInfo, withdrawalAmount)
}

async function spotWithdrawImpl(sdk: Hyperliquid, spotTokenInfo: SpotTokenExtended, withdrawalAmount: string) {
    const recipient = getSystemAddress(BigNumber.from(spotTokenInfo.index), false)
  const tokenFormat = `${spotTokenInfo.name}:${spotTokenInfo.tokenId}`

  const response = await sdk.exchange
    .spotTransfer(
      recipient,
      tokenFormat,
      withdrawalAmount
  )

  processResponse(response);
  return response
}

export function formatWithdrawalSize(
  orderSize: number,
  weiDecimals: number
): string {
  if (!isFinite(orderSize)) return String(orderSize);

  const scale = Math.pow(10, weiDecimals);

  // Truncate toward zero
  const truncated = Math.trunc(orderSize * scale) / scale;

  // Convert to string with max decimals allowed
  let s = truncated.toFixed(weiDecimals);

  // Trim trailing zeros
  s = s.replace(/\.?0+$/, "");

  return s;
}

// -----------------------------------------------------------------------------
// Main Swap Flow
// -----------------------------------------------------------------------------

export async function swapHypercore(
  sdk: Hyperliquid,
  orderId: string,
  inputToken: SpotTokenExtended,
  inputAmountRaw: string,
  inputTokenEvmDecimals: number,
  outputToken: SpotTokenExtended,
  minOutputAmountRaw: string,
  outputTokenEvmDecimals: number,
  signer: Wallet
) {
  let swapState:SwapState = SwapState.Pending;

  if(!inputToken || !outputToken || !inputToken.midPrice || !outputToken.midPrice || !inputToken.evmContract?.address || !outputToken.evmContract?.address) {
    console.log('Could not resolve swap metadata');
    return;
  }

  swapState = await executeSwap(sdk, orderId, inputToken, inputAmountRaw, inputTokenEvmDecimals, outputToken, minOutputAmountRaw, outputTokenEvmDecimals, signer)

    // 5️⃣ Signal success
  await signalOrderFilled(orderId, outputToken.evmContract.address, minOutputAmountRaw, signer);
  swapState = SwapState.Completed;

  console.log(`[${orderId}] Swap completed successfully`);
  
}

export async function getSpotInfos(sdk:Hyperliquid, inputAddress: string, outputAddress: string) {
   const tokenMetadata = await getTokensWithContracts(sdk);
   const inputToken =  tokenMetadata.mergedTokens.find(x => x.evmContract?.address.toLowerCase() == inputAddress.toLowerCase())
   const outputToken =  tokenMetadata.mergedTokens.find(x => x.evmContract?.address.toLowerCase() == outputAddress.toLowerCase())
   return [inputToken, outputToken]
}

// -----------------------------------------------------------------------------
// Token Metadata Fetcher
// -----------------------------------------------------------------------------

export async function getTokensWithContracts(sdk: Hyperliquid): Promise<{
  tokens: SpotTokenExtended[];
  mergedTokens: SpotTokenExtended[];
}> {

  try {
    const [tokenMeta, assetCtxs] = await sdk.info.spot.getSpotMetaAndAssetCtxs();

    const coins = assetCtxs.map((x: any, i: number) => ({
      assetId: i + 10000,
      coin: x.coin as string,
    }));

    const spotCoins = new Map<string, { assetId: number; coin: string }>();
    for (const c of coins) {
      spotCoins.set(c.coin, c);
    }

    const mergeToken = (t: any) => {
      const spot = spotCoins.get(`${t.name}${SPOT_POSTFIX}`);
      if (!spot) return null;
      return { ...t, ...spot } as Omit<SpotTokenExtended, "midPrice">;
    };

    const baseAllTokens = tokenMeta.tokens
      .map(mergeToken)
      .filter(Boolean) as Omit<SpotTokenExtended, "midPrice">[];

    const filtered = tokenMeta.tokens.filter(
      (t: any) => t.evmContract?.address || t.name === "HYPE"
    );

    const baseMergedTokens = filtered
      .map(mergeToken)
      .filter(Boolean) as Omit<SpotTokenExtended, "midPrice">[];

    const allMids: Record<string, string> = await sdk.info.getAllMids();

    const tokens: SpotTokenExtended[] = baseAllTokens.map((t) => ({
      ...t,
      midPrice: allMids[t.coin] ? parseFloat(allMids[t.coin]) : undefined,
    }));

    const mergedTokens: SpotTokenExtended[] = baseMergedTokens.map((t) => ({
      ...t,
      midPrice: allMids[t.coin] ? parseFloat(allMids[t.coin]) : undefined,
    }));

    return { tokens, mergedTokens };
  } catch (error) {
    console.error("Failed to fetch data:", error);
    return { tokens: [], mergedTokens: [] };
  }
}

export async function executeSwap(sdk: Hyperliquid, orderId: string, 
  inputToken: SpotTokenExtended, inputAmountRaw: string, inputTokenDecimals:number, 
  outputToken: SpotTokenExtended, ouputAmountRaw: string, outputTokenDecimals: number,
  signer: Wallet): Promise<SwapState> {
    let swapState = SwapState.Pending;
    if(!inputToken || !outputToken || !inputToken.midPrice || !outputToken.midPrice || !inputToken.evmContract?.address) {
      console.log('Could not resolve swap metadata');
      return swapState;
    }

    //await delegateFundsToHyperCore(orderId, inputToken, inputAmountRaw, signer);
    swapState = SwapState.Delegated;

    try {
      const inputIsBuy = false
      const inputPriceLimit = calculatePriceWithSlippage(inputToken, defaultSlippage, inputIsBuy)
      const inputSize = calculateSize(inputAmountRaw, inputIsBuy, inputTokenDecimals, inputToken.szDecimals)
      await placeLimitOrder(sdk, inputToken, inputIsBuy, inputPriceLimit, inputSize)
      swapState = SwapState.OrderPlacedUSD;

      const outputIsBuy = true;
      const outputPriceLimit = calculatePriceWithSlippage(outputToken, defaultSlippage, outputIsBuy)
      const outputSize = calculateSize(ouputAmountRaw, outputIsBuy, outputTokenDecimals, outputToken.szDecimals)
      await placeLimitOrder(sdk, outputToken, outputIsBuy, outputPriceLimit, outputSize);
      swapState = SwapState.OrderPlacedOutput;

      await spotWithdrawal(sdk, outputToken, outputSize)
      swapState = SwapState.WithdrawnToFiller;

    } catch (error) {
      processErrors(sdk, orderId, 
          inputToken, inputAmountRaw, inputTokenDecimals, 
          outputToken,  
          swapState, signer);
    }

    return swapState;
}

async function processErrors(sdk: Hyperliquid, 
  orderId: string, 
  inputToken: SpotTokenExtended, inputAmountRaw: string, inputTokenDecimals: number,
  outputToken: SpotTokenExtended, swapState: SwapState, signer: Wallet) {
  
  try {
    if(swapState == SwapState.Delegated) {

      const withdrawalAmountFormatted = inputAmountRaw
      await inputSpotWithdrawal(sdk, inputToken, withdrawalAmountFormatted)

      const inputEvmAmount = convertHCToEvmAmount(withdrawalAmountFormatted, inputToken.weiDecimals, inputTokenDecimals)
      await signalOrderFailed(orderId, inputToken.evmContract!.address, inputEvmAmount, signer);
    }
    if(swapState == SwapState.OrderPlacedUSD) {

    }
    if(swapState == SwapState.OrderPlacedOutput) {

    }
  } catch(error) {
    throw new Error("Fatal: Could not resolve order")
  }
}

function convertHCToEvmAmount(withdrawalAmountFormatted: string, weiDecimals: number, inputEvmDecimal:number): string {
  throw new Error('Not Implemented')
}

interface ApiResponse<T = any> {
  status: string;
  response?: {
    type?: string;
    data?: {
      statuses?: { error?: string }[];
    };
  };
}

/**
 * Standardizes how API responses are checked and throws if any error is detected.
 */
export function processResponse<T = any>(resp: ApiResponse<T>): T {
    console.log(JSON.stringify(resp));
  // Check top-level status
  if (resp.status !== "ok") {
    throw new Error(`API status not ok: ${JSON.stringify(resp)}`);
  }

  // Check nested error messages
  const error =
    resp.response?.data?.statuses?.find((s) => s.error)?.error;

  if (error) {
    throw new Error(error);
  }

  // Return response data if everything’s fine
  return resp.response as T;
}


function getMaxSpotSigFigs(spotTokenInfo: SpotTokenExtended) {
    return Math.min(MAX_SPOT_SIG_FIGS, MAX_PRICE_DECIMALS - spotTokenInfo.szDecimals) 
}

function calculatePriceWithSlippage(spotTokenInfo: SpotTokenExtended, slippage: number, isBuy: boolean) {
    // slippage is decimal, e.g. 0.1 = 10%
    const s = slippage;

    // BUY → price goes UP (willing to pay more)
    // SELL → price goes DOWN (willing to accept less)
    const factor = isBuy ? (1 + s) : (1 - s);

    const midPrice = spotTokenInfo.midPrice!;
    const adjusted = midPrice * factor;

    const maxSigFigs = getMaxSpotSigFigs(spotTokenInfo);
    return formatPriceWithSigFigs(adjusted, maxSigFigs, isBuy)

}

export function formatPriceWithSigFigs(
  price: number,
  sigFigs: number,
  isBuy: boolean
): number {
  if (!isFinite(price))  {
    return price;
  }

  if (Number.isInteger(price)) {
    return price;
  }

  const absPrice = Math.abs(price);

  // Determine how many digits are in the integer part
  // Example: price = 12345.1 → magnitude = 4 → integerDigits = 5
  const magnitude = Math.floor(Math.log10(absPrice));
  const integerDigits = magnitude + 1;

  // If the integer part alone already meets or exceeds sig figs,
  // no decimals are allowed — round to an integer.
  if (integerDigits >= sigFigs) {
    return isBuy ? Math.ceil(price) : Math.floor(price);
  }

  const decimalsAllowed = sigFigs - integerDigits;
  const scale = Math.pow(10, decimalsAllowed);

  let adjusted: number;
  if (isBuy) {
    // BUY = round UP (ceil)
    adjusted = Math.ceil(price * scale) / scale;
  } else {
    // SELL = round DOWN (floor)
    adjusted = Math.floor(price * scale) / scale;
  }

  // Ensure proper number of decimal places (no scientific notation)
  return Number(adjusted.toFixed(decimalsAllowed));
}


export function calculateSize(
  rawAmount: string,
  isBuy: boolean,
  tokenDecimals: number,
  szDecimals: number
): number {
  // Convert raw amount into human-readable float
  const human = Number(formatUnits(rawAmount, tokenDecimals));

  // If no decimals allowed at all
  if (szDecimals === 0) {
    return isBuy ? Math.ceil(human) : Math.floor(human);
  }

  // Determine scaling for allowed decimals
  const scale = Math.pow(10, szDecimals);

  let adjusted: number;
  if (isBuy) {
    // BUY = round UP
    adjusted = Math.ceil(human * scale) / scale;
  } else {
    // SELL = round DOWN
    adjusted = Math.floor(human * scale) / scale;
  }

  // Ensure output has correct decimal precision
  return Number(adjusted.toFixed(szDecimals));
}
