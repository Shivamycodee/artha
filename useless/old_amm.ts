import path from 'path';
import dotenv from 'dotenv';
dotenv.config();
import WebSocket from 'ws';
import { Connection, PublicKey } from '@solana/web3.js';
import * as base58 from 'base-58';
// import TokenInfo from './info';


dotenv.config({
  path: path.resolve(__dirname, '../.env'),     // point to the parent folder
  debug: true,                                  // optional: see why vars did or didn’t load
});

const WSS_ENDPOINT = process.env.SOLANA_NODE_WSS_ENDPOINT!;
const RPC_ENDPOINT = process.env.PUBLIC_RPC_URL!;
const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

// Precomputed constants
const MARKET_ACCOUNT_LENGTH = 211; // 8 + 1 + 2 + 32*6 + 8
const DISCRIMINATOR = Buffer.from([0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc]);
const MARKET_DISCRIMINATOR = base58.encode(DISCRIMINATOR);
const QUOTE_MINT_SOL = 'So11111111111111111111111111111111111111112';

interface MarketAccountData {
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

async function fetchExistingMarketPubkeys(): Promise<Set<string>> {
  const connection = new Connection(RPC_ENDPOINT, 'processed');
  const filters: any[] = [
    { dataSize: MARKET_ACCOUNT_LENGTH },
    { memcmp: { offset: 0, bytes: MARKET_DISCRIMINATOR } },
    { memcmp: { offset: 75, bytes: QUOTE_MINT_SOL } }
  ];

  const accounts = await connection.getProgramAccounts(PUMP_AMM_PROGRAM_ID, { filters });
  return new Set(accounts.map(account => account.pubkey.toBase58()));
}

function parseMarketAccountData(data: Buffer): MarketAccountData | null {
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

async function listenForNewMarkets() {
  let knownPubkeys = await fetchExistingMarketPubkeys();
  console.log(`Loaded ${knownPubkeys.size} existing markets`);

  while (true) {
    console.log('Connecting to WebSocket...',WSS_ENDPOINT);
    const ws = new WebSocket(WSS_ENDPOINT);
    
    ws.on('open', async () => {
      console.log('WebSocket connected');
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
      const msg = JSON.parse(data.toString());
      if (msg.method === 'programNotification') {
        const { pubkey, account } = msg.params.result.value;
        const slot = msg.params.result.context.slot;

        if (knownPubkeys.has(pubkey)) return;

        try {
          const rawData = Buffer.from(account.data[0], 'base64');
          const parsed = parseMarketAccountData(rawData);
          if (!parsed) return;

          const creator = new PublicKey(parsed.creator);
          console.log('Creator:', creator.toBase58());
          if (PublicKey.isOnCurve(creator)) {
            console.log("Time :", Date.now());
            console.log('Skipping user-created market');
            return;
          }

          
          console.log('\nNew market detected:');
          console.log("Time :", Date.now());
          console.log('Pubkey:', pubkey);
          console.log('Slot:', slot);
          console.log('Index :', parsed.index);
          console.log('Pool Bump:', parsed.poolBump);
          console.log('Base Mint:', parsed.baseMint);
          console.log('Quote Mint:', parsed.quoteMint);
          console.log('LP Mint:', parsed.lpMint);
          console.log('Creator:', parsed.creator);
          console.log('Base Mint:', parsed.baseMint);
          console.log('LP Supply:', parsed.lpSupply);



          knownPubkeys.add(pubkey);
        } catch (error) {
          console.error('Error processing market:', error);
        }
      }
    });

    ws.on('close', () => {
      console.log('WebSocket disconnected, reconnecting...');
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    // Reconnect on close
    await new Promise(resolve => ws.once('close', resolve));
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

listenForNewMarkets().catch(console.error);