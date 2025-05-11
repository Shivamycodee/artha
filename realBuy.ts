
import { createJupiterApiClient } from "@jup-ag/api";
import {LAMPORTS_PER_SOL, PublicKey} from "@solana/web3.js";


const jupiterQuoteApi = createJupiterApiClient();

const PUBLIC_ADDRESS = new PublicKey('8HgkfryHVaRwEpqHV1tMHtYKWL9vLzZZaWyMSC4G3nUY');
const PRIVATE_KEY = '';



export const realBuy = async(quoteResponse:any)=>{

    const swapResponse = await (
        await fetch('https://lite-api.jup.ag/swap/v1/swap', {
            method: 'POST',
            headers: {
            'Content-Type': 'application/json',
            },
            body: JSON.stringify({
            quoteResponse,
            userPublicKey: PUBLIC_ADDRESS,
            
            // ADDITIONAL PARAMETERS TO OPTIMIZE FOR TRANSACTION LANDING
            // See next guide to optimize for transaction landing
            dynamicComputeUnitLimit: true,
            // dynamicSlippage: true,
            slippageBps:2000,
            prioritizationFeeLamports: {
                  priorityLevelWithMaxLamports: {
                    // maxLamports: 1000000, // 0.001 SOL
                    maxLamports: 313656, // 0.000313656 SOL  
                    priorityLevel: "high"
                  }
                } 
            })
        })
        ).json();



    console.log('REAL BUY INSTRUCTIONS : ',swapResponse);


}


// REAL BUY INSTRUCTIONS :  {
//   swapTransaction: "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAGCWxIDNq70kCrgso88h9Zl+SPGPmtdD8bOZeB2B3IVBnxqZNsE0XAF0SXovsMqTF9Upfg5PIieKXKBvQcKOjxbOPneGo8obExz6XfzD8yfug/O6zWIs398qtaZuTOUwE2OgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwZGb+UhFzL/7K26csOb57yM5bvF9xJrLEObOkAAAAAEedVb8jHAbu50xW7OaBUH/bGy3qP0jlECsc2iVrwTjwbd9uHXZaGT2cvhRs7reawctIXtX1s3kTqM9YV+/wCpjJclj04kifG7PRApFI4NgwtaE5na/xCEBI572Nvp+Fm0P/on9df2SnTAmx8pWHneSwmrNt/J3VFLMhqns4zl6PGjs1zbMr9MwmmEukMPAeZBWTxoQyOYQ02TWE/PzOdoCAQABQLAXBUABAAJAyhrAwAAAAAABwYAAgANAwYBAQMCAAIMAgAAAICWmAAAAAAABgECAREHBgABAAwDBgEBBRsGAAIBBQwFCAUOEAARDA0BAgsJDwoGBgMHEg4j5RfLl3rjrSoBAAAASGQAAYCWmAAAAAAANZBCtgAAAADQBwAGAwIAAAEJAdL1PudW7wwptA/LKvm+YM5m+91BTi5gwfDIbxQzImyhA14EsQdkEAYDtQEJ",
//   lastValidBlockHeight: 317252774,
//   prioritizationFeeLamports: 313656,
//   computeUnitLimit: 1400000,
//   prioritizationType: {
//     computeBudget: {
//       microLamports: 224040,
//       estimatedMicroLamports: 317892,
//     },
//   },
//   simulationSlot: 339029649,
//   dynamicSlippageReport: null,
//   simulationError: {
//     errorCode: "TRANSACTION_ERROR",
//     error: "Error processing Instruction 2: custom program error: 0x1",
//   },
//   addressesByLookupTableAddress: null,
// }