/* eslint-disable @typescript-eslint/no-explicit-any */
import { DutchOrder } from "@uniswap/uniswapx-sdk";
import { SwapRouter02ExecutorAddress } from "../constants";
import SWAP_ROUTER02_EXECUTOR_ABI from "../abis/SwapRouter02Executor.json";
import { BigNumberish, Contract, ethers, providers, utils, Wallet } from "ethers";

export async function fillOrder(
  signer: Wallet,
  order: DutchOrder,
  tokenInAddress: string,
  tokenOutAddress: string,
  signature: string,
  swapRouterMulticallData: string,
) {
  if (!swapRouterMulticallData) {
    console.log("Cannot Execute swap — no quote loaded");
    return;
  }

  // 1. Build the SignedOrder struct
  const signedOrder = {
    order: order.serialize(), // serialized DutchOrder bytes
    sig: signature,
  };

  // 2. Prepare multicallData for executor
  const tokensToApproveForSwapRouter02 = [tokenInAddress];
  const tokensToApproveForReactor: string[] = [tokenInAddress, tokenOutAddress]; // usually empty

  const callbackData = utils.defaultAbiCoder.encode(
    ["address[]", "address[]", "bytes[]"],
    [tokensToApproveForSwapRouter02, tokensToApproveForReactor, [ethers.utils.arrayify(swapRouterMulticallData)]]
  );

  // 3. Connect contract
  const executor = new Contract(
    SwapRouter02ExecutorAddress,
    SWAP_ROUTER02_EXECUTOR_ABI,
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
  const tx = await executor.estimateGas.execute(signedOrder, callbackData)
    .then(gasLimit => executor.execute(signedOrder, callbackData, { gasLimit }));

  console.log('Processing Order TX Hash:' + tx.hash)
  return tx.wait();
}

export async function verifyUniswapXSignature(
  signerAddress: string,
  domain: any,
  types: any,
  message: any,
  signature: string
): Promise<boolean> {
  const recovered = ethers.utils.verifyTypedData(domain, types, message, signature);
  return recovered.toLowerCase() === signerAddress.toLowerCase();
}
