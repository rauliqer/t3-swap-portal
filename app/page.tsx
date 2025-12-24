"use client";

import React, { useEffect, useState } from "react";
import { ethers } from "ethers";

// ====== CONTRACT ADDRESSES (LINEA MAINNET) ======
const SWAP_CONTRACT_ADDRESS =
  "0x5d68322D80E070DA73cEa3e46b891FdE8F1cc479";
const TICKETS_NFT_CONTRACT_ADDRESS =
  "0xc4Ab0d9FAcFAc11104E640718dCaB4df782428CC";
const TBAGGIEZ_NFT_CONTRACT_ADDRESS =
  "0x0e1F9EDF5a647B6cD305CeC707e050EC41395d85";

// Linea Proof of Humanity API + verification URL
const POH_API_BASE = "https://poh-api.linea.build/poh/v2";
const POH_VERIFY_URL =
  "https://linea.build/hub/apps/sumsub-reusable-identity";

// Marketplace URLs
const TICKETS_MARKET_URL =
  "https://element.market/collections/t-baggiez-tickets?search[toggles][0]=ALL";
const TBAGGIEZ_MARKET_URL =
  "https://element.market/collections/t-baggiez?search[toggles][0]=ALL";

// ====== ABIs ======
const SWAP_CONTRACT_ABI = [
  "function swapTicketsForTBaggiez(uint256[4] ids) external",
  "function swapTBaggiezForSETBaggiez(uint256[3] ids) external",
  "function ticketsRanges(uint256 slot) view returns (uint256 minId, uint256 maxId)",
  "function tBaggiezRanges(uint256 slot) view returns (uint256 minId, uint256 maxId)",
  "function remainingTicketsRewards() view returns (uint256)",
  "function remainingSeRewards() view returns (uint256)",
];

