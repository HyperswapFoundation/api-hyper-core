import { Wallet, providers } from "ethers";
import { delegateFundsToHyperCore, getSDK, getSpotInfos, placeLimitOrder, SpotTokenExtended, spotWithdrawal } from "../utils/hypercore-sdk-wrapper";
import * as dotenv from 'dotenv'
import { formatUnits } from "ethers/lib/utils";
import { MAX_PRICE_DECIMALS, MAX_SPOT_SIG_FIGS } from "../utils/hypercore";

dotenv.config()

// ---- Config ----
const CHAIN_ID = 999
const RPC_URL = process.env.RPC_URL_HYPEREVM || 'https://rpc.hyperliquid.xyz/evm'
const pk = process.env.SIGNER_PRIVATE_KEY_MAP!;
const inputTokenAddress = "0x9b498C3c8A0b8CD8BA1D9851d40D186F1872b44E" // PURR
const inputTokenDecimals = 18;
const outputTokenAddress = "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb"
const outputTokenDecimals = 6
const inputAmountRaw = "150000000000000000000" //150
const ouputAmountRaw = "14550000" //14.26
const orderId = "TEST_ORDER";
const provider = new providers.JsonRpcProvider(RPC_URL, CHAIN_ID)
const signer =  new Wallet(pk, provider)
const defaultSlippage = .005;

export async function validateSwapWorks() {
    const sdk = getSDK(pk);

    const [inputToken, outputToken] = await getSpotInfos(sdk, inputTokenAddress, outputTokenAddress);
    
    if(!inputToken || !outputToken || !inputToken.midPrice || !outputToken.midPrice || !inputToken.evmContract?.address) {
      console.log('Could not resolve swap metadata');
      return;
    }
    
    await delegateFundsToHyperCore(orderId, inputToken, inputAmountRaw, signer);

    const inputIsBuy = false
    const inputPriceLimit = calculatePriceWithSlippage(inputToken, defaultSlippage, inputIsBuy)
    const inputSize = calculateSize(inputAmountRaw, inputIsBuy, inputTokenDecimals, inputToken.szDecimals)
    const sellResponse = await placeLimitOrder(sdk, inputToken, inputIsBuy, inputPriceLimit, inputSize)
    console.log(JSON.stringify(sellResponse));

    const outputIsBuy = true;
    const outputPriceLimit = calculatePriceWithSlippage(outputToken, defaultSlippage, outputIsBuy)
    const outputSize = calculateSize(ouputAmountRaw, outputIsBuy, outputTokenDecimals, outputToken.szDecimals)
    const buyResponse = await placeLimitOrder(sdk, outputToken, outputIsBuy, outputPriceLimit, outputSize);
    console.log(JSON.stringify(buyResponse));

    const withdrawResponse = await spotWithdrawal(sdk, outputToken, outputSize)
    console.log(JSON.stringify(withdrawResponse));
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



// Allow running directly (node/ts-node)
if (require.main === module) {
  validateSwapWorks()
    .then(() => {
      console.log("\nValidateSwapWorks() completed.");
    })
    .catch(err => {
      console.error("\nValidateSwapWorks() failed:", err);
    });
}
