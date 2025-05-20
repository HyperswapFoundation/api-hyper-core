export interface SerializedApiRoute {
    protocol: 'V2' | 'V3' | 'MIXED';
    tokenPath: SerializedToken[];
    pools: SerializedPool[];
    midPrice: string; // precomputed on server as a decimal string
  }
  
  export interface SerializedToken {
    chainId: number;
    address: string;
    symbol: string;
    decimals: number;
  }
  
  export interface SerializedPool {
    token0: SerializedToken;
    token1: SerializedToken;
    fee: number; // e.g., 3000 for 0.3%, can be optional for V2
    address?: string; // optional pool address
  }