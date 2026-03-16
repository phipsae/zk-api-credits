import { ethers } from "hardhat";
async function main() {
  const pricing = await ethers.getContractAt(
    ["function owner() view returns (address)", "function creditPriceUSD() view returns (uint256)"],
    "0xaca9733Cc19aD837899dc7D1170aF1d5367C332E"
  );
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  console.log("Owner:", await pricing.owner());
  console.log("USD price:", ethers.formatEther(await pricing.creditPriceUSD()));
}
main().catch(console.error);
