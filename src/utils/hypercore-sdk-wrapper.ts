import { Hyperliquid, SpotToken } from "hyperliquid";
import { encodeAndSendCoreAction } from "./hypercore";
import { signalOrderFailed, signalOrderFilled } from "./signals";

const apiPrivateKey = process.env.API_PRIVATE_KEY!;
const apiWallet = process.env.API_WALLET_ADDRESS!;
const SPOT_POSTFIX = "-SPOT";

function getSDK() {
  return new Hyperliquid({
    enableWs: true,
    privateKey: apiPrivateKey,
    walletAddress: apiWallet, // only needed if this wallet is an API agent
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

async function delegateFundsToHyperCore(
  orderId: string,
  inputToken: SpotTokenExtended,
  inputAmountRaw: string,
  fillerAddress: string
) {
  console.log(
    `[${orderId}] Delegating ${inputAmountRaw} ${inputToken.name} to ${fillerAddress}`
  );

  await encodeAndSendCoreAction({
    actionId: 6, // Spot send
    from: apiWallet,
    to: fillerAddress,
    tokenIndex: inputToken.assetId,
    amount: inputAmountRaw,
  });
}

async function placeLimitOrderToUsd(
  inputToken: SpotTokenExtended,
  inputAmountRaw: string
) {
  const sdk = getSDK();
  const market = `${inputToken.coin}-USD`;
  const price = await sdk.info.getMidPrice(market);
  const limitPrice = price * 0.99; // slight discount to ensure fill

  console.log(`Placing SELL ${inputToken.name} → USD @ ${limitPrice}`);

  return sdk.exchange.placeOrder({
    coin: inputToken.coin,
    is_buy: false,
    limit_px: limitPrice,
    order_type: { limit: { tif: 'Ioc' } },
    reduce_only: false,
    sz: parseFloat(inputAmountRaw),
    cloid: `${market}-TO-USD-${Date.now()}`,
  });
}

async function placeLimitOrderToOutput(
  outputToken: SpotTokenExtended,
  minOutputAmountRaw: string
) {
  const sdk = getSDK();
  const market = `${outputToken.coin}-USD`;
  const price = await sdk.info.getMidPrice(market);
  const limitPrice = price * 1.01; // slight premium to ensure buy

  console.log(`Placing BUY USD → ${outputToken.name} @ ${limitPrice}`);
  return sdk.exchange.placeOrder({
    coin: outputToken.coin,
    is_buy: true,
    limit_px: limitPrice,
    sz: parseFloat(minOutputAmountRaw),
    cloid: `USD-TO-${market}-${Date.now()}`,
    order_type: { limit: { tif: 'Ioc' } },
    reduce_only: false,
  });
}

async function placeLimitOrderToInput(inputToken: SpotTokenExtended, priceLimit: string, amountUsd: number) {
  const sdk = getSDK();
  const market = `${inputToken.coin}-USD`;

  console.log(`Rolling back → buying back ${inputToken.name} with USD`);

  return sdk.exchange.placeOrder({
    coin: inputToken.coin,
    is_buy: true,
    limit_px: priceLimit, // fallback to market if SDK supports it
    sz: amountUsd, // safe default, can be replaced with proper amount logic
    cloid: `ROLLBACK-${market}-${Date.now()}`,
    reduce_only: false,
    order_type: { limit: { tif: 'Ioc' } }
  });
}

async function withdrawFundsToFiller(
  outputToken: SpotTokenExtended,
  amountRaw: string,
  fillerAddress: string
) {
  console.log(
    `Withdrawing ${amountRaw} ${outputToken.name} to filler ${fillerAddress}`
  );

  await encodeAndSendCoreAction({
    actionId: 6, // Spot send
    from: apiWallet,
    to: fillerAddress,
    tokenIndex: outputToken.assetId,
    amount: amountRaw,
  });

  return amountRaw;
}

// -----------------------------------------------------------------------------
// Main Swap Flow
// -----------------------------------------------------------------------------

export async function swapHypercore(
  orderId: string,
  inputToken: SpotTokenExtended,
  inputAmountRaw: string,
  outputToken: SpotTokenExtended,
  minOutputAmountRaw: string,
  fillerAddress: string
) {
  let swapState = SwapState.Pending;
  let amountUsd = 0;

  if(!inputToken || !outputToken) {
    console.log('Could not resolve swap metadata');
    return;
  }

  try {
    // 1️⃣ Delegate funds
    await delegateFundsToHyperCore(orderId, inputToken, inputAmountRaw, fillerAddress);
    swapState = SwapState.Delegated;

    // 2️⃣ Sell input → USD
    amountUsd = await placeLimitOrderToUsd(inputToken, inputAmountRaw);
    swapState = SwapState.OrderPlacedUSD;

    // 3️⃣ Buy USD → output
    await placeLimitOrderToOutput(outputToken, minOutputAmountRaw);
    swapState = SwapState.OrderPlacedOutput;

    // 4️⃣ Withdraw back to filler
    const filledOutputAmount = await withdrawFundsToFiller(
      outputToken,
      minOutputAmountRaw,
      fillerAddress
    );
    swapState = SwapState.WithdrawnToFiller;

    // 5️⃣ Signal success
    await signalOrderFilled(orderId, filledOutputAmount);
    swapState = SwapState.Completed;

    console.log(`[${orderId}] Swap completed successfully`);
  } catch (ex) {
    console.error(`[${orderId}] Swap failed at state ${swapState}:`, ex);

    let returnedInputAmount = inputAmountRaw;

    try {
      if (swapState === SwapState.OrderPlacedUSD) {
        returnedInputAmount = await placeLimitOrderToInput(inputToken, amountUsd);
        swapState = SwapState.Delegated;
      }

      if (swapState === SwapState.Delegated) {
        await signalOrderFailed(orderId, returnedInputAmount);
      }
    } catch (rollbackEx) {
      console.error(`[${orderId}] Rollback failed:`, rollbackEx);
    }

    console.log(`[${orderId}] FATAL: could not complete or return funds.`);
  }
}

export async function getSpotInfos(inputAddress: string, outputAddress: string) {
   const tokenMetadata = await getTokensWithContracts();
   const inputToken =  tokenMetadata.mergedTokens.find(x => x.evmContract?.address.toLowerCase() == inputAddress.toLowerCase())
   const outputToken =  tokenMetadata.mergedTokens.find(x => x.evmContract?.address.toLowerCase() == outputAddress.toLowerCase())
   return [inputToken, outputToken]
}

// -----------------------------------------------------------------------------
// Token Metadata Fetcher
// -----------------------------------------------------------------------------

export async function getTokensWithContracts(): Promise<{
  tokens: SpotTokenExtended[];
  mergedTokens: SpotTokenExtended[];
}> {
  const sdk = getSDK();

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