const NFT_CONTRACT_ABI = [
  "function setApprovalForAll(address operator, bool approved) external",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

declare global {
  interface Window {
    ethereum?: any;
  }
}

type TicketsRange = { minId: string; maxId: string };
type TBaggiezRange = { minId: string; maxId: string };

type HoveredChip = {
  slotIndex: number;
  id: number;
} | null;

export default function Page() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);

  const [activePortal, setActivePortal] = useState<"tickets" | "tbaggiez">(
    "tickets"
  );

  // Selected IDs per slot
  const [ticketIds, setTicketIds] = useState<string[]>(["", "", "", ""]);
  const [tbagIds, setTbagIds] = useState<string[]>(["", "", ""]);

  const [ticketsRanges, setTicketsRanges] = useState<TicketsRange[]>([]);
  const [tbagRanges, setTbagRanges] = useState<TBaggiezRange[]>([]);
  const [remainingTicketsRewards, setRemainingTicketsRewards] =
    useState<string>("-");
  const [remainingSeRewards, setRemainingSeRewards] = useState<string>("-");

  // separate approvals for Tickets + T-Baggiez
  const [hasTicketsApproval, setHasTicketsApproval] = useState<boolean | null>(
    null
  );
  const [hasTBaggiezApproval, setHasTBaggiezApproval] = useState<
    boolean | null
  >(null);

  const [ticketSlotOptions, setTicketSlotOptions] = useState<number[][]>([
    [],
    [],
    [],
    [],
  ]);
  const [tbagSlotOptions, setTbagSlotOptions] = useState<number[][]>([
    [],
    [],
    [],
  ]);

  // has the user scanned per portal at least once?
  const [hasScannedTickets, setHasScannedTickets] = useState(false);
  const [hasScannedTBaggiez, setHasScannedTBaggiez] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Hover state for token chips
  const [hoveredChip, setHoveredChip] = useState<HoveredChip>(null);

  // Proof of Humanity state
  const [isPohVerified, setIsPohVerified] = useState<boolean | null>(null);
  const [isPohLoading, setIsPohLoading] = useState<boolean>(false);

  // ---- Chain helper (Linea mainnet) ----
  const LINEA_CHAIN_ID = 59144;

  let numericChainId: number | null = null;
  if (chainId) {
    if (chainId.startsWith("0x") || chainId.startsWith("0X")) {
      numericChainId = parseInt(chainId, 16);
    } else {
      numericChainId = parseInt(chainId, 10);
    }
  }
  const isOnLinea = numericChainId === LINEA_CHAIN_ID;

  // Convenience: current approval state based on active portal
  const currentHasApproval =
    activePortal === "tickets" ? hasTicketsApproval : hasTBaggiezApproval;

  // ============================================================
  // POH CHECK
  // ============================================================

  const checkPohStatus = async (address: string) => {
    try {
      setIsPohLoading(true);
      setIsPohVerified(null);

      const res = await fetch(`${POH_API_BASE}/${address}`);
      if (!res.ok) {
        console.error("POH API HTTP error:", res.status);
        setIsPohVerified(false);
        return;
      }
      const text = (await res.text()).trim().toLowerCase();
      // API returns "true" or "false" as plain text
      const isHuman = text === "true";
      setIsPohVerified(isHuman);
    } catch (e) {
      console.error("POH check failed:", e);
      // On failure, treat as "not verified" for gating
      setIsPohVerified(false);
    } finally {
      setIsPohLoading(false);
    }
  };

  // ============================================================
  // WALLET & NETWORK
  // ============================================================

  const connectWallet = async () => {
    try {
      setErrorMessage(null);
      setSuccessMessage(null);

      if (typeof window === "undefined" || !window.ethereum) {
        setErrorMessage("MetaMask not found. Please install it.");
        return;
      }

      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      const selected = accounts[0];
      setWalletAddress(selected);

      const cid = await window.ethereum.request({ method: "eth_chainId" });
      setChainId(cid);

      await loadSwapData(selected, cid);
      await checkPohStatus(selected);
    } catch (err: any) {
      console.error("Error connecting wallet:", err);
      setErrorMessage("Failed to connect wallet.");
    }
  };

  const disconnectWallet = () => {
    setWalletAddress(null);
    setChainId(null);
    setHasTicketsApproval(null);
    setHasTBaggiezApproval(null);
    setTicketSlotOptions([[], [], [], []]);
    setTbagSlotOptions([[], [], []]);
    setTicketIds(["", "", "", ""]);
    setTbagIds(["", "", ""]);
    setHoveredChip(null);
    setIsPohVerified(null);
    setIsPohLoading(false);
    setHasScannedTickets(false);
    setHasScannedTBaggiez(false);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const switchToLinea = async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      setErrorMessage("MetaMask not found.");
      return;
    }

    try {
      setErrorMessage(null);
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xe708" }], // 59144 in hex
      });
    } catch (switchError: any) {
      console.error("Error switching network:", switchError);
      if (switchError?.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0xe708",
                chainName: "Linea",
                nativeCurrency: {
                  name: "Linea ETH",
                  symbol: "ETH",
                  decimals: 18,
                },
                rpcUrls: ["https://rpc.linea.build"],
                blockExplorerUrls: ["https://lineascan.build"],
              },
            ],
          });
        } catch (addError: any) {
          console.error("Error adding Linea network:", addError);
          setErrorMessage("Failed to add Linea network to your wallet.");
        }
      } else {
        setErrorMessage("Failed to switch network in MetaMask.");
      }
    }
  };

  // ============================================================
  // LOAD CONFIG (RANGES + REMAINING REWARDS + APPROVAL)
  // ============================================================

  const loadSwapData = async (address?: string | null, cid?: string | null) => {
    try {
      setIsLoading(true);
      if (typeof window === "undefined" || !window.ethereum) return;

      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const swap = new ethers.Contract(
        SWAP_CONTRACT_ADDRESS,
        SWAP_CONTRACT_ABI,
        provider
      );

      const ticketsR: TicketsRange[] = [];
      for (let i = 0; i < 4; i++) {
        const r = await swap.ticketsRanges(i);
        ticketsR.push({
          minId: r.minId.toString(),
          maxId: r.maxId.toString(),
        });
      }
      setTicketsRanges(ticketsR);

      const tbagR: TBaggiezRange[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await swap.tBaggiezRanges(i);
        tbagR.push({
          minId: r.minId.toString(),
          maxId: r.maxId.toString(),
        });
      }
      setTbagRanges(tbagR);

      try {
        const remTickets = await swap.remainingTicketsRewards();
        setRemainingTicketsRewards(remTickets.toString());
      } catch (e) {
        console.warn("No remainingTicketsRewards() in contract?", e);
      }

      try {
        const remSe = await swap.remainingSeRewards();
        setRemainingSeRewards(remSe.toString());
      } catch (e) {
        console.warn("No remainingSeRewards() in contract?", e);
      }

      if (address) {
        await checkApproval(address);
      }
    } catch (err) {
      console.error("Error loading swap data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const checkApproval = async (owner: string) => {
    try {
      if (typeof window === "undefined" || !window.ethereum) return;

      const provider = new ethers.providers.Web3Provider(window.ethereum);

      const ticketsNft = new ethers.Contract(
        TICKETS_NFT_CONTRACT_ADDRESS,
        NFT_CONTRACT_ABI,
        provider
      );
      const tbagNft = new ethers.Contract(
        TBAGGIEZ_NFT_CONTRACT_ADDRESS,
        NFT_CONTRACT_ABI,
        provider
      );

      const [ticketsApproved, tbagApproved] = await Promise.all([
        ticketsNft.isApprovedForAll(owner, SWAP_CONTRACT_ADDRESS),
        tbagNft.isApprovedForAll(owner, SWAP_CONTRACT_ADDRESS),
      ]);

      setHasTicketsApproval(ticketsApproved);
      setHasTBaggiezApproval(tbagApproved);
    } catch (err) {
      console.error("Error checking approval:", err);
      setHasTicketsApproval(null);
      setHasTBaggiezApproval(null);
    }
  };

  const requestApproval = async () => {
    try {
      setErrorMessage(null);
      setSuccessMessage(null);

      if (typeof window === "undefined" || !window.ethereum) {
        setErrorMessage("MetaMask not found.");
        return;
      }
      if (!walletAddress) {
        setErrorMessage("Connect your wallet first.");
        return;
      }
      if (!isOnLinea) {
        setErrorMessage("Please switch your wallet network to Linea.");
        return;
      }

      setIsApproving(true);

      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();

      const nftAddress =
        activePortal === "tickets"
          ? TICKETS_NFT_CONTRACT_ADDRESS
          : TBAGGIEZ_NFT_CONTRACT_ADDRESS;

      const nft = new ethers.Contract(nftAddress, NFT_CONTRACT_ABI, signer);

      const tx = await nft.setApprovalForAll(SWAP_CONTRACT_ADDRESS, true);
      await tx.wait();

      if (activePortal === "tickets") {
        setHasTicketsApproval(true);
      } else {
        setHasTBaggiezApproval(true);
      }

      setSuccessMessage("Approval granted: swap contract can move your NFTs.");
    } catch (err: any) {
      console.error("Approval error:", err);
      if (err?.code === "ACTION_REJECTED") {
        setErrorMessage("Approval transaction rejected in wallet.");
      } else {
        setErrorMessage("Approval failed. Check console for details.");
      }
    } finally {
      setIsApproving(false);
    }
  };

  // ============================================================
  // SCAN WALLET FOR ELIGIBLE IDS
  // ============================================================

  const scanEligibleForActivePortal = async () => {
  try {
    // Reset UI messages
    setErrorMessage(null);
    setSuccessMessage(null);

    // Basic environment checks
    if (typeof window === "undefined" || !window.ethereum) {
      setErrorMessage("MetaMask not found.");
      return;
    }

    if (!walletAddress) {
      setErrorMessage("Connect your wallet first.");
      return;
    }

    if (!isOnLinea) {
      setErrorMessage("Switch wallet network to Linea.");
      return;
    }

    setIsScanning(true);

    // Create provider from MetaMask
    const provider = new ethers.providers.Web3Provider(window.ethereum);

    // Select NFT contract based on active portal
    const nftAddress =
      activePortal === "tickets"
        ? TICKETS_NFT_CONTRACT_ADDRESS
        : TBAGGIEZ_NFT_CONTRACT_ADDRESS;

    // Instantiate NFT contract
    const nft = new ethers.Contract(
      nftAddress,
      NFT_CONTRACT_ABI,
      provider
    );

    const MAX_IDS_PER_SLOT = 500;
    const BATCH_SIZE = 20; // Safe batch size for MetaMask RPC

    if (activePortal === "tickets") {
      const newOptions: number[][] = [[], [], [], []];

      // Loop through ticket slots
      for (let i = 0; i < 4; i++) {
        const r = ticketsRanges[i];
        if (!r) continue;

        // Parse range boundaries
        const min = parseInt(r.minId || "0", 10);
        const max = parseInt(r.maxId || "0", 10);
        if (isNaN(min) || isNaN(max) || min > max) continue;

        // Limit how many token IDs are scanned per slot
        const limit = Math.min(max, min + MAX_IDS_PER_SLOT - 1);
        const ownedIds: number[] = [];

        // Scan token IDs in parallel batches
        for (let start = min; start <= limit; start += BATCH_SIZE) {
          const end = Math.min(start + BATCH_SIZE - 1, limit);

          // Prepare parallel ownerOf calls
          const calls = [];
          for (let id = start; id <= end; id++) {
            calls.push(
              nft
                .ownerOf(id)
                .then((owner: string) => ({ id, owner }))
                .catch(() => null) // Ignore non-existent token IDs
            );
          }

          // Execute batch
          const results = await Promise.all(calls);

          // Filter tokens owned by the connected wallet
          for (const r of results) {
            if (
              r &&
              r.owner.toLowerCase() === walletAddress.toLowerCase()
            ) {
              ownedIds.push(r.id);
            }
          }
        }

        newOptions[i] = ownedIds;
      }

      // Update ticket scan state
      setTicketSlotOptions(newOptions);
      setHasScannedTickets(true);
    } else {
      const newOptions: number[][] = [[], [], []];

      // Loop through TBaggiez slots
      for (let i = 0; i < 3; i++) {
        const r = tbagRanges[i];
        if (!r) continue;

        // Parse range boundaries
        const min = parseInt(r.minId || "0", 10);
        const max = parseInt(r.maxId || "0", 10);
        if (isNaN(min) || isNaN(max) || min > max) continue;

        // Limit how many token IDs are scanned per slot
        const limit = Math.min(max, min + MAX_IDS_PER_SLOT - 1);
        const ownedIds: number[] = [];

        // Scan token IDs in parallel batches
        for (let start = min; start <= limit; start += BATCH_SIZE) {
          const end = Math.min(start + BATCH_SIZE - 1, limit);

          // Prepare parallel ownerOf calls
          const calls = [];
          for (let id = start; id <= end; id++) {
            calls.push(
              nft
                .ownerOf(id)
                .then((owner: string) => ({ id, owner }))
                .catch(() => null)
            );
          }

          // Execute batch
          const results = await Promise.all(calls);

          // Filter tokens owned by the connected wallet
          for (const r of results) {
            if (
              r &&
              r.owner.toLowerCase() === walletAddress.toLowerCase()
            ) {
              ownedIds.push(r.id);
            }
          }
        }

        newOptions[i] = ownedIds;
      }

      // Update TBaggiez scan state
      setTbagSlotOptions(newOptions);
      setHasScannedTBaggiez(true);
    }
  } catch (err) {
    console.error("Scan error:", err);
    setErrorMessage(
      "Failed to scan wallet for eligible NFTs. Check console for details."
    );
  } finally {
    // Always stop loading state
    setIsScanning(false);
  }
};

  // ============================================================
  // SWAP HANDLER
  // ============================================================

  const handleSwap = async () => {
    try {
      setErrorMessage(null);
      setSuccessMessage(null);

      if (typeof window === "undefined" || !window.ethereum) {
        setErrorMessage("MetaMask not found.");
        return;
      }
      if (!walletAddress) {
        setErrorMessage("Connect your wallet first.");
        return;
      }
      if (!isOnLinea) {
        setErrorMessage("Please switch your wallet network to Linea.");
        return;
      }
      if (!currentHasApproval) {
        setErrorMessage(
          "You must approve the swap contract to move your NFTs."
        );
        return;
      }
      if (!isPohVerified) {
        setErrorMessage(
          "You must complete Linea Proof of Humanity before swapping."
        );
        return;
      }

      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const swap = new ethers.Contract(
        SWAP_CONTRACT_ADDRESS,
        SWAP_CONTRACT_ABI,
        signer
      );

      setIsSwapping(true);

      if (activePortal === "tickets") {
        const parsed = ticketIds.map((v) => parseInt(v || "0", 10));
        if (parsed.some((v) => isNaN(v) || v <= 0)) {
          setErrorMessage("Select 4 Ticket token IDs (one per slot).");
          setIsSwapping(false);
          return;
        }
        if (new Set(parsed).size !== 4) {
          setErrorMessage("Ticket IDs must all be different.");
          setIsSwapping(false);
          return;
        }

        const tx = await swap.swapTicketsForTBaggiez(parsed);
        await tx.wait();
        setSuccessMessage(
          "Tickets swap successful! You received a T-Baggiez reward."
        );
      } else {
        const parsed = tbagIds.map((v) => parseInt(v || "0", 10));
        if (parsed.some((v) => isNaN(v) || v <= 0)) {
          setErrorMessage("Select 3 T-Baggiez token IDs (one per slot).");
          setIsSwapping(false);
          return;
        }
        if (new Set(parsed).size !== 3) {
          setErrorMessage("T-Baggiez IDs must all be different.");
          setIsSwapping(false);
          return;
        }

        const tx = await swap.swapTBaggiezForSETBaggiez(parsed);
        await tx.wait();
        setSuccessMessage(
          "T-Baggiez swap successful! You received an SE T-Baggiez reward."
        );
      }

      await loadSwapData(walletAddress, chainId || undefined);
      if (walletAddress) {
        await checkPohStatus(walletAddress); // refresh POH after flow
      }
    } catch (err: any) {
      console.error("Swap error:", err);

      const raw =
        err?.error?.message ||
        err?.data?.message ||
        err?.reason ||
        err?.message ||
        String(err ?? "");
      const lower = raw.toLowerCase();

      if (lower.includes("id not in range")) {
        setErrorMessage("One or more token IDs are not in the required ranges.");
      } else if (lower.includes("duplicate")) {
        setErrorMessage("Token IDs must all be different.");
      } else if (lower.includes("no rewards")) {
        setErrorMessage("No rewards left for this portal.");
      } else if (lower.includes("caller is not token owner")) {
        setErrorMessage("You must own all the token IDs you selected.");
      } else if (err?.code === "ACTION_REJECTED") {
        setErrorMessage("Transaction rejected in wallet.");
      } else {
        setErrorMessage("Swap transaction failed. Check console for details.");
      }
    } finally {
      setIsSwapping(false);
    }
  };

  // ============================================================
  // PRIMARY BUTTON BEHAVIOUR (connect / POH / marketplace / swap)
  // ============================================================

  // Derived "missing slot" state, only after scan
  const hasMissingTickets =
    hasScannedTickets && ticketSlotOptions.some((slot) => slot.length === 0);
  const hasMissingTBaggiez =
    hasScannedTBaggiez && tbagSlotOptions.some((slot) => slot.length === 0);

  const hasMissingForActivePortal =
    activePortal === "tickets" ? hasMissingTickets : hasMissingTBaggiez;

  const marketplaceUrl =
    activePortal === "tickets" ? TICKETS_MARKET_URL : TBAGGIEZ_MARKET_URL;

  const buttonLabel = (() => {
    if (!walletAddress) return "Connect Wallet";
    if (isSwapping) return "Swapping...";

    // If user has scanned and is missing at least one slot → marketplace CTA
    if (hasMissingForActivePortal) {
      return activePortal === "tickets"
        ? "Find your missing Tickets token IDs here"
        : "Find your missing T-Baggiez token IDs here";
    }

    // If POH is not verified yet → send to POH
    if (!isPohLoading && isPohVerified !== true) {
      return "Click here to verify POH";
    }

    // Normal swap labels
    return activePortal === "tickets"
      ? "Swap Tickets → T-Baggiez"
      : "Swap T-Baggiez → SE T-Baggiez";
  })();

  const rewardsLabel =
    activePortal === "tickets"
      ? "Remaining T-Baggiez"
      : "Remaining SE T-Baggiez";
  const rewardsValue =
    activePortal === "tickets" ? remainingTicketsRewards : remainingSeRewards;

  // Disable primary button when it literally can't do anything useful:
  const isPrimaryDisabled = (() => {
    if (isSwapping) return true;

    // If missing IDs after scan, button always clickable → opens marketplace
    if (hasMissingForActivePortal) return false;

    if (!walletAddress) return false; // can always click to connect
    if (isPohLoading) return true; // wait for POH check to finish
    // If not POH-verified, button opens verification page → should be clickable
    if (isPohVerified !== true) return false;
    // POH OK: enforce network + approval for swaps
    if (!isOnLinea || !currentHasApproval) return true;
    return false;
  })();

  const handlePrimaryClick = () => {
    // 1) Not connected → connect
    if (!walletAddress) {
      connectWallet();
      return;
    }

    // 2) If missing IDs after a scan → send to marketplace
    if (hasMissingForActivePortal) {
      if (typeof window !== "undefined") {
        window.open(marketplaceUrl, "_blank");
      }
      return;
    }

    // 3) If POH status is known and NOT verified, or unknown (null), send to POH flow
    if (!isPohLoading && isPohVerified !== true) {
      if (typeof window !== "undefined") {
        window.open(POH_VERIFY_URL, "_blank");
      }
      return;
    }

    // 4) Otherwise, attempt swap
    handleSwap();
  };

  // ============================================================
  // EFFECTS
  // ============================================================

  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setWalletAddress(null);
        setHasTicketsApproval(null);
        setHasTBaggiezApproval(null);
        setTicketSlotOptions([[], [], [], []]);
        setTbagSlotOptions([[], [], []]);
        setTicketIds(["", "", "", ""]);
        setTbagIds(["", "", ""]);
        setHoveredChip(null);
        setIsPohVerified(null);
        setIsPohLoading(false);
        setHasScannedTickets(false);
        setHasScannedTBaggiez(false);
      } else {
        const acc = accounts[0];
        setWalletAddress(acc);
        loadSwapData(acc, chainId ?? undefined).catch(console.error);
        checkPohStatus(acc).catch(console.error);
      }
    };

    const handleChainChanged = (cid: string) => {
      setChainId(cid);
      if (walletAddress) {
        loadSwapData(walletAddress, cid).catch(console.error);
        checkPohStatus(walletAddress).catch(console.error);
      }
    };

    window.ethereum
      .request({ method: "eth_accounts" })
      .then((accounts: string[]) => {
        if (accounts.length > 0) {
          const acc = accounts[0];
          setWalletAddress(acc);
          loadSwapData(acc).catch(console.error);
          checkPohStatus(acc).catch(console.error);
        } else {
          loadSwapData(null).catch(console.error);
        }
      })
      .catch(console.error);

    window.ethereum
      .request({ method: "eth_chainId" })
      .then((cid: string) => {
        setChainId(cid);
      })
      .catch(console.error);

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      if (!window.ethereum) return;
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener("chainChanged", handleChainChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // RENDER HELPERS
  // ============================================================

  const tokenChips = (
    slotIndex: number,
    options: number[][],
    current: string[],
    setCurrent: (v: string[]) => void
  ) => {
    const slotOptions = options[slotIndex] || [];
    if (!slotOptions.length) {
      return (
        <div className="token-chip-placeholder">
          <span>No eligible IDs for this slot.</span>
        </div>
      );
    }

    return (
      <div className="token-chip-row">
        {slotOptions.map((id) => {
          const isSelected = current[slotIndex] === id.toString();
          const isHovered =
            hoveredChip &&
            hoveredChip.slotIndex === slotIndex &&
            hoveredChip.id === id &&
            !isSelected;

          // base style (purple gradient)
          let background =
            "linear-gradient(135deg, rgba(79,70,229,1), rgba(124,58,237,1))";
          let boxShadow = "0 10px 24px rgba(129,140,248,0.7)";

          // hovered (light blue -> purple)
          if (isHovered) {
            background =
              "linear-gradient(135deg, rgba(56,189,248,1), rgba(168,85,247,1))";
            boxShadow = "0 14px 32px rgba(56,189,248,0.95)";
          }

          // selected (green)
          if (isSelected) {
            background =
              "linear-gradient(135deg, rgba(34,197,94,1), rgba(74,222,128,1))";
            boxShadow = "0 14px 34px rgba(34,197,94,0.95)";
          }

          const baseStyle: React.CSSProperties = {
            borderRadius: "999px",
            border: "none",
            background,
            padding: "6px 14px",
            fontSize: "0.78rem",
            fontWeight: 500,
            color: "#f9fafb",
            cursor: "pointer",
            boxShadow,
            whiteSpace: "nowrap",
            marginRight: "6px",
            marginBottom: "6px",
            transform: isHovered ? "translateY(-1px)" : "translateY(0)",
            transition:
              "transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease",
          };

          return (
            <button
              key={id}
              type="button"
              className="token-chip"
              style={baseStyle}
              onClick={() => {
                const copy = [...current];
                copy[slotIndex] = id.toString();
                setCurrent(copy);
              }}
              onMouseEnter={() =>
                setHoveredChip({ slotIndex: slotIndex, id: id })
              }
              onMouseLeave={() =>
                setHoveredChip((prev) =>
                  prev && prev.slotIndex === slotIndex && prev.id === id
                    ? null
                    : prev
                )
              }
            >
              {id}
            </button>
          );
        })}
      </div>
    );
  };

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="page-root">
      {/* Floating background images */}
      <div className="bg-logo">
        <img src="/LogoTrans.png" alt="TBAG Logo" />
      </div>
      <div className="bg-img bg-img-1">
        <img src="/TBAG1trans.png" alt="TBAG 1" />
      </div>
      <div className="bg-img bg-img-2">
        <img src="/TBAG2trans.png" alt="TBAG 2" />
      </div>
      <div className="bg-img bg-img-3">
        <img src="/TBAG3trans.png" alt="TBAG 3" />
      </div>
      <div className="bg-img bg-img-4">
        <img src="/TBAG4trans.png" alt="TBAG 4" />
      </div>

      <div className="card-wrapper">
        <div className="mint-card">
          <div className="mint-card-header">
            <h1>T3 Swap Portal</h1>
            <p>Swap your tickets & T-Baggiez to upgrade!</p>
          </div>

          <div className="status-row">
            <span className={`status-pill ${isOnLinea ? "ok" : "bad"}`}>
              {isOnLinea ? "Linea" : "Wrong Network"}
            </span>

            <div className="status-right">
              <span className="status-address">
                {walletAddress
                  ? `Connected: ${walletAddress.slice(
                      0,
                      6
                    )}...${walletAddress.slice(-4)}`
                  : "Not connected"}
              </span>
              {walletAddress && (
                <button
                  className="disconnect-btn"
                  type="button"
                  onClick={disconnectWallet}
                >
                  Disconnect
                </button>
              )}
              {walletAddress && !isOnLinea && (
                <button
                  className="switch-network-btn"
                  type="button"
                  onClick={switchToLinea}
                >
                  Switch to Linea
                </button>
              )}
            </div>
          </div>

          <div className="portal-tabs-row">
            <div className="portal-tabs">
              <button
                className={`portal-tab ${
                  activePortal === "tickets" ? "active" : ""
                }`}
                onClick={() => {
                  setActivePortal("tickets");
                  setSuccessMessage(null);
                  setErrorMessage(null);
                }}
              >
                Tickets → T-Baggiez
              </button>
              <button
                className={`portal-tab ${
                  activePortal === "tbaggiez" ? "active" : ""
                }`}
                onClick={() => {
                  setActivePortal("tbaggiez");
                  setSuccessMessage(null);
                  setErrorMessage(null);
                }}
              >
                T-Baggiez → SE T-Baggiez
              </button>
            </div>

            <button
              className="secondary-btn"
              type="button"
              onClick={scanEligibleForActivePortal}
              disabled={isScanning || !walletAddress}
            >
              {isScanning ? "Scanning..." : "Scan wallet for eligible NFTs"}
            </button>
          </div>

          <div className="approval-row">
            <div className="approval-left">
              <div className="rewards-pill">
                <span>{rewardsLabel}:</span>
                <strong>{rewardsValue !== "-" ? rewardsValue : "—"}</strong>
              </div>

              <div className="poh-pill">
                <span>POH:</span>
                {isPohLoading ? (
                  <strong>Checking…</strong>
                ) : isPohVerified === true ? (
                  <strong className="poh-yes">Yes</strong>
                ) : (
                  <strong className="poh-no">No</strong>
                )}
              </div>
            </div>

            <div className="approval-status">
              <span
                className={`status-pill small ${
                  currentHasApproval ? "ok" : "bad"
                }`}
              >
                {currentHasApproval === null
                  ? "Unknown"
                  : currentHasApproval
                  ? "Approved"
                  : "Not Approved"}
              </span>
              <button
                className="secondary-btn"
                type="button"
                disabled={isApproving || !walletAddress}
                onClick={requestApproval}
              >
                {isApproving ? "Approving..." : "Approve NFTs"}
              </button>
            </div>
          </div>

          <div className="swap-form">
            {activePortal === "tickets" ? (
              <>
                <div className="swap-explainer">
                  Click 1 eligible Ticket ID per slot below. All IDs must be
                  different.
                </div>
                <div className="slot-grid">
                  {ticketIds.map((_, i) => (
                    <div className="slot-box" key={i}>
                      <span className="label">Ticket Slot {i + 1}</span>
                      {ticketsRanges[i] && (
                        <span className="hint">
                          Range: {ticketsRanges[i].minId} –{" "}
                          {ticketsRanges[i].maxId}
                        </span>
                      )}
                      {tokenChips(
                        i,
                        ticketSlotOptions,
                        ticketIds,
                        setTicketIds
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="swap-explainer">
                  Click 1 eligible T-Baggiez ID per slot below. All IDs must be
                  different.
                </div>
                <div className="slot-grid">
                  {tbagIds.map((_, i) => (
                    <div className="slot-box" key={i}>
                      <span className="label">T-Baggiez Slot {i + 1}</span>
                      {tbagRanges[i] && (
                        <span className="hint">
                          Range: {tbagRanges[i].minId} –{" "}
                          {tbagRanges[i].maxId}
                        </span>
                      )}
                      {tokenChips(
                        i,
                        tbagSlotOptions,
                        tbagIds,
                        setTbagIds
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="actions-row">
              <button
                className="primary-btn"
                onClick={handlePrimaryClick}
                disabled={isPrimaryDisabled}
              >
                {buttonLabel}
              </button>
            </div>
          </div>

          {errorMessage && <div className="error-box">{errorMessage}</div>}
          {successMessage && (
            <div className="success-box">{successMessage}</div>
          )}

          {isLoading && (
            <div className="hint-text">Loading swap data from Linea…</div>
          )}
        </div>
      </div>

      <style jsx>{`
        .page-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at top, #1e293b 0, #020617 55%);
          color: #f9fafb;
          padding: 24px;
          position: relative;
          overflow: hidden;
          font-family: var(--font-barlow), system-ui, -apple-system,
            BlinkMacSystemFont, sans-serif;
        }

        .card-wrapper {
          position: relative;
          z-index: 2;
          max-width: 780px;
          width: 100%;
          margin-top: 40px;
        }

        .mint-card {
          background: radial-gradient(
            circle at top left,
            #0f172a 0,
            #020617 60%
          );
          border-radius: 24px;
          padding: 24px 24px 28px;
          box-shadow: 0 0 60px rgba(129, 140, 248, 0.35),
            0 0 120px rgba(236, 72, 153, 0.25);
          border: 1px solid rgba(148, 163, 184, 0.5);
          backdrop-filter: blur(12px);
        }

        .mint-card-header h1 {
          font-size: 1.9rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin: 0;
          font-weight: 500;
        }

        .mint-card-header p {
          margin: 6px 0 0;
          font-size: 0.9rem;
          color: #cbd5f5;
        }

        .status-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 16px;
          gap: 8px;
          font-size: 0.8rem;
        }

        .status-pill {
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          border: 1px solid rgba(148, 163, 184, 0.6);
        }

        .status-pill.ok {
          background: rgba(34, 197, 94, 0.12);
          border-color: rgba(34, 197, 94, 0.8);
          color: #bbf7d0;
        }

        .status-pill.bad {
          background: rgba(248, 113, 113, 0.1);
          border-color: rgba(248, 113, 113, 0.8);
          color: #fecaca;
        }

        .status-pill.small {
          font-size: 0.7rem;
          padding: 3px 8px;
        }

        .status-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 6px;
        }

        .status-address {
          opacity: 0.9;
          text-align: right;
        }

        .disconnect-btn,
        .switch-network-btn,
        .secondary-btn {
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.6);
          background: rgba(15, 23, 42, 0.9);
          color: #e5e7eb;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          cursor: pointer;
        }

        .disconnect-btn:hover,
        .switch-network-btn:hover,
        .secondary-btn:hover {
          background: rgba(30, 64, 175, 0.7);
        }

        .portal-tabs-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 18px;
          gap: 12px;
          flex-wrap: wrap;
        }

        .portal-tabs {
          display: inline-flex;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.9);
          border: 1px solid rgba(148, 163, 184, 0.6);
          padding: 2px;
        }

        .portal-tab {
          border: none;
          background: transparent;
          padding: 6px 14px;
          border-radius: 999px;
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #9ca3af;
          cursor: pointer;
        }

        .portal-tab.active {
          background: linear-gradient(135deg, #6366f1, #ec4899);
          color: white;
        }

        .approval-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 16px;
          font-size: 0.82rem;
          gap: 12px;
          flex-wrap: wrap;
        }

        .approval-left {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .approval-status {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .rewards-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.95);
          border: 1px solid rgba(148, 163, 184, 0.6);
          font-size: 0.75rem;
          color: #e5e7eb;
        }

        .rewards-pill strong {
          font-weight: 600;
        }

        .poh-pill {
          margin-top: 4px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.95);
          border: 1px solid rgba(148, 163, 184, 0.6);
          font-size: 0.75rem;
          color: #e5e7eb;
        }

        .poh-yes {
          color: #bbf7d0;
        }

        .poh-no {
          color: #fecaca;
        }

        .swap-form {
          margin-top: 18px;
          border-top: 1px dashed rgba(148, 163, 184, 0.5);
          padding-top: 14px;
        }

        .swap-explainer {
          font-size: 0.8rem;
          color: #cbd5f5;
          margin-bottom: 10px;
        }

        .slot-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .slot-box {
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid rgba(148, 163, 184, 0.5);
          background: rgba(15, 23, 42, 0.9);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .label {
          display: block;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.09em;
          color: #9ca3af;
        }

        .hint {
          display: block;
          font-size: 0.7rem;
          color: #9ca3af;
        }

        .token-chip-row {
          margin-top: 6px;
          display: flex;
          flex-wrap: wrap;
          gap: 0px;
          max-height: 90px;
          overflow-y: auto;
          padding-right: 4px;
        }

        .token-chip-placeholder {
          margin-top: 6px;
          font-size: 0.72rem;
          color: #6b7280;
          opacity: 0.9;
        }

        .actions-row {
          display: flex;
          margin-top: 14px;
        }

        .primary-btn {
          flex: 1;
          padding: 10px 14px;
          border-radius: 999px;
          border: none;
          font-size: 0.9rem;
          cursor: pointer;
          transition: transform 0.12s ease, box-shadow 0.12s ease,
            opacity 0.12s ease, background 0.12s ease;
          white-space: nowrap;
          background: linear-gradient(135deg, #6366f1, #ec4899);
          color: white;
          box-shadow: 0 12px 35px rgba(129, 140, 248, 0.6);
        }

        .primary-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 14px 40px rgba(129, 140, 248, 0.9);
        }

        .primary-btn:disabled {
          opacity: 0.5;
          cursor: default;
        }

        .error-box {
          margin-top: 12px;
          padding: 8px 10px;
          border-radius: 8px;
          background: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.7);
          font-size: 0.8rem;
          color: #fecaca;
        }

        .success-box {
          margin-top: 12px;
          padding: 8px 10px;
          border-radius: 8px;
          background: rgba(34, 197, 94, 0.1);
          border: 1px solid rgba(34, 197, 94, 0.8);
          font-size: 0.8rem;
          color: #bbf7d0;
        }

        .hint-text {
          margin-top: 10px;
          font-size: 0.75rem;
          color: #9ca3af;
        }

        .bg-logo {
          position: absolute;
          top: -4%;
          left: 50%;
          transform: translateX(-50%);
          opacity: 0.18;
          pointer-events: none;
          z-index: 0;
          animation: floatLogo 10s ease-in-out infinite alternate;
        }

        .bg-logo img {
          max-width: 350px;
          height: auto;
        }

        .bg-img {
          position: absolute;
          opacity: 0.26;
          pointer-events: none;
          z-index: 0;
          animation-duration: 12s;
          animation-iteration-count: infinite;
          animation-timing-function: ease-in-out;
        }

        .bg-img img {
          max-width: 340px;
          height: auto;
        }

        .bg-img-1 {
          top: 10%;
          left: 5%;
          animation-name: float1;
        }

        .bg-img-2 {
          bottom: 6%;
          left: 7%;
          animation-name: float2;
        }

        .bg-img-3 {
          top: 12%;
          right: 6%;
          animation-name: float3;
        }

        .bg-img-4 {
          bottom: 4%;
          right: 7%;
          animation-name: float4;
        }

        @keyframes floatLogo {
          0% {
            transform: translate(-50%, 0px) scale(1);
          }
          100% {
            transform: translate(-50%, -6px) scale(1.06);
          }
        }

        /* Make 0% and 100% the same so the loop is seamless (no pop) */
        @keyframes float1 {
          0% {
            transform: translate(0px, 0px) rotate(-2deg) scale(1);
          }
          50% {
            transform: translate(10px, -6px) rotate(-4deg) scale(1.25);
          }
          100% {
            transform: translate(0px, 0px) rotate(-2deg) scale(1);
          }
        }

        @keyframes float2 {
          0% {
            transform: translate(0px, 0px) rotate(2deg) scale(1.05);
          }
          50% {
            transform: translate(-12px, -10px) rotate(4deg) scale(1.25);
          }
          100% {
            transform: translate(0px, 0px) rotate(2deg) scale(1.05);
          }
        }

        @keyframes float3 {
          0% {
            transform: translate(0px, 0px) rotate(3deg) scale(0.9);
          }
          50% {
            transform: translate(-14px, 8px) rotate(5deg) scale(1.05);
          }
          100% {
            transform: translate(0px, 0px) rotate(3deg) scale(0.9);
          }
        }

        @keyframes float4 {
          0% {
            transform: translate(0px, 0px) rotate(-3deg) scale(1.05);
          }
          50% {
            transform: translate(12px, 10px) rotate(-5deg) scale(1.25);
          }
          100% {
            transform: translate(0px, 0px) rotate(-3deg) scale(1.05);
          }
        }

        @media (max-width: 640px) {
          .mint-card {
            padding: 18px 16px 22px;
          }
          .mint-card-header h1 {
            font-size: 1.5rem;
          }
          .slot-grid {
            grid-template-columns: 1fr;
          }
          .bg-logo img {
            max-width: 275px;
          }
          .bg-img img {
            max-width: 240px;
          }
        }
      `}</style>
    </div>
  );
}
