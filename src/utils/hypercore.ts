import { BigNumber, ethers } from "ethers";
import ERC20_ABI  from "../abis/ERC20_ABI.json";
import { defaultAbiCoder, formatUnits, getAddress, hexlify, hexZeroPad, Interface } from "ethers/lib/utils";
import { CurrencyAmount, Percent } from "@hyperswap-labs/sdk-core";

export const HYPE_SYSTEM_ADDRESS = "0x2222222222222222222222222222222222222222";
export const CORE_WRITER_ADDRESS = "0x3333333333333333333333333333333333333333";
export const ACTION_ID_SPOT_SEND = 6;
export const ACTION_ID_LIMIT_ORDER = 1;
export const MAX_PRICE_DECIMALS = 8
export const MAX_SPOT_SIG_FIGS = 5;

export interface TxData {
    to: string;
    from: string;
    data: string;
    value: string;
}


// ABI fragment for encode+send (only what’s needed)
const CORE_WRITER_ABI = [
  "function perform(bytes calldata action) external payable returns (bytes memory)"
];

/**
 * Encode and send a CoreWriter action to HyperCore.
 *
 * @param params.actionId    Core action ID (6 = Spot send)
 * @param params.from        Sender address
 * @param params.to          Receiver address
 * @param params.tokenIndex  Token index (asset ID)
 * @param params.amount      Raw amount (string or bigint)
 * @returns The transaction receipt or hash
 */
export async function encodeAndSendCoreAction(params: {
  actionId: number; // e.g., 6 for Spot send
  from: string;
  to: string;
  tokenIndex: number;
  amount: string | bigint;
}) {
  const { actionId, from, to, tokenIndex, amount } = params;

  // === 1. Setup signer & contract ===
  const provider = new ethers.providers.JsonRpcProvider(process.env.HYPERCORE_RPC_URL);
  const signer = new ethers.Wallet(process.env.API_PRIVATE_KEY!, provider);
  const coreWriter = new ethers.Contract(CORE_WRITER_ADDRESS, CORE_WRITER_ABI, signer);

  // === 2. Build encoded Core action ===
  // CoreWriter format: [1-byte version][3-byte actionId][abi-encoded data]
  // actionId 6 => Spot Send: (address to, uint64 token, uint64 amount)

  const version = 1; // always 1
  const actionIdBytes = ethers.utils.hexZeroPad(ethers.utils.hexlify(actionId), 3); // 3 bytes big-endian
  const encodedData = ethers.utils.defaultAbiCoder.encode(
    ["address", "uint64", "uint64"],
    [to, tokenIndex, BigInt(amount)]
  );

  const payload =
    ethers.utils.hexlify(version) +
    actionIdBytes.slice(2) + // drop "0x"
    encodedData.slice(2);

  // === 3. Send the action ===
  console.log(`[HyperCore] Sending Core action ${actionId} (${amount} token ${tokenIndex}) → ${to}`);

  const tx = await coreWriter.perform(payload);
  const receipt = await tx.wait();

  console.log(`[HyperCore] Tx hash: ${receipt.transactionHash}`);
  return receipt;
}

export function getERC20DepositTxData(
    from: string,
    amountRaw: string,
    tokenIndex: BigNumber,
    tokenContract: string
  ): TxData {
    const amount = BigNumber.from(amountRaw);
    const destination = getSystemAddress(tokenIndex, false);
  
    const iface = new Interface(ERC20_ABI);
    const data = iface.encodeFunctionData("transfer", [destination, amount]);
  
    return {
      to: tokenContract,
      from,
      data,
      value: "0x0"
    };
  }

export function getSystemAddress(tokenIndex: BigNumber, isHype: boolean): string {
    if (isHype) {
      return HYPE_SYSTEM_ADDRESS;
    }
  
    // Convert tokenIndex to hex without '0x' prefix
    const indexHex = tokenIndex.toHexString().slice(2);
  
    // Ensure the token index is no longer than 38 hex characters (19 bytes)
    if (indexHex.length > 38) {
      throw new Error("tokenIndex too large");
    }
  
    // Total address length is 40 chars after '0x':
    // prefix '20' (2 chars) + padding zeros + token index
    const paddingZeros = "0".repeat(38 - indexHex.length);
  
    const address = `0x20${paddingZeros}${indexHex}`;
  
    return getAddress(address);
}

export function encodeCoreAction(actionId: number, types: string[], values: any[]): string {
    const version = "0x01";
    const actionIdHex = hexZeroPad(hexlify(actionId), 3); // 3-byte big-endian
    const payload = defaultAbiCoder.encode(types, values);
    return version + actionIdHex.slice(2) + payload.slice(2);
}

export function getWithdrawTxData(
  from: string,
  amountRaw: BigNumber,
  tokenIndex: BigNumber,
  isHype: boolean
): TxData {
  const address = getSystemAddress(tokenIndex, isHype);

  // Encode the inner action first
  const rawAction = encodeCoreAction(
    ACTION_ID_SPOT_SEND,
    ["address", "uint64", "uint64"],
    [address, tokenIndex, amountRaw]
  );

  // Encode the outer CoreWriter.sendRawAction(rawAction)
  const iface = new Interface(CORE_WRITER_ABI);
  const data = iface.encodeFunctionData("sendRawAction", [rawAction]);

  return {
    to: CORE_WRITER_ADDRESS,
    from,
    data,
    value: "0x0"
  };
}

export function applySlippageToPrice(
    midPrice: number,
    allowedSlippage: Percent,
    isBuy: boolean
  ): number {
    const s =
      Number(allowedSlippage.numerator.toString()) /
      Number(allowedSlippage.denominator.toString());
  
    // Calculate adjusted price
    const factor = isBuy ? 1 + s : 1 - s;
    const adjusted = midPrice * factor;
  
    // Match original decimal precision
    const decimals = (midPrice.toString().split('.')[1] || '').length;
    return Number(adjusted.toFixed(decimals));
  }
  

export function calculatePrice(midPrice: number, allowedSlippage: Percent, szDecimals: number, isBuy: boolean) {
    const priceAfterSlippageNum = applySlippageToPrice(midPrice, allowedSlippage, isBuy)
    const priceDecimals = Math.max(MAX_PRICE_DECIMALS - szDecimals, 0)
      // 3. Truncate to allowed decimals
    const truncated = Math.floor(priceAfterSlippageNum * 10 ** priceDecimals) / 10 ** priceDecimals

    // 4. Enforce 5 significant figures
    const magnitude = Math.floor(Math.log10(Math.abs(truncated))) + 1
    const decimalsAllowed = Math.max(MAX_SPOT_SIG_FIGS - magnitude, 0)
    const sigFigAdjusted = Number(truncated.toFixed(Math.min(decimalsAllowed, priceDecimals)))

    return sigFigAdjusted
}

export function toTruncated(num: number, decimals: number) {
  const factor = Math.pow(10, decimals);
  return Math.trunc(num * factor) / factor;
}