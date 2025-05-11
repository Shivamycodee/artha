// ** This code is useless , AMM provides all the needed data ** /

import { Connection, PublicKey, type MemcmpFilter } from "@solana/web3.js";


const RPC_ENDPOINT = "https://mainnet.helius-rpc.com/";
const PUMP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const TOKEN_MINT = new PublicKey("35ySx7Rt3RqeTp75QB81FgRvPT5yDY2m5BupsUYDpump");

interface MarketData {
    pool_bump: number;
    index: number;
    creator: string;
    base_mint: string;
    quote_mint: string;
    lp_mint: string;
    pool_base_token_account: string;
    pool_quote_token_account: string;
    lp_supply: bigint;
}

async function getMarketAddressByBaseMint(RPC_ENDPOINT:string,baseMintAddress: PublicKey, ammProgramId: PublicKey): Promise<PublicKey> {
    const connection = new Connection(RPC_ENDPOINT);
    
    // Define the filter to match the base_mint
    const offset = 43;
    const filters: MemcmpFilter[] = [{
        memcmp: {
            offset: offset,
            bytes: baseMintAddress.toBase58()
        }
    }];

    // Retrieve the accounts that match the filter
    const response = await connection.getProgramAccounts(
        ammProgramId,
        {
            filters: filters,
            commitment: "confirmed"
        }
    );

    if (response.length === 0) {
        throw new Error("No market found for the given base mint");
    }

    return response[0].pubkey;
}

async function getMarketData(RPC_ENDPOINT:string,marketAddress: PublicKey): Promise<MarketData> {
    const connection = new Connection(RPC_ENDPOINT);
    const accountInfo = await connection.getAccountInfo(marketAddress);
    
    if (!accountInfo?.data) {
        throw new Error("Account data not found");
    }

    const data = accountInfo.data;
    const parsedData: Partial<MarketData> = {};
    let offset = 8;

    // Helper function to read pubkey from buffer
    const readPubkey = (): string => {
        const pubkeyBytes = data.subarray(offset, offset + 32);
        offset += 32;
        return new PublicKey(pubkeyBytes).toBase58();
    };

    // Parse fields according to their types
    parsedData.pool_bump = data.readUInt8(offset++);
    parsedData.index = data.readUInt16LE(offset);
    offset += 2;
    
    parsedData.creator = readPubkey();
    parsedData.base_mint = readPubkey();
    parsedData.quote_mint = readPubkey();
    parsedData.lp_mint = readPubkey();
    parsedData.pool_base_token_account = readPubkey();
    parsedData.pool_quote_token_account = readPubkey();

    // Read u64 as BigInt
    const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
    parsedData.lp_supply = dataView.getBigUint64(offset, true);
    offset += 8;

    return parsedData as MarketData;
}

// export default 
async function TokenInfo(RPC_ENDPOINT:string, PUMP_AMM_PROGRAM_ID:PublicKey, TOKEN_MINT:PublicKey) {
    try {
        const marketAddress = await getMarketAddressByBaseMint(RPC_ENDPOINT,TOKEN_MINT, PUMP_AMM_PROGRAM_ID);
        console.log("Market Address:", marketAddress.toBase58());

        const marketData = await getMarketData(RPC_ENDPOINT,marketAddress);
        console.log("Market Data:", {
            ...marketData,
            lp_supply: marketData.lp_supply.toString() // Convert BigInt to string for logging
        });
    } catch (error) {
        console.error("Error:", error);
    }
}

TokenInfo(RPC_ENDPOINT,PUMP_AMM_PROGRAM_ID,TOKEN_MINT).catch(console.error);