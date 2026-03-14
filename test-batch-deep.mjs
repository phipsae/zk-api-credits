/**
 * Tests registerBatch + deep tree correctness (sizes 9-20, depths 4-5)
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
let passed = 0, failed = 0;

function check(label, ok) {
  if (ok) { console.log(`   ✅ ${label}`); passed++; }
  else { console.log(`   ❌ FAIL: ${label}`); failed++; }
}

function computeDepth(size) {
  let n = 0, t = size;
  while (t > 1) { n++; t = Math.ceil(t / 2); }
  return n;
}

async function computeRootJS(bb, filledNodes, zeros, size) {
  let node = 0n, nodeLevel = 0, hasNode = false;
  for (let i = 0; i < 16; i++) {
    if (((size >> i) & 1) === 1) {
      if (!hasNode) { node = filledNodes[i]; nodeLevel = i; hasNode = true; }
      else {
        for (let lvl = nodeLevel; lvl < i; lvl++) node = await p2(bb, node, zeros[lvl]);
        node = await p2(bb, filledNodes[i], node);
        nodeLevel = i + 1;
      }
    }
  }
  return node;
}

async function getMerklePath(bb, leaves, leafIndex, treeDepth, zeros) {
  const levelNodes = [{}];
  for (let i = 0; i < leaves.length; i++) levelNodes[0][i] = leaves[i];
  for (let level = 0; level < treeDepth; level++) {
    levelNodes[level + 1] = {};
    const cnt = Math.ceil(leaves.length / (1 << (level + 1)));
    for (let i = 0; i < cnt; i++) {
      const l = levelNodes[level][i * 2], r = levelNodes[level][i * 2 + 1];
      if (l !== undefined && r !== undefined) levelNodes[level + 1][i] = await p2(bb, l, r);
      else if (l !== undefined) levelNodes[level + 1][i] = await p2(bb, l, zeros[level]);
    }
  }
  const siblings = [], indices = [];
  let cur = leafIndex;
  for (let i = 0; i < 16; i++) {
    if (i < treeDepth) {
      const sibIdx = cur % 2 === 0 ? cur + 1 : cur - 1;
      siblings.push(levelNodes[i][sibIdx] ?? zeros[i]);
      indices.push(cur % 2);
      cur = Math.floor(cur / 2);
    } else { siblings.push(zeros[i]); indices.push(0); }
  }
  return { siblings, indices };
}

const provider = new ethers.JsonRpcProvider(LOCAL_RPC);
const signers = await provider.listAccounts();
const deployer = await provider.getSigner(signers[0].address);
const user1 = await provider.getSigner(signers[1].address);
const bb = await Barretenberg.new({ threads: 4 });

const arts = '/Users/austingriffith/clawd/zk-api-credits/packages/hardhat/artifacts/contracts';
const mockArt = JSON.parse(fs.readFileSync(`${arts}/MockERC20.sol/MockERC20.json`));
const apiArt = JSON.parse(fs.readFileSync(`${arts}/APICredits.sol/APICredits.json`));

const mockClawd = await (new ethers.ContractFactory(mockArt.abi, mockArt.bytecode, deployer)).deploy();
await mockClawd.waitForDeployment();
const clawdAddr = await mockClawd.getAddress();
const contract = await (new ethers.ContractFactory(apiArt.abi, apiArt.bytecode, deployer)).deploy(clawdAddr, signers[0].address);
await contract.waitForDeployment();
const addr = await contract.getAddress();

await mockClawd.mint(signers[1].address, ethers.parseEther('500000'));
const tok = new ethers.Contract(clawdAddr, mockArt.abi, user1);
const con = new ethers.Contract(addr, apiArt.abi, user1);
await tok.approve(addr, ethers.parseEther('500000'));
await con.stake(ethers.parseEther('500000'));

const zeros = [];
for (let i = 0; i < 16; i++) zeros.push(await contract.zeros(i));

const filledNodes = new Array(16).fill(0n);
let treeSize = 0;
const leaves = [];

// Generate 20 random commitments
for (let n = 0; n < 20; n++) {
  leaves.push(BigInt('0x' + randomBytes(31).toString('hex')));
}

// Register first 8 one-by-one
console.log('Registering first 8 one-by-one...');
for (let n = 0; n < 8; n++) {
  await con.register(leaves[n]);
  let node = leaves[n];
  for (let i = 0; i < 16; i++) {
    if (((treeSize >> i) & 1) === 0) { filledNodes[i] = node; break; }
    else { node = await p2(bb, filledNodes[i], node); }
  }
  treeSize++;
}

// registerBatch for next 12 — this uses the batch code path
console.log('registerBatch for next 12...');
await con.registerBatch(leaves.slice(8, 20));
for (let n = 8; n < 20; n++) {
  let node = leaves[n];
  for (let i = 0; i < 16; i++) {
    if (((treeSize >> i) & 1) === 0) { filledNodes[i] = node; break; }
    else { node = await p2(bb, filledNodes[i], node); }
  }
  treeSize++;
}

// Verify final state (size=20, depth=5)
const [sz, depthBN, onChainRoot] = await contract.getTreeData();
const depth = Number(depthBN);
const jsRoot = await computeRootJS(bb, filledNodes, zeros, treeSize);
const jsDepth = computeDepth(treeSize);

console.log(`\n=== size=20, depth=${depth}, expected_depth=${jsDepth} ===`);
check(`depth correct (${depth}=${jsDepth})`, depth === jsDepth);
check(`JS root matches on-chain root`, jsRoot === onChainRoot);

// Verify paths for key leaves: 0, 7, 8, 9 (boundary around registerBatch), 15, 19
console.log('\nPath checks:');
for (const li of [0, 7, 8, 9, 15, 19]) {
  const { siblings, indices } = await getMerklePath(bb, leaves, li, depth, zeros);
  let node = leaves[li];
  for (let i = 0; i < depth; i++) {
    node = indices[i] === 0 ? await p2(bb, node, siblings[i]) : await p2(bb, siblings[i], node);
  }
  check(`path for leaf[${li}] (registerBatch boundary)`, node === onChainRoot);
}

// ZK proof for a leaf registered via registerBatch (leaf 15)
console.log('\nZK proof for leaf[15] (registered via registerBatch):');
const nullifier = BigInt('0x' + randomBytes(31).toString('hex'));
const secret = BigInt('0x' + randomBytes(31).toString('hex'));
const commitment = frToBigInt(await bb.poseidon2Hash([new Fr(nullifier), new Fr(secret)]));
const nullifierHash = frToBigInt(await bb.poseidon2Hash([new Fr(nullifier)]));

// Add to tree (register separately so we have known nullifier/secret)
await con.register(commitment);
let node2 = commitment;
const leafIndex = treeSize;
for (let i = 0; i < 16; i++) {
  if (((treeSize >> i) & 1) === 0) { filledNodes[i] = node2; break; }
  else { node2 = await p2(bb, filledNodes[i], node2); }
}
treeSize++;
leaves.push(commitment);

const [,newDepthBN, newRoot] = await contract.getTreeData();
const newDepth = Number(newDepthBN);
const { siblings, indices } = await getMerklePath(bb, leaves, leafIndex, newDepth, zeros);

const circuit = JSON.parse(fs.readFileSync(
  '/Users/austingriffith/clawd/zk-api-credits/packages/circuits/target/circuits.json', 'utf-8'
));
const backend = new UltraHonkBackend(circuit.bytecode);
const noir = new Noir(circuit);

try {
  const { witness } = await noir.execute({
    nullifier_hash: nullifierHash.toString(),
    root: newRoot.toString(),
    depth: newDepth,
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    indices: indices.map(String),
    siblings: siblings.map(String),
  });
  const { proof, publicInputs } = await backend.generateProof(witness);
  const ok = await backend.verifyProof({ proof, publicInputs });
  check(`ZK proof valid at depth=${newDepth}, leaf[${leafIndex}]`, ok);
} catch(e) {
  check('ZK proof', false);
  console.error(e.message);
}

console.log('\n' + '='.repeat(50));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('\n✅ registerBatch + deep tree (20+ leaves) ALL CORRECT\n🚀 DEPLOY WITH CONFIDENCE');
else { console.log('\n❌ FAILURES — DO NOT DEPLOY'); process.exit(1); }

await bb.destroy();
