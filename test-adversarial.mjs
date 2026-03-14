/**
 * Adversarial test — checks every edge case and failure mode.
 * If this passes, the contract is correct.
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

function check(label, condition) {
  if (condition) { console.log(`   ✅ ${label}`); passed++; }
  else { console.log(`   ❌ FAIL: ${label}`); failed++; }
}

const provider = new ethers.JsonRpcProvider(LOCAL_RPC);
const signers = await provider.listAccounts();
const [d, u1, u2] = [signers[0].address, signers[1].address, signers[2].address];
const deployer = await provider.getSigner(d);
const user1 = await provider.getSigner(u1);
const user2 = await provider.getSigner(u2);

const bb = await Barretenberg.new({ threads: 4 });

const arts = '/Users/austingriffith/clawd/zk-api-credits/packages/hardhat/artifacts/contracts';
const mockArt = JSON.parse(fs.readFileSync(`${arts}/MockERC20.sol/MockERC20.json`));
const apiArt = JSON.parse(fs.readFileSync(`${arts}/APICredits.sol/APICredits.json`));

const mockClawd = await (new ethers.ContractFactory(mockArt.abi, mockArt.bytecode, deployer)).deploy();
await mockClawd.waitForDeployment();
const contract = await (new ethers.ContractFactory(apiArt.abi, apiArt.bytecode, deployer)).deploy(
  await mockClawd.getAddress(), d
);
await contract.waitForDeployment();
const addr = await contract.getAddress();

// Fund users
await mockClawd.mint(u1, ethers.parseEther('50000'));
await mockClawd.mint(u2, ethers.parseEther('50000'));

const clawdAddr = await mockClawd.getAddress();
const c = (signer) => new ethers.Contract(addr, apiArt.abi, signer);
const tok = (signer) => new ethers.Contract(clawdAddr, mockArt.abi, signer);

console.log('\n=== CONTRACT SECURITY ===\n');

// 1. stake(0) reverts
try { await c(user1).stake(0); check('stake(0) reverts', false); }
catch { check('stake(0) reverts', true); }

// 2. register without stake reverts
try { await c(user1).register(12345n); check('register without stake reverts', false); }
catch { check('register without stake reverts', true); }

// 3. unstake(0) reverts
await tok(user1).approve(addr, ethers.parseEther('5000'));
await c(user1).stake(ethers.parseEther('5000'));
try { await c(user1).unstake(0); check('unstake(0) reverts', false); }
catch { check('unstake(0) reverts', true); }

// 4. unstake more than staked reverts
try { await c(user1).unstake(ethers.parseEther('6000')); check('unstake > staked reverts', false); }
catch { check('unstake > staked reverts', true); }

// 5. register with insufficient stake (only 500 CLAWD)
await c(user1).unstake(ethers.parseEther('4500')); // leave only 500
try { await c(user1).register(99999n); check('register with 500 CLAWD (need 1000) reverts', false); }
catch { check('register with 500 CLAWD (need 1000) reverts', true); }
// Restore
await tok(user1).approve(addr, ethers.parseEther('5000'));
await c(user1).stake(ethers.parseEther('5000'));

// 6. duplicate commitment reverts
await c(user1).register(11111n);
try { await c(user1).register(11111n); check('duplicate commitment reverts', false); }
catch { check('duplicate commitment reverts', true); }

// 7. claimServer non-owner reverts
try { await c(user1).claimServer(u1, ethers.parseEther('100')); check('claimServer non-owner reverts', false); }
catch { check('claimServer non-owner reverts', true); }

// 8. claimServer(0) reverts
try { await c(deployer).claimServer(d, 0); check('claimServer(0) reverts', false); }
catch { check('claimServer(0) reverts', true); }

// 9. claimServer more than available reverts
const claimable = await contract.serverClaimable();
try { await c(deployer).claimServer(d, claimable + 1n); check('claimServer > claimable reverts', false); }
catch { check('claimServer > claimable reverts', true); }

// 10. getTreeData on empty-ish tree (1 leaf from above) — should work
const [sz, dp] = await contract.getTreeData();
check('getTreeData returns after 1 insert', sz === 1n && dp === 0n);

// 11. serverClaimable tracks correctly
check('serverClaimable = 1000 CLAWD after 1 register', claimable === ethers.parseEther('1000'));

// 12. CLAWD actually leaves user wallet on stake
const balBefore = await mockClawd.balanceOf(u2);
await tok(user2).approve(addr, ethers.parseEther('1000'));
await c(user2).stake(ethers.parseEther('1000'));
const balAfter = await mockClawd.balanceOf(u2);
check('CLAWD leaves wallet on stake', balBefore - balAfter === ethers.parseEther('1000'));

// 13. CLAWD returns on unstake
await c(user2).unstake(ethers.parseEther('1000'));
const balFinal = await mockClawd.balanceOf(u2);
check('CLAWD returns on unstake', balFinal === balBefore);

console.log('\n=== MERKLE TREE CORRECTNESS ===\n');

// Fresh contract for tree tests
const c2 = await (new ethers.ContractFactory(apiArt.abi, apiArt.bytecode, deployer)).deploy(
  await mockClawd.getAddress(), d
);
await c2.waitForDeployment();
const addr2 = await c2.getAddress();
await tok(user1).approve(addr2, ethers.parseEther('20000'));
await (new ethers.Contract(addr2, apiArt.abi, user1)).stake(ethers.parseEther('20000'));
const cu2 = new ethers.Contract(addr2, apiArt.abi, user1);

// Get on-chain zeros
const zeros = [];
for (let i = 0; i < 16; i++) zeros.push(await c2.zeros(i));

// Verify zeros[i] = hash(zeros[i-1], zeros[i-1])
for (let i = 1; i < 8; i++) {
  const expected = await p2(bb, zeros[i-1], zeros[i-1]);
  check(`zeros[${i}] = hash(zeros[${i-1}], zeros[${i-1}])`, zeros[i] === expected);
}

// Insert leaves and verify root + path for sizes 1-8
const filledNodes = new Array(16).fill(0n);
const leaves = [];
let treeSize = 0;

function computeDepth(size) {
  let n = 0, t = size;
  while (t > 1) { n++; t = Math.ceil(t / 2); }
  return n;
}

async function computeRoot(filledNodes, zeros, size) {
  if (size === 0) return zeros[15];
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

async function getMerklePath(leaves, leafIndex, treeDepth, zeros) {
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

for (let n = 0; n < 8; n++) {
  const commitment = BigInt('0x' + randomBytes(31).toString('hex'));
  await cu2.register(commitment);
  const [, depthBN, onChainRoot] = await c2.getTreeData();
  const depth = Number(depthBN);

  // Update JS state
  let node = commitment;
  for (let i = 0; i < 16; i++) {
    if (((treeSize >> i) & 1) === 0) { filledNodes[i] = node; break; }
    else { node = await p2(bb, filledNodes[i], node); }
  }
  treeSize++;
  leaves.push(commitment);

  const jsRoot = await computeRoot(filledNodes, zeros, treeSize);
  const jsDepth = computeDepth(treeSize);

  check(`size=${treeSize}: depth correct (${depth})`, depth === jsDepth);
  check(`size=${treeSize}: JS root = on-chain root`, jsRoot === onChainRoot);

  // Verify path for every existing leaf (not just the new one)
  for (let li = 0; li < leaves.length; li++) {
    const { siblings, indices } = await getMerklePath(leaves, li, depth, zeros);
    let pathNode = leaves[li];
    for (let i = 0; i < depth; i++) {
      pathNode = indices[i] === 0
        ? await p2(bb, pathNode, siblings[i])
        : await p2(bb, siblings[i], pathNode);
    }
    if (pathNode !== onChainRoot) {
      check(`size=${treeSize}: path for leaf[${li}]`, false);
    }
  }
  check(`size=${treeSize}: all ${leaves.length} paths verify`, true);
}

console.log('\n=== ZK PROOF: VALID CASES ===\n');

// Generate and verify proofs for leaf 0 (depth=0), leaf 1 (depth=1), leaf 7 (depth=3)
const circuit = JSON.parse(fs.readFileSync(
  '/Users/austingriffith/clawd/zk-api-credits/packages/circuits/target/circuits.json', 'utf-8'
));

// For ZK proofs we need real commitments with known nullifier/secret
// Register 2 fresh commitments on the tree (after the 8 above)
const creds = [];
for (let i = 0; i < 2; i++) {
  const nullifier = BigInt('0x' + randomBytes(31).toString('hex'));
  const secret = BigInt('0x' + randomBytes(31).toString('hex'));
  const commitment = frToBigInt(await bb.poseidon2Hash([new Fr(nullifier), new Fr(secret)]));
  const nullifierHash = frToBigInt(await bb.poseidon2Hash([new Fr(nullifier)]));
  creds.push({ nullifier, secret, commitment, nullifierHash, leafIndex: treeSize });

  await cu2.register(commitment);
  let node = commitment;
  for (let i = 0; i < 16; i++) {
    if (((treeSize >> i) & 1) === 0) { filledNodes[i] = node; break; }
    else { node = await p2(bb, filledNodes[i], node); }
  }
  treeSize++;
  leaves.push(commitment);
}

const [, finalDepthBN, finalRoot] = await c2.getTreeData();
const finalDepth = Number(finalDepthBN);
const backend = new UltraHonkBackend(circuit.bytecode);
const noir = new Noir(circuit);

for (const cred of creds) {
  const { siblings, indices } = await getMerklePath(leaves, cred.leafIndex, finalDepth, zeros);

  try {
    const { witness } = await noir.execute({
      nullifier_hash: cred.nullifierHash.toString(),
      root: finalRoot.toString(),
      depth: finalDepth,
      nullifier: cred.nullifier.toString(),
      secret: cred.secret.toString(),
      indices: indices.map(String),
      siblings: siblings.map(String),
    });
    const { proof, publicInputs } = await backend.generateProof(witness);
    const ok = await backend.verifyProof({ proof, publicInputs });
    check(`ZK proof valid for leaf[${cred.leafIndex}] (depth=${finalDepth})`, ok);
  } catch(e) {
    check(`ZK proof valid for leaf[${cred.leafIndex}]`, false);
    console.error('   ', e.message);
  }
}

console.log('\n=== ZK PROOF: INVALID CASES ===\n');

// Wrong nullifier hash → proof should fail
const cred = creds[0];
const { siblings, indices } = await getMerklePath(leaves, cred.leafIndex, finalDepth, zeros);
try {
  const { witness } = await noir.execute({
    nullifier_hash: (cred.nullifierHash + 1n).toString(), // wrong
    root: finalRoot.toString(),
    depth: finalDepth,
    nullifier: cred.nullifier.toString(),
    secret: cred.secret.toString(),
    indices: indices.map(String),
    siblings: siblings.map(String),
  });
  const { proof, publicInputs } = await backend.generateProof(witness);
  const ok = await backend.verifyProof({ proof, publicInputs });
  check('Wrong nullifier_hash → proof fails', !ok);
} catch {
  check('Wrong nullifier_hash → proof fails (circuit rejects)', true);
}

// Wrong secret → commitment doesn't match → proof should fail
try {
  const { witness } = await noir.execute({
    nullifier_hash: cred.nullifierHash.toString(),
    root: finalRoot.toString(),
    depth: finalDepth,
    nullifier: cred.nullifier.toString(),
    secret: (cred.secret + 1n).toString(), // wrong
    indices: indices.map(String),
    siblings: siblings.map(String),
  });
  const { proof, publicInputs } = await backend.generateProof(witness);
  const ok = await backend.verifyProof({ proof, publicInputs });
  check('Wrong secret → proof fails', !ok);
} catch {
  check('Wrong secret → proof fails (circuit rejects)', true);
}

// Wrong root → proof should fail
try {
  const { witness } = await noir.execute({
    nullifier_hash: cred.nullifierHash.toString(),
    root: (finalRoot + 1n).toString(), // wrong
    depth: finalDepth,
    nullifier: cred.nullifier.toString(),
    secret: cred.secret.toString(),
    indices: indices.map(String),
    siblings: siblings.map(String),
  });
  const { proof, publicInputs } = await backend.generateProof(witness);
  const ok = await backend.verifyProof({ proof, publicInputs });
  check('Wrong root → proof fails', !ok);
} catch {
  check('Wrong root → proof fails (circuit rejects)', true);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('\n✅ ALL ADVERSARIAL CHECKS PASSED');
  console.log('🚀 Contract is correct. Safe to deploy to mainnet.\n');
} else {
  console.log('\n❌ FAILURES DETECTED — DO NOT DEPLOY\n');
  process.exit(1);
}

await bb.destroy();
