/**
 * FULL E2E VERIFICATION — local hardhat node
 * Verifies everything before mainnet deploy.
 */
import { createRequire } from 'module';
import { randomBytes } from 'crypto';
import fs from 'fs';
const require = createRequire(import.meta.url);

process.chdir('/Users/austingriffith/clawd/zk-api-credits/packages/api-server/node_modules/@aztec/bb.js/dest/node');
const { Barretenberg, Fr, UltraHonkBackend } = await import(
  '/Users/austingriffith/clawd/zk-api-credits/packages/api-server/node_modules/@aztec/bb.js/dest/node/index.js'
);
const { Noir } = require('/Users/austingriffith/clawd/zk-api-credits/packages/nextjs/node_modules/@noir-lang/noir_js/lib/index.cjs');
const { ethers } = await import('/Users/austingriffith/clawd/zk-api-credits/packages/hardhat/node_modules/ethers/lib.esm/index.js');

const LOCAL_RPC = 'http://localhost:8546';
const frToBigInt = (fr) => BigInt('0x' + Buffer.from(fr.value).toString('hex'));
const p2 = async (bb, a, b) => frToBigInt(await bb.poseidon2Hash([new Fr(a), new Fr(b)]));

// Replicates Solidity _computeRoot exactly
async function computeRoot(bb, filledNodes, zeros, size) {
  if (size === 0) return zeros[15];
  let node = 0n, nodeLevel = 0, hasNode = false;
  for (let i = 0; i < 16; i++) {
    if (((size >> i) & 1) === 1) {
      if (!hasNode) {
        node = filledNodes[i]; nodeLevel = i; hasNode = true;
      } else {
        for (let lvl = nodeLevel; lvl < i; lvl++) node = await p2(bb, node, zeros[lvl]);
        node = await p2(bb, filledNodes[i], node);
        nodeLevel = i + 1;
      }
    }
  }
  return node;
}

// Computes depth for a given tree size (matches Solidity)
function computeDepth(size) {
  if (size === 0) return 0;
  let needed = 0, tmp = size;
  while (tmp > 1) { needed++; tmp = Math.ceil(tmp / 2); }
  return needed;
}

console.log('=== FULL E2E VERIFICATION ===\n');

const provider = new ethers.JsonRpcProvider(LOCAL_RPC);
const signers = await provider.listAccounts();
const deployerAddr = signers[0].address, userAddr = signers[1].address;
const deployer = await provider.getSigner(deployerAddr);
const user = await provider.getSigner(userAddr);

const bb = await Barretenberg.new({ threads: 4 });
console.log('bb ready\n');

const arts = '/Users/austingriffith/clawd/zk-api-credits/packages/hardhat/artifacts/contracts';
const mockArt = JSON.parse(fs.readFileSync(`${arts}/MockERC20.sol/MockERC20.json`));
const apiArt = JSON.parse(fs.readFileSync(`${arts}/APICredits.sol/APICredits.json`));

// Deploy
const mockClawd = await (new ethers.ContractFactory(mockArt.abi, mockArt.bytecode, deployer)).deploy();
await mockClawd.waitForDeployment();
const contract = await (new ethers.ContractFactory(apiArt.abi, apiArt.bytecode, deployer)).deploy(
  await mockClawd.getAddress(), deployerAddr
);
await contract.waitForDeployment();
const contractAddr = await contract.getAddress();
console.log('[1] MockERC20:', await mockClawd.getAddress());
console.log('[2] APICredits:', contractAddr);

// Load zeros from contract
const onChainZeros = [];
for (let i = 0; i < 16; i++) onChainZeros.push(await contract.zeros(i));

// Verify zeros match bb.js
console.log('\n[3] Zero hash verification...');
let prev = 0n;
for (let i = 0; i < 6; i++) {
  const expected = i === 0 ? 0n : await p2(bb, prev, prev);
  const match = onChainZeros[i] === expected;
  console.log(`   zeros[${i}]: ${match ? '✅' : '❌ MISMATCH'}`);
  if (!match) process.exit(1);
  prev = onChainZeros[i];
}

// Stake
await mockClawd.mint(userAddr, ethers.parseEther('10000'));
const cu = new ethers.Contract(await mockClawd.getAddress(), mockArt.abi, user);
const au = new ethers.Contract(contractAddr, apiArt.abi, user);
await cu.approve(contractAddr, ethers.parseEther('10000'));
await au.stake(ethers.parseEther('10000'));
console.log('\n[4] Staked 10000 CLAWD');

// Insert 5 leaves and verify root + path for each
const credentials = [];
const filledNodes = new Array(16).fill(0n);
let treeSize = 0;
const leaves = [];

console.log('\n[5] Inserting 5 leaves, verifying root + path after each...');

