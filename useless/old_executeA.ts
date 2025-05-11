import WebSocket from 'ws';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  timer,
  success,
  info,
  warning,
  error,
  highlight,
  REALISTIC_SWAP_CU,
  MICRO_LAMPORTS_PER_CU,
  WSS_ENDPOINT,
  RPC_ENDPOINT,
  PUMP_AMM_PROGRAM_ID,
  MARKET_ACCOUNT_LENGTH,
  MARKET_DISCRIMINATOR,
  QUOTE_MINT_SOL,
  type MarketAccountData,
  type TradeFees,
  type EnhancedMarketData,
  getFormattedUTCTime,
  fetchExistingMarketPubkeys,
  parseMarketAccountData
} from '../utils.ts';
import fs from 'fs';
import { parse } from 'path';


const connection = new Connection(RPC_ENDPOINT);

// 3.2 used
// Add price calculation function
async function calculateTokenPrice(poolQuoteTokenAccount: string): Promise<number> {
  // const connection = new Connection(RPC_ENDPOINT);
  try {
    const quoteTokenAccount = await connection.getTokenAccountBalance(
      new PublicKey(poolQuoteTokenAccount)
    ).catch(async () => {
      // Fallback to getAccountInfo if token balance fails
      const accInfo = await connection.getAccountInfo(new PublicKey(poolQuoteTokenAccount));
      if (!accInfo) return { value: null };
      return {
        value: {
          amount: accInfo.lamports.toString(),
          decimals: 9,
          uiAmount: accInfo.lamports / Math.pow(10, 9)
        }
      };
    });

    if (!quoteTokenAccount.value) return 0;
    
    const solReserve = Number(quoteTokenAccount.value.amount) / Math.pow(10, quoteTokenAccount.value.decimals || 9);
    return solReserve;
  } catch (error) {
    console.error('Error calculating token price:', error);
    return 0;
  }
}

// 3.3 used
// Add fee estimation function
async function estimateTradeFees(): Promise<TradeFees> {
  const recentFees = await connection.getRecentPrioritizationFees();
  
  // Filter valid fees and calculate average
  const validFees = recentFees.filter(f => f.prioritizationFee > 0);
  const avgPriorityFee = validFees.length > 0 ? 
    validFees.slice(-5).reduce((acc, fee) => acc + fee.prioritizationFee, 0) / validFees.length :
    MICRO_LAMPORTS_PER_CU;

  const calculateFees = () => ({
    baseFee: 5000, // Base fee per transaction
    priorityFee: Math.ceil((avgPriorityFee * REALISTIC_SWAP_CU) / 1000000) // Convert µ-lamports to lamports
  });

  return {
    buy: {
      ...calculateFees(),
      totalFee: (5000 + (avgPriorityFee * REALISTIC_SWAP_CU / 1000000)) / 1e9
    },
    sell: {
      ...calculateFees(),
      totalFee: (5000 + (avgPriorityFee * REALISTIC_SWAP_CU / 1000000)) / 1e9
    }
  };
}

// 3.1 used
async function getTokenMetadata(mintAddress: PublicKey) {
  // const connection = new Connection(RPC_ENDPOINT);
  try {
    const accountInfo = await connection.getAccountInfo(mintAddress);
    if (!accountInfo?.data) return null;

    const metadata = {
      supply: Number(accountInfo.data.readBigUInt64LE(36)),
      decimals: accountInfo.data[44],
      freezeAuthority: new PublicKey(accountInfo.data.subarray(45, 77)).toBase58(),
      isMintable: accountInfo.data[77] === 1
    };
    
    return metadata;
  } catch (e) {
    return null;
  }
}


// 4th used
// Update the formatOutput function
function formatOutput(data: EnhancedMarketData) {
  console.log(warning.bold('\n════════ New Migrated Pool Detected ════════'));
  console.log(info(`⏱️  Detection Time: ${highlight(getFormattedUTCTime())} & Timestamp is : ${Date.now()}`));
  console.log(success(`🆔 Token Mint: ${highlight(data.baseMint)}`));
  console.log(info(`👷 Creator: ${data.creator} ${PublicKey.isOnCurve(new PublicKey(data.creator)) ? '🔴 (User)' : '🟢 (Program)'}`));
  console.log(warning(`💰 LP Supply: ${Number(data.lpSupply).toLocaleString()}`));
  
  if (data.price) {
    console.log(success(`💵 Price: ${data.price.toFixed(9)} SOL`));
  }
  
  if (data.freezeAuthority) {
    console.log(warning(`❄️  Freeze Authority: ${data.freezeAuthority === data.creator ? '🔴 Creator' : '🟢 Program'}`));
  }
  
  if (data.creatorHoldings) {
    console.log(error(`⚠️  Creator Holdings: ${data.creatorHoldings}%`));
  }

  if (data.fees) {
    console.log(info(`⛽ Buy Fees: ${data.fees.buy.totalFee.toFixed(6)} SOL (Base: ${data.fees.buy.baseFee} lamports, Priority: ${data.fees.buy.priorityFee} lamports)`));
    console.log(info(`⛽ Sell Fees: ${data.fees.sell.totalFee.toFixed(6)} SOL (Base: ${data.fees.sell.baseFee} lamports, Priority: ${data.fees.sell.priorityFee} lamports)`));
  }
  
  console.log(warning.bold('═══════════════════════════════════════════\n'));
}


