"use client";

import { useState } from "react";
import { Fr } from "@aztec/bb.js";
import { toHex } from "viem";
import { poseidon2 } from "poseidon-lite";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

interface CommitmentData {
  commitment: string;
  nullifier: string;
  secret: string;
  index?: number;
}

interface RegisterCreditsProps {
  leafEvents: any;
  stakedBalance: bigint | undefined;
  isConnected: boolean;
}

const STORAGE_KEY = "zk-api-credits";

function loadCredits(): CommitmentData[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveCredit(data: CommitmentData) {
  const credits = loadCredits();
  credits.push(data);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(credits));
}

export const RegisterCredits = ({ leafEvents, stakedBalance, isConnected }: RegisterCreditsProps) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [count, setCount] = useState(1);
  const [lastGenerated, setLastGenerated] = useState<CommitmentData | null>(null);

  const { writeContractAsync, isPending } = useScaffoldWriteContract({
    contractName: "APICredits",
  });

  const canRegister = isConnected && stakedBalance && stakedBalance >= BigInt(count) * BigInt(1e15);

  const handleRegister = async () => {
    if (!canRegister) return;
    setIsGenerating(true);

    try {
      const commitments: bigint[] = [];
      const creditsToSave: CommitmentData[] = [];

      for (let i = 0; i < count; i++) {
        const nullifier = Fr.random();
        const secret = Fr.random();
        const nullifierBigInt = BigInt(toHex(nullifier.toBuffer()));
        const secretBigInt = BigInt(toHex(secret.toBuffer()));

        const commitment = poseidon2([nullifierBigInt, secretBigInt]);

        commitments.push(BigInt(commitment.toString()));
        creditsToSave.push({
          commitment: "0x" + commitment.toString(16).padStart(64, "0"),
          nullifier: toHex(nullifier.toBuffer()),
          secret: toHex(secret.toBuffer()),
        });
      }

      if (count === 1) {
        await writeContractAsync(
          {
            functionName: "register",
            args: [commitments[0]],
          },
          {
            blockConfirmations: 1,
            onBlockConfirmation: () => {
              const idx = leafEvents?.length || 0;
              const data = { ...creditsToSave[0], index: idx };
              saveCredit(data);
              setLastGenerated(data);
            },
          },
        );
      } else {
        await writeContractAsync(
          {
            functionName: "registerBatch",
            args: [commitments],
          },
          {
            blockConfirmations: 1,
            onBlockConfirmation: () => {
              const startIdx = leafEvents?.length || 0;
              creditsToSave.forEach((c, i) => {
                const data = { ...c, index: startIdx + i };
                saveCredit(data);
                if (i === creditsToSave.length - 1) setLastGenerated(data);
              });
            },
          },
        );
      }
    } catch (error) {
      console.error("Error registering credits:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title">🔐 Register API Credits</h2>
        <p className="text-sm opacity-70">
          Generate anonymous commitments and insert them into the Merkle tree.
          Each credit costs 0.001 ETH (moved to server pool — irreversible).
        </p>

        <div className="flex gap-2 items-end mt-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text">Number of credits</span>
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
              className="input input-bordered w-32"
            />
          </div>
          <button
            className={`btn btn-primary ${isGenerating || isPending ? "loading" : ""}`}
            onClick={handleRegister}
            disabled={!canRegister || isGenerating || isPending}
          >
            {isGenerating
              ? "Generating..."
              : isPending
                ? "Confirming..."
                : !isConnected
                  ? "Connect Wallet"
                  : !canRegister
                    ? "Insufficient Balance"
                    : `Register ${count} Credit${count > 1 ? "s" : ""}`}
          </button>
        </div>

        <p className="text-xs opacity-50 mt-2">
          Cost: {(count * 0.001).toFixed(3)} ETH
        </p>

        {lastGenerated && (
          <div className="alert alert-success mt-4">
            <span>
              ✅ Credit registered! Your secrets are saved to localStorage.
              Go to the <a href="/chat" className="link font-bold">Chat page</a> to use them.
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
