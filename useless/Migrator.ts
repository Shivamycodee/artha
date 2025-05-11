// *** This code listens to the old migration method of pump.fun were bonding curve was migrated to the raydium pool *** //


import WebSocket from 'ws';
import { Connection, PublicKey } from '@solana/web3.js';
import * as base58 from 'base-58';
import dotenv from 'dotenv';
dotenv.config();
import path from 'path';
import { Buffer } from 'buffer';


dotenv.config({
  path: path.resolve(__dirname, '../.env'),     // point to the parent folder
  debug: true,                                  // optional: see why vars did or didn’t load
});


const WSS_ENDPOINT = process.env.SOLANA_NODE_WSS_ENDPOINT!;
const RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";

const MIGRATION_PROGRAM_ID = new PublicKey('39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg');
const QUOTE_MINT_SOL = 'So11111111111111111111111111111111111111112';

// Precomputed constants
const MARKET_DISCRIMINATOR = base58.encode(Buffer.from([0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc]));

interface MigrationData {
  timestamp: bigint;
  index: number;
  creator: string;
  baseMint: string;
  quoteMint: string;
  baseMintDecimals: number;
  quoteMintDecimals: number;
  baseAmountIn: bigint;
  quoteAmountIn: bigint;
  poolBaseAmount: bigint;
  poolQuoteAmount: bigint;
  minimumLiquidity: bigint;
  initialLiquidity: bigint;
  lpTokenAmountOut: bigint;
  poolBump: number;
  pool: string;
  lpMint: string;
  userBaseTokenAccount: string;
  userQuoteTokenAccount: string;
}

class DetectionTracker {
  private migrationCounts: Map<string, number> = new Map();
  private migrationEvents: Set<string> = new Set();

  addMigration(baseMint: string, provider: string) {
    const key = `${provider}_${baseMint}`;
    if (!this.migrationEvents.has(key)) {
      this.migrationEvents.add(key);
      const count = this.migrationCounts.get(provider) || 0;
      this.migrationCounts.set(provider, count + 1);
    }
  }

  printSummary() {
    console.log('\nMigration Detection Summary:');
    this.migrationCounts.forEach((count, provider) => {
      console.log(`${provider}: ${count} migrations detected`);
    });
  }
}

function parseMigrateInstruction(data: Buffer): MigrationData | null {
  try {
    let offset = 8; // Skip discriminator

    const readPubkey = () => {
      const pubkey = new PublicKey(data.subarray(offset, offset + 32));
      offset += 32;
      return pubkey.toBase58();
    };

    const parsed: MigrationData = {
      timestamp: data.readBigInt64LE(offset),
      index: data.readUInt16LE(offset += 8),
      creator: readPubkey(),
      baseMint: readPubkey(),
      quoteMint: readPubkey(),
      baseMintDecimals: data.readUInt8(offset),
      quoteMintDecimals: data.readUInt8(offset += 1),
      baseAmountIn: data.readBigUInt64LE(offset += 1),
      quoteAmountIn: data.readBigUInt64LE(offset += 8),
      poolBaseAmount: data.readBigUInt64LE(offset += 8),
      poolQuoteAmount: data.readBigUInt64LE(offset += 8),
      minimumLiquidity: data.readBigUInt64LE(offset += 8),
      initialLiquidity: data.readBigUInt64LE(offset += 8),
      lpTokenAmountOut: data.readBigUInt64LE(offset += 8),
      poolBump: data.readUInt8(offset += 8),
      pool: readPubkey(),
      lpMint: readPubkey(),
      userBaseTokenAccount: readPubkey(),
      userQuoteTokenAccount: readPubkey(),
    };

    return parsed;
  } catch (error) {
    console.error('Error parsing migration data:', error);
    return null;
  }
}

function isTransactionSuccessful(logs: string[]): boolean {
  return !logs.some(log => log.includes('AnchorError thrown') || log.includes('Error'));
}

async function listenForMigrations(wssUrl: string, providerName: string, tracker: DetectionTracker) {
  const knownEvents = new Set<string>();

  while (true) {
    const ws = new WebSocket(wssUrl);

    ws.on('open', async () => {
      console.log(`Connected to ${providerName} migration listener`);
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'logsSubscribe',
        params: [
          { mentions: [MIGRATION_PROGRAM_ID.toBase58()] },
          { commitment: 'processed' }
        ]
      }));
    });

    ws.on('message', async (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'logsNotification') {
        const logs = msg.params.result.value.logs || [];
        
        if (!isTransactionSuccessful(logs)) return;
        if (!logs.some((log:any) => log.includes('Instruction: Migrate'))) return;
        if (logs.some((log:any) => log.includes('already migrated'))) return;

        const programLog = logs.find((log: string) => log.startsWith('Program data:'));
        if (!programLog) return;

        try {
          const base64Data = programLog.split(': ')[1];
          const rawData = Buffer.from(base64Data, 'base64');
          const parsed = parseMigrateInstruction(rawData);
          
          if (parsed && parsed.baseMint) {
            const eventKey = `${providerName}_${parsed.baseMint}`;
            if (!knownEvents.has(eventKey)) {
              tracker.addMigration(parsed.baseMint, providerName);
              knownEvents.add(eventKey);
              console.log(`New migration detected on ${providerName}:`);
              console.log(`Base Mint: ${parsed.baseMint}`);
              console.log(`Creator: ${parsed.creator}`);
              console.log(`LP Mint: ${parsed.lpMint}`);
            }
          }
        } catch (error) {
          console.error('Error processing migration:', error);
        }
      }
    });

    ws.on('close', () => {
      console.log(`Disconnected from ${providerName}, reconnecting...`);
    });

    ws.on('error', (error) => {
      console.error(`${providerName} WebSocket error:`, error);
    });

    // Wait for connection to close before reconnecting
    await new Promise(resolve => ws.once('close', resolve));
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

async function main() {
  const tracker = new DetectionTracker();
  const providers = {
    'mainnet-beta': WSS_ENDPOINT,
    'custom-provider':RPC_ENDPOINT
  };

  const tasks = Object.entries(providers).map(([name, url]) => 
    listenForMigrations(url, name, tracker)
  );

  // Run for 10 minutes
  setTimeout(() => {
    tracker.printSummary();
    process.exit(0);
  }, 600_000);

  await Promise.all(tasks);
}

main().catch(console.error);