// 3rd used
// Update the enhancedAnalysis function
async function enhancedAnalysis(baseMint: string, creator: string, poolQuoteTokenAccount: string) {
  // const connection = new Connection(RPC_ENDPOINT);
  const mintPublicKey = new PublicKey(baseMint);
  const creatorPublicKey = new PublicKey(creator);

  try {
    // Get creator's associated token address
    const [ata] = PublicKey.findProgramAddressSync(
      [
        creatorPublicKey.toBuffer(),
        new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(),
        mintPublicKey.toBuffer(),
      ],
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
    );

    const [supplyInfo, creatorBalance, price, fees] = await Promise.all([
      getTokenMetadata(mintPublicKey),
      connection.getTokenAccountBalance(ata).catch(() => ({ value: null })), // Proper error handling
      calculateTokenPrice(poolQuoteTokenAccount),
      estimateTradeFees()
    ]);

    const analysis: Partial<EnhancedMarketData> = { 
      price,
      fees,
      freezeAuthority: supplyInfo?.freezeAuthority 
    };

    if (supplyInfo) {
      const totalSupply = supplyInfo.supply / Math.pow(10, supplyInfo.decimals);
      const creatorHolding = creatorBalance?.value?.amount ?
        Number(creatorBalance.value.amount) / Math.pow(10, supplyInfo.decimals) :
        0;

      analysis.creatorHoldings = totalSupply > 0 ?
        ((creatorHolding / totalSupply) * 100).toFixed(2) :
        '0.00';
    }

    return analysis;
  } catch (e) {
    console.error(error('Analysis error:'), e);
    return {};
  }
}

const TOKENS_FILE = "tokens-log.json";

// Initialize log file
if (!fs.existsSync(TOKENS_FILE)) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify([], null, 2));
}

function saveTradeRecord(record: any) {
  const trades = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"));
  trades.push(record);
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(trades, null, 2));
}

// main function...
async function listenForNewMarkets() {

  let count = 0;

  const processingPubkeys = new Set<string>();
  let knownPubkeys = await fetchExistingMarketPubkeys(connection);
  console.log(`Loaded ${knownPubkeys.size} existing markets`);

  while (true) {
    console.log('Connecting to WebSocket...');
    const ws = new WebSocket(WSS_ENDPOINT);
    
    ws.on('open', async () => {
      console.log('WebSocket connected 💡');
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'programSubscribe',
        params: [
          PUMP_AMM_PROGRAM_ID.toBase58(),
          {
            encoding: 'base64',
            commitment: 'processed',
            filters: [
              { dataSize: MARKET_ACCOUNT_LENGTH },
              { memcmp: { offset: 0, bytes: MARKET_DISCRIMINATOR } },
              { memcmp: { offset: 75, bytes: QUOTE_MINT_SOL } }
            ]
          }
        ]
      }));
    });

    ws.on('message', async (data) => {
      count++;
      if(count == 10) return;
      const startTime = Date.now();
      timer.start();

      try {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'programNotification') {
          const detectionTime = Date.now();
          const { pubkey, account } = msg.params.result.value;

          if (knownPubkeys.has(pubkey)) return;

          const rawData = Buffer.from(account.data[0], 'base64');
          const parsed = parseMarketAccountData(rawData);
          if (!parsed) return;

          if(PublicKey.isOnCurve(new PublicKey(parsed.creator))) return console.log(warning("Qick Pool Found: ",parsed.baseMint));

        console.log(info(`New Pool DETECTED 💵: ${highlight(getFormattedUTCTime())}`));


          const [additionalData] = await Promise.all([
            enhancedAnalysis(parsed.baseMint, parsed.creator, parsed.poolQuoteTokenAccount),
          ]);

          const fullData: EnhancedMarketData = {
            ...parsed,
            ...additionalData,
            detectedIn: Date.now() - detectionTime,
          };

          formatOutput(fullData);
          knownPubkeys.add(pubkey);
          
          timer.end();
          console.log(info(`⏱️  Total processing time: ${Date.now() - startTime}ms`));
        }
      } catch (error) {
        console.error(error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket disconnected, reconnecting...');
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    await new Promise(resolve => ws.once('close', resolve));
    await new Promise(resolve => setTimeout(resolve, 5000));
  }


}

listenForNewMarkets().catch(console.error);