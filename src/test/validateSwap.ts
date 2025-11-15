import { Wallet, providers } from "ethers";
import { executeSwap, getSDK, getSpotInfos } from "../utils/hypercore-sdk-wrapper";
import * as dotenv from 'dotenv'

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


export async function validateSwapWorks() {
    const sdk = getSDK(pk);

    const [inputToken, outputToken] = await getSpotInfos(sdk, inputTokenAddress, outputTokenAddress);
    
    if(!inputToken || !outputToken || !inputToken.midPrice || !outputToken.midPrice || !inputToken.evmContract?.address) {
      console.log('Could not resolve swap metadata');
      return;
    }
    
    await executeSwap(sdk, orderId, inputToken, inputAmountRaw, inputTokenDecimals, outputToken, ouputAmountRaw, outputTokenDecimals, signer)
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
