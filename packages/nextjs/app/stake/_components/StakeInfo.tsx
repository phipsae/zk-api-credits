"use client";

import { formatEther } from "viem";

interface StakeInfoProps {
  stakedBalance: bigint | undefined;
  treeData: readonly [bigint, bigint, bigint] | undefined;
  isConnected: boolean;
}

export const StakeInfo = ({ stakedBalance, treeData, isConnected }: StakeInfoProps) => {
  const PRICE_PER_CREDIT = 0.001;
  const balance = stakedBalance ? Number(formatEther(stakedBalance)) : 0;
  const availableCredits = Math.floor(balance / PRICE_PER_CREDIT);

  return (
    <div className="stats stats-vertical lg:stats-horizontal shadow w-full bg-base-100">
      <div className="stat">
        <div className="stat-title">Staked Balance</div>
        <div className="stat-value text-primary">
          {isConnected ? `${balance.toFixed(4)} ETH` : "—"}
        </div>
        <div className="stat-desc">Withdrawable</div>
      </div>

      <div className="stat">
        <div className="stat-title">Available Credits</div>
        <div className="stat-value text-secondary">{isConnected ? availableCredits : "—"}</div>
        <div className="stat-desc">@ 0.001 ETH each</div>
      </div>

      <div className="stat">
        <div className="stat-title">Merkle Tree</div>
        <div className="stat-value text-sm">
          {treeData ? `${treeData[0].toString()} leaves` : "Empty"}
        </div>
        <div className="stat-desc">{treeData ? `Depth: ${treeData[1].toString()}` : "No commitments yet"}</div>
      </div>
    </div>
  );
};
