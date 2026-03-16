import { ethers } from "hardhat";

const CLAWD_PRICING = "0xaca9733Cc19aD837899dc7D1170aF1d5367C332E";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const pricing = await ethers.getContractAt(
    ["function setCreditPriceUSD(uint256) external", "function creditPriceUSD() view returns (uint256)", "function getCreditPriceInCLAWD() view returns (uint256)"],
    CLAWD_PRICING,
    deployer,
  );

  const current = await pricing.creditPriceUSD();
  console.log("Current price:", ethers.formatEther(current), "USD/credit");

  const newPrice = ethers.parseEther("0.01"); // $0.01
  const tx = await pricing.setCreditPriceUSD(newPrice);
  console.log("Tx:", tx.hash);
  await tx.wait();

  const updated = await pricing.creditPriceUSD();
  const clawdPerCredit = await pricing.getCreditPriceInCLAWD();
  console.log("New price:", ethers.formatEther(updated), "USD/credit");
  console.log("CLAWD per credit:", ethers.formatEther(clawdPerCredit), "CLAWD");
}

main().catch(console.error);
