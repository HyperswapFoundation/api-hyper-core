import { ethers } from 'ethers'
import { FillOrderRequestBody, ParsedFillOrder } from '../models/fillOrderModel'
import { DutchOrder } from '@uniswap/uniswapx-sdk'


export function parseFillOrderRequest(body: unknown): ParsedFillOrder {
  if (!body || typeof body !== 'object') throw new Error('Request body missing')

  const { order, chainId } = body as FillOrderRequestBody

  if (!order) throw new Error('Missing order')
  if (typeof chainId !== 'number') throw new Error('Missing or invalid chainId')

  const {
    info,
    signature,
    orderRoute,
    tokenInAddress,
    tokenOutAddress,
  } = order

  if (!signature || typeof signature !== 'string') throw new Error('Missing or invalid signature')
  if (!orderRoute || typeof orderRoute !== 'string' || !orderRoute.startsWith('0x')) {
    throw new Error('Missing or invalid orderRoute')
  }
  if (!tokenInAddress || typeof tokenInAddress !== 'string' || !ethers.utils.isAddress(tokenInAddress)) {
    throw new Error('Missing or invalid tokenInAdress')
  }
  if (!tokenOutAddress || typeof tokenOutAddress !== 'string' || !ethers.utils.isAddress(tokenOutAddress)) {
    throw new Error('Missing or invalid tokenOutAdress')
  }

  const dutchOrder = new DutchOrder(info, chainId);

  return {
    dutchOrder,
    signature,
    orderMulticallData: orderRoute,
    // Normalize to canonical names internally
    tokenInAddress: tokenInAddress,
    tokenOutAddress: tokenOutAddress,
    chainId,
  }
}
