
// import { createJupiterApiClient } from "@jup-ag/api";
import dotenv from 'dotenv';
import path from 'path';
import {Keypair,VersionedTransaction, PublicKey,type Connection,type SignatureStatusConfig,type SimulateTransactionConfig} from "@solana/web3.js";
import bs58 from 'bs58';
import {
  info
} from './utils'

dotenv.config({ path: path.resolve(__dirname, '../.env') });


const PUBLIC_ADDRESS = new PublicKey(process.env.PUBLIC_KEY) // 0.06394 SOL // $10.68
const PRV_KEY_STR = process.env.PRIVATE_KEY;


const PRIVATE_KEY = bs58.decode(PRV_KEY_STR);
const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

export const getWalletBalance = async(connection:any)=>{

    const WalletSOLBalance = await connection.getBalance(PUBLIC_ADDRESS)/1e9;
    return WalletSOLBalance;

}


export const jupSwap = async(quoteResponse:any,connection:Connection,type:string): Promise<boolean> =>{

  try{

  console.log(info(`----------------------------- ${type} -----------------------------`))
  // Constants for retry logic
  const MAX_SLIPPAGE_RETRIES = 10;
  const RETRY_DELAY_MS = 800;

  let retryCount = 0;
  let transactionSuccess = false;

      while (!transactionSuccess && retryCount < MAX_SLIPPAGE_RETRIES) {

      if (retryCount > 0) {
        console.log(`Retry attempt ${retryCount} for slippage error...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }

  const swapResponse = await (
        await fetch('https://lite-api.jup.ag/swap/v1/swap', {
            method: 'POST',
            headers: {
            'Content-Type': 'application/json',
            },
            body: JSON.stringify({
            quoteResponse,
            userPublicKey: PUBLIC_ADDRESS,            
            dynamicComputeUnitLimit: true,
            slippageBps:3000, // 30%
            // dynamicSlippage: true,
            prioritizationFeeLamports: {
                  priorityLevelWithMaxLamports: {
                    maxLamports: 900000, // 0.0009 SOL
                    priorityLevel: "high"
                  }
                } 
            })
        })
        ).json();


const transactionBase64 = swapResponse.swapTransaction
const transaction = VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));

 const simulationConfig: SimulateTransactionConfig = {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'processed',
  };

  const simulationResult = await connection.simulateTransaction(
    transaction,
    simulationConfig
  );
  const isSlippageError = checkForSlippageError(simulationResult);


    if (simulationResult.value.err && !isSlippageError) {
        // For non-slippage errors, exit the retry loop
        console.error('Simulation failed:', simulationResult.value.err);
        console.log('Logs:', simulationResult.value.logs);
        console.error('Transaction simulation failed with non-slippage error');
        return false;
      } else if (simulationResult.value.err && isSlippageError) {
        // For slippage errors, increment the retry counter and continue
        console.log('Simulation failed due to slippage error, will retry');
        retryCount++;
        continue;
      } else {
        // Simulation succeeded, proceed with transaction
        console.log('Simulation succeeded');
        console.log('Logs:', simulationResult.value.logs);
        console.log('Units Consumed:', simulationResult.value.unitsConsumed);
        
        transaction.sign([wallet]);
        const transactionBinary = transaction.serialize();

        const signature = await connection.sendRawTransaction(transactionBinary, {
          maxRetries: 2,
          skipPreflight: true
        });

        console.log("HELL SIGNATURE IS : ", signature);
        await waitForConfirmation(connection, signature, "finalized");
        
        transactionSuccess = true;
      }
      
    }

  if (!transactionSuccess) {
      console.error(`Failed after ${MAX_SLIPPAGE_RETRIES} attempts due to persistent slippage errors`);
      return false;
  }

  console.log(info(`----------------------------- ${type} ENDS -----------------------------`))
  return true;

  }catch(error){
    console.error("jupSwap Error : ",error);
    return false;
  }


}



async function waitForConfirmation(
  connection: Connection,
  signature: string,
  target: "processed" | "confirmed" | "finalized" = "finalized",
  interval = 800
): Promise<void> {
  while (true) {
    const resp = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    // console.log('resp is : ',resp);
    const status = resp.value[0];
    if (status) {
      if (status.err) {
        throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
      }
      if (status.confirmationStatus === target) {
        console.log(`Transaction ${signature} reached ${target}!`);
        return;
      }
    }
    // wait a bit before retrying
    await new Promise((r) => setTimeout(r, interval));
  }
}


function checkForSlippageError(simulationResult: any): boolean {
  if (!simulationResult.value.err) return false;
  
  // Check for Custom 6001 error code which indicates slippage exceeded
  if (simulationResult.value.err.InstructionError && 
      simulationResult.value.err.InstructionError[1] && 
      simulationResult.value.err.InstructionError[1].Custom === 6001) {
    return true;
  }
  
  // Additionally check logs for the specific Jupiter error code
  if (simulationResult.value.logs) {
    const logs = simulationResult.value.logs;
    // Check the last log entry for the Jupiter error code for slippage
    const lastLog = logs[logs.length - 1];
    if (lastLog && lastLog.includes("0x1771")) {
      return true;
    }
  }
  
  return false;
}