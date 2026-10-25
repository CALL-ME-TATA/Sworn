// One-off: create the two wallets the code signs with and write them into .env.
// OWNER registers our agents; ORCHESTRATOR writes feedback. Fund both from Phantom (devnet).
import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';

const ENV = new URL('../../.env', import.meta.url);
let env = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : fs.readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');

for (const name of ['OWNER_PRIVATE_KEY', 'ORCHESTRATOR_PRIVATE_KEY']) {
  const line = env.match(new RegExp(`^${name}=(.*)$`, 'm'));
  let key;
  if (line?.[1]) {
    key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(line[1])));
    console.log(`${name}: kept existing`);
  } else {
    key = Keypair.generate();
    const value = `${name}=${JSON.stringify(Array.from(key.secretKey))}`;
    env = line ? env.replace(line[0], value) : `${env.trimEnd()}\n${value}\n`;
    console.log(`${name}: created`);
  }
  console.log(`  address: ${key.publicKey.toBase58()}`);
}

fs.writeFileSync(ENV, env);
console.log('\nSaved to .env (gitignored). Send devnet SOL from Phantom: ~0.2 SOL to OWNER, ~0.1 SOL to ORCHESTRATOR.');
