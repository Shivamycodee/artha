// priceTracker.ts
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TOKEN_PRICE_URL } from '../utils';

interface SinglePoint {
  timestampSec: number;
  price: number;
}
interface TokenLog {
  createdAt: string;          // ISO
  history: SinglePoint[];
}
interface ProjectLog {
  [tokenAddress: string]: TokenLog;
}

const DATA_FILE = join(process.cwd(), 'token-price-log.json');
let projectLog: ProjectLog = {};

// load existing file if present
if (existsSync(DATA_FILE)) {
  try {
    projectLog = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Could not parse existing JSON, starting fresh.', e);
    projectLog = {};
  }
}

export async function recordToken(tokenAddress: string, createdAt: Date) {

  console.log("It's started....")

  // initialize if first time
  if (!projectLog[tokenAddress]) {
    projectLog[tokenAddress] = {
      createdAt: createdAt.toISOString(),
      history: []
    };
  }

  const interval = setInterval(async () => {
    try {
      const priceResponse = await fetch(`${TOKEN_PRICE_URL}${tokenAddress}/price`);
      const price:any = await priceResponse.json() as { price: number };

      const elapsed = Math.floor((Date.now() - createdAt.getTime()) / 1000);
      projectLog[tokenAddress].history.push({ timestampSec: elapsed, price });

      // flush to disk every 10 samples
      if (projectLog[tokenAddress].history.length % 10 === 0 && price) {
        writeFileSync(DATA_FILE, JSON.stringify(projectLog, null, 2), 'utf8');
      }
    } catch (error) {
      console.error(`Error fetching price for ${tokenAddress}:`, error);
    }
  }, 1000);

  // track interval if you need to clear later
  return interval;
}


// recordToken('ADi9GqcecN2Um8qqEhKa1UZx9hHmDx7XJUGFcormpump',new Date());