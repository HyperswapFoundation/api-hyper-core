import { BigNumber, ethers, Wallet } from "ethers";
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
