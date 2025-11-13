import { BigNumber, ethers } from "ethers";
import ERC20_ABI  from "../abis/ERC20_ABI.json";
import { getAddress, Interface } from "ethers/lib/utils";

export const HYPE_SYSTEM_ADDRESS = "0x2222222222222222222222222222222222222222";
export const CORE_WRITER_ADDRESS = "0x3333333333333333333333333333333333333333";

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

