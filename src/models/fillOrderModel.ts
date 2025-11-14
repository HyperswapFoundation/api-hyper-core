// src/models/fillOrder.ts

import { DutchOrder } from "@uniswap/uniswapx-sdk";

export interface FillOrderMetadata {
    /** DutchOrder.info object from @uniswap/uniswapx-sdk */
    info: any;
    /** EIP-712 signature for the order */
    signature: string;
    /** Raw calldata (hex) for SwapRouter02 multicall or single call */
    orderRoute: string;
    account: string;
    tokenInAddress: string;
    tokenInDecimals: number;
    tokenOutAddress: string;
    tokenOutDecimals: number;
  }
  
  export interface FillOrderRequestBody {
    order: FillOrderMetadata;
    chainId: number;
  }
  
  /** Canonical shape your backend can use internally */
  export interface ParsedFillOrder {
    dutchOrder: DutchOrder;
    signature: string;
    orderMulticallData: string;
    account: string,
    tokenInAddress: string;
    tokenInDecimals: number;
    tokenOutAddress: string;
    tokenOutDecimals: number;
    chainId: number;
  }
  