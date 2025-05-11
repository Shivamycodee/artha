import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import * as base58 from 'base-58';
import { PublicKey } from '@solana/web3.js';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Initialize timer
export const timer = {
    start: () => console.time('Pool detection'),
    end: () => console.timeEnd('Pool detection')
  };


// Configure colors
export const success = chalk.green.bold;
export const info = chalk.cyan;
export const warning = chalk.yellow;
export const error = chalk.red;
export const highlight = chalk.magentaBright;
export const RUG_CHECK_URL = process.env.RUG_CHECK_URL;
export const TOKEN_PRICE_URL = process.env.TOKEN_PRICE_URL;
export const SOL_PUBLIC_ADDRESS = "So11111111111111111111111111111111111111112";

const PUMPSWAP_TOKEN_URL= "https://swap-api.pump.fun/v1/pools/pair"
// (?)mintA=So11111111111111111111111111111111111111112&mintB=8vVvjJG4KZ4xhcUoa4koKhQbSr58PJSAXVnh7WM9pump&sort=liquidity&include_vol=true"


export interface MarketAccountData {
    poolBump: number;
    index: number;
    creator: string;
    baseMint: string;
    quoteMint: string;
    lpMint: string;
    poolBaseTokenAccount: string;
    poolQuoteTokenAccount: string;
    lpSupply: string;
  }
  
  // Add new interface for fee estimation
  export interface TradeFees {
    buy: {
      baseFee: number;
      priorityFee: number;
      totalFee: number;
    };
    sell: {
      baseFee: number;
      priorityFee: number;
      totalFee: number;
    };
  }
  
  // Update EnhancedMarketData interface
  export interface EnhancedMarketData extends MarketAccountData {
    creatorHoldings?: string;
    freezeAuthority?: string;
    price?: number;
    detectedIn?: number;
    fees?: TradeFees;
  }

  // Add these new interfaces
interface DashboardData {
  mint: string;
  price: number;
  liquidity: number;
  lpLockedPct: number;
  topHolder: string;
  holderPercentage: number;
  freezeAuthority: string | null;
  lastUpdated: Date;
  risks: string[];
}



// Update the fee estimation constants and logic
export const REALISTIC_SWAP_CU = 300000; // Actual average for Jupiter swaps
export const MICRO_LAMPORTS_PER_CU = 10000; // 0.01 lamport/CU (1 lamport = 0.000000001 SOL)


export const WSS_ENDPOINT = process.env.SOLANA_NODE_WSS_ENDPOINT!;
export const RPC_ENDPOINT = process.env.PUBLIC_RPC_URL!;
export const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

// Precomputed constants
export const MARKET_ACCOUNT_LENGTH = 211;
export const DISCRIMINATOR = Buffer.from([0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc]);
export const MARKET_DISCRIMINATOR = base58.encode(DISCRIMINATOR);
export const QUOTE_MINT_SOL = 'So11111111111111111111111111111111111111112';


const fromRaw = (raw:any, decimals:number) => Number(raw) / 10 ** decimals;


export function getFormattedUTCTime(): string {
  const now = new Date();

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const year = now.getUTCFullYear();
  const month = monthNames[now.getUTCMonth()];
  const day = String(now.getUTCDate()).padStart(2, '0');

  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');

  return `${month} ${day}, ${year} ${hours}:${minutes}:${seconds} +UTC`;
}



export function formatNumberToKM(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)} M`;
  } else if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)} K`;
  } else {
    return value.toFixed(1);
  }
}

// 1st used
export async function fetchExistingMarketPubkeys(connection:any): Promise<Set<string>> {
  const filters: any[] = [
    { dataSize: MARKET_ACCOUNT_LENGTH },
    { memcmp: { offset: 0, bytes: MARKET_DISCRIMINATOR } },
    { memcmp: { offset: 75, bytes: QUOTE_MINT_SOL } }
  ];

  const accounts = await connection.getProgramAccounts(PUMP_AMM_PROGRAM_ID, { filters });
  return new Set(accounts.map((account:any) => account.pubkey.toBase58()));
}


