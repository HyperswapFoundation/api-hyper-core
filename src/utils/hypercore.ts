import { ethers } from "ethers";

// CoreWriter contract address for Hyperliquid
const CORE_WRITER_ADDRESS = "0x3333333333333333333333333333333333333333";

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
