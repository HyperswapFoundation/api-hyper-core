import { HYPERCORE_TRUSTED_REACTOR } from "../constants";
import HYPERCORE_TRUSTED_REACTOR_ABI from "../abis/TrustedExclusiveDutchReactor.json";
import { BigNumber, Contract, Wallet } from "ethers";
import ERC20_ABI  from "../abis/ERC20_ABI.json";

export async function signalOrderFilled(orderId: string, tokenAddress: string, amountToReturnRaw: string, signer: Wallet) {

  const amountToReturnBN = BigNumber.from(amountToReturnRaw)
  // 1️⃣ Initialize contracts
  const reactorContract = new Contract(
    HYPERCORE_TRUSTED_REACTOR,
    HYPERCORE_TRUSTED_REACTOR_ABI,
    signer
  );

  const tokenContract = new Contract(tokenAddress, ERC20_ABI, signer);

  // 2️⃣ Approve the reactor to pull returned tokens
  try {
    const allowance: BigNumber = await tokenContract.allowance(signer.address, HYPERCORE_TRUSTED_REACTOR);
    if (allowance.lt(amountToReturnBN)) {
      const approveTx = await tokenContract.approve(HYPERCORE_TRUSTED_REACTOR, amountToReturnBN);
      await approveTx.wait();
      console.log(`✅ Approved ${amountToReturnRaw} tokens for reactor`);
    } else {
      console.log("✅ Reactor already approved");
    }
  } catch (err: any) {
    console.error("❌ Token approval failed:", err);
    throw new Error(err?.reason || err?.message || "Approval failed");
  }

  // 3️⃣ Call settleOrder on the reactor
  try {
    // Estimate gas first
    const gasEstimate = await reactorContract.estimateGas.settleOrder(
      orderId,
      "0",
      signer.address
    );

    const tx = await reactorContract.settleOrder(
      orderId,
      "0",
      signer.address,
      {
        gasLimit: gasEstimate.mul(120).div(100), // +20% buffer
      }
    );

    console.log("⏳ Sent settleOrder tx:", tx.hash);
    const receipt = await tx.wait();

    console.log(`✅ Order settled successfully in block ${receipt.blockNumber}`);
    return receipt;
  } catch (err: any) {
    console.error("❌ settleOrder failed:", err);
    throw new Error(err?.reason || err?.message || "settleOrder failed");
  }

} 

/**
 * Signal a failed order and return the input tokens to the swapper.
 *
 * @param orderId - The keccak256 order ID
 * @param tokenAddress - The input token address being returned
 * @param returnedInputAmount - The amount of input tokens to return (as a string in wei)
 * @param signer - The Wallet (apiWallet) that currently holds those tokens
 */
export async function signalOrderFailed(
  orderId: string,
  tokenAddress: string,
  returnedInputAmount: string,
  signer: Wallet
) {
  const returnedInputAmountBN = BigNumber.from(returnedInputAmount)
  // 1️⃣ Initialize contracts
  const reactorContract = new Contract(
    HYPERCORE_TRUSTED_REACTOR,
    HYPERCORE_TRUSTED_REACTOR_ABI,
    signer
  );

  const tokenContract = new Contract(tokenAddress, ERC20_ABI, signer);

  // 2️⃣ Approve the reactor to pull returned tokens
  try {
    const allowance: BigNumber = await tokenContract.allowance(signer.address, HYPERCORE_TRUSTED_REACTOR);
    if (allowance.lt(returnedInputAmountBN)) {
      const approveTx = await tokenContract.approve(HYPERCORE_TRUSTED_REACTOR, returnedInputAmountBN);
      await approveTx.wait();
      console.log(`✅ Approved ${returnedInputAmount} tokens for reactor`);
    } else {
      console.log("✅ Reactor already approved");
    }
  } catch (err: any) {
    console.error("❌ Token approval failed:", err);
    throw new Error(err?.reason || err?.message || "Approval failed");
  }

  // 3️⃣ Call settleOrder on the reactor
  try {
    // Estimate gas first
    const gasEstimate = await reactorContract.estimateGas.settleOrder(
      orderId,
      returnedInputAmount,
      signer.address
    );

    const tx = await reactorContract.settleOrder(
      orderId,
      returnedInputAmount,
      signer.address,
      {
        gasLimit: gasEstimate.mul(120).div(100), // +20% buffer
      }
    );

    console.log("⏳ Sent settleOrder tx:", tx.hash);
    const receipt = await tx.wait();

    console.log(`✅ Order settled successfully in block ${receipt.blockNumber}`);
    return receipt;
  } catch (err: any) {
    console.error("❌ settleOrder failed:", err);
    throw new Error(err?.reason || err?.message || "settleOrder failed");
  }
}
