import { DutchOrder } from "@uniswap/uniswapx-sdk";
import { HypercoreFillerAddress, SwapRouter02ExecutorAddress } from "../constants";
import TRUSTED_FILLER_ABI from '../abis/TrustedFiller.json'
import { Contract, utils, Wallet } from "ethers";
import { getSpotInfos, swapHypercore } from "./hypercore-sdk-wrapper";

export async function fillOrderHC(
  signer: Wallet,
  order: DutchOrder,
  account: string,
  tokenInAddress: string,
  tokenOutAddress: string,
  signature: string,
) {

  const inputMetadata = order.info.input;
  const outputMetadata = order.info.outputs[0];
  const [inputToken, outputToken] = await getSpotInfos(inputMetadata.token, outputMetadata.token);

  if(!inputToken || !outputToken) {
    throw new Error('Could not resolve Hypercore Route');
  }

  // 1. Build the SignedOrder struct
  const signedOrder = {
    order: order.serialize(), // serialized DutchOrder bytes
    sig: signature,
  };

  const tokensToApproveForReactor: string[] = [tokenInAddress, tokenOutAddress]; 
  const callbackData = utils.defaultAbiCoder.encode(
    ["address[]"],
    [tokensToApproveForReactor]
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
   captureOrderFundsTx.wait();

   swapHypercore(order.hash(), inputToken, inputMetadata.startAmount.toString(), outputToken, outputMetadata.endAmount.toString(), HypercoreFillerAddress)
}