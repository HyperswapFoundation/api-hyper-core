import { DutchOrder } from "@uniswap/uniswapx-sdk";
import { HypercoreFillerAddress, SwapRouter02ExecutorAddress } from "../constants";
import TRUSTED_FILLER_ABI from '../abis/TrustedFiller.json'
import { BigNumber, Contract, utils, Wallet } from "ethers";
import { getSpotInfos, swapHypercore } from "./hypercore-sdk-wrapper";

export async function fillOrderHC(
  signer: Wallet,
  order: DutchOrder,
  tokenInAddress: string,
  inputTokenDecimals: number,
  tokenOutAddress: string,
  outputTokenDecimals: number,
  signature: string,
) {

  const inputMetadata = order.info.input;
  const outputMetadata = order.info.outputs[0];
  const [inputToken, outputToken] = await getSpotInfos(inputMetadata.token, outputMetadata.token);

  if(!inputToken || !outputToken || !inputToken.midPrice || !outputToken.midPrice || !inputToken.evmContract?.address) {
    console.log('Could not resolve swap metadata');
    return;
  }

  // 1. Build the SignedOrder struct
  const signedOrder = {
    order: order.serialize(), // serialized DutchOrder bytes
    sig: signature,
  };

  const tokensToApproveForReactor: string[] = [tokenInAddress, tokenOutAddress]; 
  const apiWallets: string[] = ['0xB07DA14A3113E020bE8f2d64Fb0b88B5d49c5a78']
  const callbackData = utils.defaultAbiCoder.encode(
    ["address[]", "address[]"],
    [apiWallets, tokensToApproveForReactor]
  );

  // 3. Connect contract
  const executor = new Contract(
    HypercoreFillerAddress,
    TRUSTED_FILLER_ABI,
    signer
  );

  // 4. Dry-run with callStatic
  try {
    await executor.callStatic.execute(signedOrder, callbackData);
    console.log("✅ callStatic success — transaction should succeed");
  } catch (err: any) {
    console.error("❌ callStatic reverted:", err);
    throw new Error(err?.reason || err?.message || "callStatic failed");
  }

  // 5. Execute for real
  const captureOrderFundsTx = await executor.estimateGas.execute(signedOrder, callbackData)
    .then(gasLimit => executor.execute(signedOrder, callbackData, { gasLimit }));

   console.log('Processing Order TX Hash:' + captureOrderFundsTx.hash)
   await captureOrderFundsTx.wait();

   const inputStartAmount = BigNumber.from((inputMetadata.startAmount as any).hex);
   const outputEndAmount = BigNumber.from((outputMetadata.endAmount as any).hex);
   
   swapHypercore(order.hash(), inputToken, inputStartAmount.toString(), outputToken, outputEndAmount.toString(), HypercoreFillerAddress, signer)
}