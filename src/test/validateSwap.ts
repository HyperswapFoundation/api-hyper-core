import { Wallet, providers } from "ethers";
import { delegateFundsToHyperCore, getSDK, getSpotInfos, placeLimitOrder } from "../utils/hypercore-sdk-wrapper";
import * as dotenv from 'dotenv'
import { formatUnits } from "ethers/lib/utils";

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
const ouputAmountRaw = "14260000" //14.26
const orderId = "TEST_ORDER";
const provider = new providers.JsonRpcProvider(RPC_URL, CHAIN_ID)
const signer =  new Wallet(pk, provider)
const defaultSlippage = .001;

export async function validateSwapWorks() {
    const sdk = getSDK();

      const [inputToken, outputToken] = await getSpotInfos(inputTokenAddress, outputTokenAddress);
    
      if(!inputToken || !outputToken || !inputToken.midPrice || !outputToken.midPrice || !inputToken.evmContract?.address) {
        console.log('Could not resolve swap metadata');
        return;
      }
    
    //await delegateFundsToHyperCore(orderId, inputToken, inputAmountRaw, signer);

    const inputPriceLimit = calculatePriceWithSlippage(inputToken.midPrice, defaultSlippage, false)
    const inputSize = calculateSize(inputAmountRaw, true, inputTokenDecimals)
    await placeLimitOrder(inputToken, false, inputPriceLimit, inputSize)

    const outputPriceLimit = calculatePriceWithSlippage(outputToken.midPrice, defaultSlippage, false)
    const outputSize = calculateSize(ouputAmountRaw, true, outputTokenDecimals)
    await placeLimitOrder(outputToken, true, outputPriceLimit, outputSize);
} 

function calculatePriceWithSlippage(midPrice: number, slippage: number, isBuy: boolean) {
    // slippage is decimal, e.g. 0.1 = 10%
    const s = slippage;

    // BUY → price goes UP (willing to pay more)
    // SELL → price goes DOWN (willing to accept less)
    const factor = isBuy ? (1 + s) : (1 - s);

    const adjusted = midPrice * factor;

    // Maintain original decimal precision of midPrice
    const decimals = (midPrice.toString().split('.')[1] || '').length;
    return Number(adjusted.toFixed(decimals));
}


function calculateSize(rawAmount: string, isBuy: boolean, tokenDecimals: number) {
    const human = Number(formatUnits(rawAmount, tokenDecimals));

    // For your testing flow, size should NOT be slippaged.
    // HyperCore enforces min-out via output leg size, not here.
    return human;
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
