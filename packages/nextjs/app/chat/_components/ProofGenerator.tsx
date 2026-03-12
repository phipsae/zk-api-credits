"use client";

import { useState, useEffect } from "react";
import { UltraHonkBackend } from "@aztec/bb.js";
// @ts-ignore
import { Noir } from "@noir-lang/noir_js";
import { LeanIMT } from "@zk-kit/lean-imt";
import { toHex } from "viem";
import { poseidon2 } from "poseidon-lite";
import { useScaffoldEventHistory, useScaffoldReadContract } from "~~/hooks/scaffold-eth";

interface CommitmentData {
  commitment: string;
  nullifier: string;
  secret: string;
  index?: number;
}

interface ProofGeneratorProps {
  onProofGenerated: (data: {
    proof: string;
    nullifier_hash: string;
    root: string;
    depth: number;
  }) => void;
  hasProof: boolean;
}

const STORAGE_KEY = "zk-api-credits";

export const ProofGenerator = ({ onProofGenerated, hasProof }: ProofGeneratorProps) => {
  const [credits, setCredits] = useState<CommitmentData[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [usedIndices, setUsedIndices] = useState<Set<number>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState("");

  // Load credits from localStorage
  useEffect(() => {
    try {
      const stored: CommitmentData[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      setCredits(stored);
      const used: number[] = JSON.parse(localStorage.getItem(STORAGE_KEY + "-used") || "[]");
      setUsedIndices(new Set(used));
    } catch {
      setCredits([]);
    }
  }, []);

  // Read tree data
  const { data: treeData } = useScaffoldReadContract({
    contractName: "APICredits",
    functionName: "getTreeData",
  });

  // Read leaf events
  const { data: leafEvents } = useScaffoldEventHistory({
    contractName: "APICredits",
    eventName: "NewLeaf",
    fromBlock: 0n,
  });

  const availableCredits = credits.filter((_, i) => !usedIndices.has(i));

  const handleGenerateProof = async () => {
    if (availableCredits.length === 0) return;

    setIsGenerating(true);
    setStatus("Loading circuit...");

    try {
      // Pick the first unused credit
      const creditIdx = credits.findIndex((_, i) => !usedIndices.has(i));
      const credit = credits[creditIdx];

      // Fetch circuit
      let circuitData: any;
      try {
        const res = await fetch("/api/circuit");
        if (res.ok) circuitData = await res.json();
      } catch {}
      if (!circuitData) {
        const res2 = await fetch("/circuits.json");
        circuitData = await res2.json();
      }

      setStatus("Rebuilding Merkle tree...");

      // Rebuild the Merkle tree from leaf events
      const hash = (a: bigint, b: bigint): bigint => poseidon2([a, b]);
      const tree = new LeanIMT(hash);

      if (leafEvents) {
        for (const event of leafEvents) {
          tree.insert(BigInt(event.args.value?.toString() || "0"));
        }
      }

      const root = tree.root;
      const depth = tree.depth;
      const leafIndex = credit.index ?? 0;

      // Get Merkle proof
      const merkleProof = tree.generateProof(leafIndex);
      const siblings = merkleProof.siblings.map((s: any) =>
        Array.isArray(s) ? s[0] : s
      );

      // Pad siblings to 16
      while (siblings.length < 16) {
        siblings.push(0n);
      }

      // Build indices array (path bits)
      const indices: number[] = [];
      let idx = leafIndex;
      for (let i = 0; i < 16; i++) {
        if (i < depth) {
          indices.push(idx & 1);
          idx >>= 1;
        } else {
          indices.push(0);
        }
      }

      // Compute nullifier_hash
      const nullifierBigInt = BigInt(credit.nullifier);
      const secretBigInt = BigInt(credit.secret);
      const nullifierHash = poseidon2([nullifierBigInt]);

      setStatus("Generating ZK proof...");

      // Set up Noir + backend
      const noir = new Noir(circuitData);
      const backend = new UltraHonkBackend(circuitData.bytecode);

      const inputs = {
        nullifier_hash: "0x" + BigInt(nullifierHash).toString(16).padStart(64, "0"),
        root: "0x" + BigInt(root).toString(16).padStart(64, "0"),
        depth: depth,
        nullifier: credit.nullifier,
        secret: credit.secret,
        indices: indices,
        siblings: siblings.map((s: bigint) => "0x" + s.toString(16).padStart(64, "0")),
      };

      const { witness } = await noir.execute(inputs);
      const proof = await backend.generateProof(witness);

      // Mark credit as used
      const newUsed = new Set(usedIndices);
      newUsed.add(creditIdx);
      setUsedIndices(newUsed);
      localStorage.setItem(STORAGE_KEY + "-used", JSON.stringify([...newUsed]));

      // Convert proof to hex string
      const proofHex = "0x" + Buffer.from(proof.proof).toString("hex");

      onProofGenerated({
        proof: proofHex,
        nullifier_hash: "0x" + BigInt(nullifierHash).toString(16).padStart(64, "0"),
        root: "0x" + BigInt(root).toString(16).padStart(64, "0"),
        depth: depth,
      });

      setStatus("✅ Proof generated!");
    } catch (error: any) {
      console.error("Proof generation error:", error);
      setStatus(`❌ Error: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className={`card shadow-xl ${hasProof ? "bg-success/10" : "bg-base-100"}`}>
      <div className="card-body py-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold">
              {hasProof ? "✅ Proof Ready" : "🔐 Generate Proof"}
            </h3>
            <p className="text-xs opacity-70">
              {availableCredits.length} unused credit{availableCredits.length !== 1 ? "s" : ""} available
            </p>
          </div>
          <button
            className={`btn btn-sm ${hasProof ? "btn-success" : "btn-primary"} ${isGenerating ? "loading" : ""}`}
            onClick={handleGenerateProof}
            disabled={availableCredits.length === 0 || isGenerating || hasProof}
          >
            {isGenerating
              ? "Generating..."
              : hasProof
                ? "Proof Active"
                : availableCredits.length === 0
                  ? "No Credits"
                  : "Generate Proof"}
          </button>
        </div>
        {status && <p className="text-xs mt-1">{status}</p>}
      </div>
    </div>
  );
};
