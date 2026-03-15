import { ethers } from "hardhat";
async function main() {
  const AUSTIN = "0x8c00eae9b9A2f89BddaAE4f6884C716562C7cE93";
  const CLAWD = "0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07";
  const OLD_CONTRACT = "0x4A6782D251e12c06e1f16450D8b28f6C857cFdd1";
  const NEW_CONTRACT = "0xc18fad39f72eBe5E54718D904C5012Da74594674";
  
  const clawd = await ethers.getContractAt("IERC20", CLAWD);
  
  const allowOld = await clawd.allowance(AUSTIN, OLD_CONTRACT);
  const allowNew = await clawd.allowance(AUSTIN, NEW_CONTRACT);
  
  console.log("allowance to OLD contract:", ethers.formatEther(allowOld));
  console.log("allowance to NEW contract:", ethers.formatEther(allowNew));
}
main().catch(console.error);
