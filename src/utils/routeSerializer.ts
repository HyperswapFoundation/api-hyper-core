import { Pair } from '@uniswap/v2-sdk';
import { Token, Currency, V3_FACTORY_INIT_HASH, V3_CORE_FACTORY_ADDRESSES } from '@uniswap/sdk-core';
import { IRoute, Protocol } from '@uniswap/router-sdk';
import { Price } from '@uniswap/sdk-core';
import { SerializedApiRoute, SerializedPool, SerializedToken } from '../models/routeModels';
import { Pool } from '@uniswap/v3-sdk';

export function serializeRoute(route: IRoute<Currency, Currency, Pool | Pair>): SerializedApiRoute {
  const serializedPools: SerializedPool[] = route.pools.map(poolOrPair => {
    const isV2 = route.protocol === Protocol.V2 || poolOrPair instanceof Pair;

    const fee = isV2 ? 3000: (poolOrPair as Pool).fee
    const chainId = poolOrPair.token0.chainId

    const address = isV2 ? Pair.getAddress(poolOrPair.token0, poolOrPair.token1) : Pool.getAddress(poolOrPair.token0, poolOrPair.token1, fee, V3_FACTORY_INIT_HASH[chainId], V3_CORE_FACTORY_ADDRESSES[chainId], ) 

    const token0: SerializedToken = {
      chainId: poolOrPair.token0.chainId,
      address: poolOrPair.token0.address,
      symbol: poolOrPair.token0.symbol ?? '',
      decimals: poolOrPair.token0.decimals,
    };

    const token1: SerializedToken = {
      chainId: poolOrPair.token1.chainId,
      address: poolOrPair.token1.address,
      symbol: poolOrPair.token1.symbol ?? '',
      decimals: poolOrPair.token1.decimals,
    };

    return {
      token0,
      token1,
      fee, // Default fee (3000) for V2
      address,       // Undefined for V2 pairs
    };
  });

  const serializedTokens: SerializedToken[] = route.path.map(token => ({
    chainId: token.chainId,
    address: token.address,
    symbol: token.symbol ?? '',
    decimals: token.decimals,
  }));

  return {
    protocol: route.protocol as 'V2' | 'V3' | 'MIXED',
    tokenPath: serializedTokens,
    pools: serializedPools,
    midPrice: route.midPrice.toSignificant(8), // Decimal string for UI
  };
}