for (let n = 0; n < 5; n++) {
  const nullifier = BigInt('0x' + randomBytes(31).toString('hex'));
  const secret = BigInt('0x' + randomBytes(31).toString('hex'));
  const commitment = frToBigInt(await bb.poseidon2Hash([new Fr(nullifier), new Fr(secret)]));
  const nullifierHash = frToBigInt(await bb.poseidon2Hash([new Fr(nullifier)]));
  credentials.push({ nullifier, secret, commitment, nullifierHash });

  // Register on-chain
  await au.register(commitment);
  const [, treeDepthBN, onChainRoot] = await contract.getTreeData();
  const treeDepth = Number(treeDepthBN);

  // Update JS tree state (simulate Solidity insert)
  const index = treeSize;
  let node = commitment;
  for (let i = 0; i < 16; i++) {
    if (((index >> i) & 1) === 0) { filledNodes[i] = node; break; }
    else { node = await p2(bb, filledNodes[i], node); }
  }
  treeSize++;
  leaves.push(commitment);

  // Verify JS depth matches contract depth
  const jsDepth = computeDepth(treeSize);
  if (jsDepth !== treeDepth) {
    console.error(`   ❌ depth mismatch: js=${jsDepth} contract=${treeDepth}`); process.exit(1);
  }

  // Compute JS root
  const jsRoot = await computeRoot(bb, filledNodes, onChainZeros, treeSize);
  const rootMatch = jsRoot === onChainRoot;
  process.stdout.write(`   leaf[${n}] depth=${treeDepth} root:${rootMatch ? '✅' : '❌'} `);
  if (!rootMatch) { console.error('\n   JS:', jsRoot.toString()); console.error('   Chain:', onChainRoot.toString()); process.exit(1); }

  // Build level nodes for path extraction
  const levelNodes = [{}];
  for (let i = 0; i < leaves.length; i++) levelNodes[0][i] = leaves[i];
  for (let level = 0; level < treeDepth; level++) {
    levelNodes[level + 1] = {};
    const cnt = Math.ceil(treeSize / (1 << (level + 1)));
    for (let i = 0; i < cnt; i++) {
      const l = levelNodes[level][i * 2], r = levelNodes[level][i * 2 + 1];
      if (l !== undefined && r !== undefined) levelNodes[level + 1][i] = await p2(bb, l, r);
      else if (l !== undefined) levelNodes[level + 1][i] = await p2(bb, l, onChainZeros[level]);
    }
  }

  // Extract path for this leaf
  const siblings = [], indices = [];
  let cur = n;
  for (let i = 0; i < 16; i++) {
    if (i < treeDepth) {
      const sibIdx = cur % 2 === 0 ? cur + 1 : cur - 1;
      siblings.push(levelNodes[i][sibIdx] ?? onChainZeros[i]);
      indices.push(cur % 2);
      cur = Math.floor(cur / 2);
    } else { siblings.push(onChainZeros[i]); indices.push(0); }
  }

  // Verify path (binary_merkle_root: hash exactly `treeDepth` times)
  let pathNode = commitment;
  for (let i = 0; i < treeDepth; i++) {
    pathNode = indices[i] === 0
      ? await p2(bb, pathNode, siblings[i])
      : await p2(bb, siblings[i], pathNode);
  }
  const pathMatch = pathNode === onChainRoot;
  console.log(`path:${pathMatch ? '✅' : '❌'}`);
  if (!pathMatch) { console.error('   Path root:', pathNode.toString()); console.error('   Expected:', onChainRoot.toString()); process.exit(1); }
}

// Generate ZK proof for leaf 4
console.log('\n[6] Generating ZK proof for leaf 4 (depth=3)...');
const cred = credentials[4];
const [, finalDepthBN, finalRoot] = await contract.getTreeData();
const finalDepth = Number(finalDepthBN);

const levelNodes = [{}];
for (let i = 0; i < leaves.length; i++) levelNodes[0][i] = leaves[i];
for (let level = 0; level < finalDepth; level++) {
  levelNodes[level + 1] = {};
  const cnt = Math.ceil(treeSize / (1 << (level + 1)));
  for (let i = 0; i < cnt; i++) {
    const l = levelNodes[level][i * 2], r = levelNodes[level][i * 2 + 1];
    if (l !== undefined && r !== undefined) levelNodes[level + 1][i] = await p2(bb, l, r);
    else if (l !== undefined) levelNodes[level + 1][i] = await p2(bb, l, onChainZeros[level]);
  }
}

const siblings = [], indices = [];
let cur = 4;
for (let i = 0; i < 16; i++) {
  if (i < finalDepth) {
    const sibIdx = cur % 2 === 0 ? cur + 1 : cur - 1;
    siblings.push(levelNodes[i][sibIdx] ?? onChainZeros[i]);
    indices.push(cur % 2);
    cur = Math.floor(cur / 2);
  } else { siblings.push(onChainZeros[i]); indices.push(0); }
}

const circuit = JSON.parse(fs.readFileSync(
  '/Users/austingriffith/clawd/zk-api-credits/packages/circuits/target/circuits.json', 'utf-8'
));
const backend = new UltraHonkBackend(circuit.bytecode);
const noir = new Noir(circuit);

process.stdout.write('   Executing witness... ');
const { witness } = await noir.execute({
  nullifier_hash: cred.nullifierHash.toString(),
  root: finalRoot.toString(),
  depth: finalDepth,
  nullifier: cred.nullifier.toString(),
  secret: cred.secret.toString(),
  indices: indices.map(String),
  siblings: siblings.map(String),
});
console.log('✅');

process.stdout.write('   Generating proof... ');
const { proof, publicInputs } = await backend.generateProof(witness);
console.log(`✅ (${proof.length} bytes)`);

process.stdout.write('   Verifying proof... ');
const ok = await backend.verifyProof({ proof, publicInputs });
console.log(ok ? '✅' : '❌');
if (!ok) { await bb.destroy(); process.exit(1); }

console.log('\n' + '='.repeat(60));
console.log('✅ ALL CHECKS PASSED');
console.log('   ✅ Zero hashes match (contract = bb.js)');
console.log('   ✅ Root matches on-chain for 1, 2, 3, 4, 5 leaves');
console.log('   ✅ Merkle paths verify for all 5 leaves');
console.log('   ✅ ZK proof generates and verifies (leaf 4, depth 3)');
console.log('='.repeat(60));
console.log('\n🚀 SAFE TO DEPLOY TO MAINNET\n');

await bb.destroy();
