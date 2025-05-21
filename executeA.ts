import WebSocket from 'ws';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  success,
  info,
  warning,
  error,
  WSS_ENDPOINT,
  RPC_ENDPOINT,
  PUMP_AMM_PROGRAM_ID,
  MARKET_ACCOUNT_LENGTH,
  MARKET_DISCRIMINATOR,
  QUOTE_MINT_SOL,
  getFormattedUTCTime,
  fetchExistingMarketPubkeys,
  parseMarketAccountData,
  getPoolInfo,
  formatNumberToKM
} from './utils.ts';
import fs from 'fs';
import {simulateProfitLogic} from './oneTrade.ts';
// import {recordToken} from './record-price/priceTracker.ts'

const connection = new Connection(RPC_ENDPOINT);

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

  console.log(success(`\n STARTED MONITORING... ${getFormattedUTCTime()} :`));

  const processingPubkeys = new Set<string>();
  let knownPubkeys = await fetchExistingMarketPubkeys(connection);
  console.log(`Loaded ${knownPubkeys.size} existing markets`);


  const handleMarketCreation = async (pubkey: string, rawData: Buffer) => {
    if (processingPubkeys.has(pubkey) || knownPubkeys.has(pubkey)) return;
    processingPubkeys.add(pubkey);

    try{

          const parsed = parseMarketAccountData(rawData);
            if (!parsed) return;
      
            const isQuickPool = PublicKey.isOnCurve(new PublicKey(parsed.creator));
            
            if(isQuickPool) {
              processingPubkeys.delete(pubkey)
              return
            }
      
            // console.log('Full Parsed Data : ',parsed);

            knownPubkeys.add(pubkey);
            console.log(success(`\n🚀 New Meme Token ${warning(parsed.baseMint)} Detected at ${getFormattedUTCTime()} :`));

            let poolInfo;
            let liquidity;
            let memeDecimal;

            while(true){
              try{
                poolInfo = await getPoolInfo(parsed.baseMint);
                liquidity = Number(poolInfo.liquidityUSD);
                memeDecimal = Number(poolInfo.baseMintDecimals);
                if(liquidity) break;
                new Promise((r)=>setTimeout(r,800));
              }catch(e){}
            }
      
            saveTradeRecord({
              time:getFormattedUTCTime(),
              token:parsed.baseMint,
              liquidity:formatNumberToKM(liquidity)
            })

            simulateProfitLogic(parsed.baseMint,memeDecimal);
            // recordToken(parsed.baseMint,new Date(),liquidity);


    } catch (err) {
      console.error(error('Processing error:'), err);
    } finally {
      processingPubkeys.delete(pubkey);
    }

  }

   const createWebSocket = () => {
      const ws = new WebSocket(WSS_ENDPOINT);
  
      ws.on('open', () => {
        console.log('WebSocket connected 💡');
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'programSubscribe',
          params: [
            PUMP_AMM_PROGRAM_ID.toBase58(),
            {
              encoding: 'base64',
              commitment: 'confirmed',
              filters: [
                { dataSize: 243 },
                { memcmp: { offset: 0, bytes: MARKET_DISCRIMINATOR } },
                { memcmp: { offset: 75, bytes: QUOTE_MINT_SOL } }
              ]
            }
          ]
        }));
      });
  
      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.method === 'programNotification') {
            const { pubkey, account } = msg.params.result.value;
            const rawData = Buffer.from(account.data[0], 'base64');
            handleMarketCreation(pubkey, rawData);
          }
        } catch (e) {
          console.error(error('Message parsing error:'), e);
        }
      });
  
      ws.on('close', () => {
        console.log('WebSocket disconnected, reconnecting in 5s...');
        setTimeout(createWebSocket, 5000);
      });
  
      ws.on('error', (err) => {
        console.error(error('WebSocket error:'), err);
        ws.close();
      });
    };
  
    createWebSocket();

}

listenForNewMarkets().catch(console.error);