// 2nd used
export function parseMarketAccountData(data: Buffer): MarketAccountData | null {
    try {
      let offset = 8; // Skip discriminator
  
      const poolBump = data.readUInt8(offset++);
      const index = data.readUInt16LE(offset);
      offset += 2;
  
      const readPubkey = () => {
        const pubkey = new PublicKey(data.subarray(offset, offset + 32));
        offset += 32;
        return pubkey.toBase58();
      };
  
      return {
        poolBump,
        index,
        creator: readPubkey(),
        baseMint: readPubkey(),
        quoteMint: readPubkey(),
        lpMint: readPubkey(),
        poolBaseTokenAccount: readPubkey(),
        poolQuoteTokenAccount: readPubkey(),
        lpSupply: data.readBigUInt64LE(offset).toString()
      };
    } catch (error) {
      console.error('Error parsing market account:', error);
      return null;
    }
  }


  
  /**
 * Fetch and format Pump Swap pool info for token ↔ SOL.
 *
 * @param {string} tokenMint  – the mint address of your token
 * @returns {Promise<object>} – structured pool info
 */
export async function getPoolInfo(tokenMint:string) {
  // 1. Build and call the Pump API URL
  const url = `https://swap-api.pump.fun/v1/pools/pair`
    + `?mintA=${tokenMint}`
    + `&mintB=${SOL_PUBLIC_ADDRESS}`
    // + `&sort=liquidity`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  const [pool] = await res.json();
  if (!pool) {
    throw new Error(`No pool found for token ${tokenMint}`);
  }

  // 2. Extract raw reserves & decimals
  const rawTokenReserve = BigInt(pool.baseReserves);
  const rawSOLReserve   = BigInt(pool.quoteReserves);
  const tokenDec        = pool.baseMintDecimals;
  const solDec          = pool.quoteMintDecimals;

  // 3. Convert to human amounts
  const tokenReserve = fromRaw(rawTokenReserve, tokenDec);
  const solReserve   = fromRaw(rawSOLReserve, solDec);

  // 4. Compute price in SOL: how many SOL per 1 token
  const priceInSOL = solReserve / tokenReserve;

  // 5. Compute USD price
  //    Pool.liquidityUSD = total USD value of BOTH sides.
  //    So USD per SOL ≈ (liquidityUSD/2) / solReserve
  //    Then token USD price = priceInSOL × USD per SOL
  const liqUSD    = Number(pool.liquidityUSD);
  const usdPerSOL = (liqUSD / 2) / solReserve;
  const priceInUSD = priceInSOL * usdPerSOL;

  // 6. Package and return!
  return {
    // poolAddress:    pool.address,
    poolTimestamp:  pool.timestamp,
    // solLiquidity:   solReserve,
    // tokenLiquidity: formatNumberToKM(tokenReserve),
    priceInSOL:     priceInSOL,
    priceInUSD:     priceInUSD,
    // volumeUSD:      formatNumberToKM(Number(pool.volumeUSD)),
    // lpMint:         pool.lpMint,
    // isCanonical:    pool.isCanonical,
  };
}


export const getTradeData = (filename:string)=>{

  const fileContent = fs.readFileSync(filename, 'utf8');
  const data = JSON.parse(fileContent);
  if (!Array.isArray(data)) {
    throw new Error('The JSON data is not an array.');
  }
 return data;

}


const getTotalProfit = ()=>{

  const data = getTradeData('one-trade.json');
  let totalProfit = 0;

  data.forEach((trade)=>{
    if(trade.compUSDEarned) totalProfit += trade.compUSDEarned
  })

  console.log(`Total Profit is $${totalProfit}`) // $3.7

}



getTotalProfit();