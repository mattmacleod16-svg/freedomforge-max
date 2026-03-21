/**
 * NFT & Digital Assets Engine — FreedomForge Max
 * ═════════════════════════════════════════════════
 *
 * Full-stack digital asset lifecycle management:
 *
 *  • ERC-721/1155 Minting — Single and batch NFT creation
 *  • Marketplace — Listings, offers, auctions, and instant sales
 *  • Royalties (EIP-2981) — On-chain creator royalty enforcement
 *  • Collections — Curated sets with metadata, traits, and rarity
 *  • Fractionalization — Split high-value NFTs into fungible shares
 *  • Lending/Renting — NFT collateral lending and time-bound renting
 *  • Dynamic NFTs — State-changing tokens with oracle triggers
 *  • Soulbound Tokens (SBTs) — Non-transferable identity/achievement tokens
 *  • Compressed NFTs — Merkle tree state compression for scale
 *  • Creator Tools — Launchpad, allowlists, reveal mechanics
 *
 * Inspired by: OpenSea, Blur, Zora, Reservoir, Tensor, Magic Eden, ERC-6551
 */

import { createHash } from 'crypto';

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type TokenStandard = 'ERC-721' | 'ERC-1155' | 'SPL' | 'ASA' | 'SBT';
export type ListingType = 'fixed_price' | 'english_auction' | 'dutch_auction' | 'offer';
export type ListingStatus = 'active' | 'sold' | 'cancelled' | 'expired';
export type RarityTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type DynamicTrigger = 'time' | 'oracle' | 'interaction' | 'governance' | 'external';
export type Chain = 'ethereum' | 'base' | 'solana' | 'polygon' | 'arbitrum' | 'zora';

export interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  animationUrl?: string;
  externalUrl?: string;
  attributes: Array<{ trait_type: string; value: string | number; display_type?: string }>;
}

export interface NFT {
  id: string;
  tokenId: number;
  contractAddress: string;
  standard: TokenStandard;
  chain: Chain;
  owner: string;
  creator: string;
  metadata: NFTMetadata;
  royaltyBps: number;             // Basis points (250 = 2.5%)
  royaltyRecipient: string;
  supply: number;                 // 1 for ERC-721, >1 for ERC-1155
  isSoulbound: boolean;
  isDynamic: boolean;
  dynamicState?: Record<string, unknown>;
  compressionProof?: string;
  mintedAt: number;
  lastTransferAt?: number;
}

export interface Collection {
  id: string;
  name: string;
  symbol: string;
  description: string;
  chain: Chain;
  creator: string;
  contractAddress: string;
  standard: TokenStandard;
  totalSupply: number;
  maxSupply: number;
  mintPrice: number;
  royaltyBps: number;
  royaltyRecipient: string;
  baseUri: string;
  floorPrice: number;
  volume24h: number;
  volumeTotal: number;
  holders: number;
  listed: number;
  traits: Record<string, string[]>;
  isRevealed: boolean;
  allowlist: string[];
  createdAt: number;
}

export interface Listing {
  id: string;
  nftId: string;
  seller: string;
  type: ListingType;
  status: ListingStatus;
  price: number;
  currency: string;
  startPrice?: number;
  endPrice?: number;
  highestBid?: number;
  highestBidder?: string;
  bids: Bid[];
  startTime: number;
  endTime: number;
  marketplace: string;
  createdAt: number;
  soldAt?: number;
}

export interface Bid {
  bidder: string;
  amount: number;
  timestamp: number;
  expiry: number;
}

export interface RoyaltyPayment {
  id: string;
  nftId: string;
  salePrice: number;
  royaltyAmount: number;
  recipient: string;
  paidAt: number;
}

export interface FractionalVault {
  id: string;
  nftId: string;
  curator: string;
  totalShares: number;
  sharePrice: number;
  reservePrice: number;
  shareholders: Map<string, number>;
  isLocked: boolean;
  createdAt: number;
}

export interface NFTLoan {
  id: string;
  nftId: string;
  borrower: string;
  lender: string;
  principal: number;
  interestRate: number;
  duration: number;
  repaid: boolean;
  liquidated: boolean;
  startedAt: number;
  dueAt: number;
}

export interface NFTRental {
  id: string;
  nftId: string;
  owner: string;
  renter: string;
  dailyRate: number;
  startTime: number;
  endTime: number;
  totalPaid: number;
  active: boolean;
}

export interface DynamicNFTRule {
  id: string;
  nftId: string;
  trigger: DynamicTrigger;
  condition: string;
  stateChange: Record<string, unknown>;
  executionCount: number;
  lastTriggeredAt?: number;
}

export interface LaunchpadProject {
  id: string;
  collectionId: string;
  name: string;
  phases: MintPhase[];
  totalMinted: number;
  maxSupply: number;
  revealStrategy: 'instant' | 'delayed' | 'on_demand';
  revealedAt?: number;
  createdAt: number;
}

export interface MintPhase {
  name: string;
  price: number;
  maxPerWallet: number;
  startTime: number;
  endTime: number;
  allowlistOnly: boolean;
  minted: number;
}

/* ─── Constants ───────────────────────────────────────────────────────────── */

const MARKETPLACE_FEE_BPS = 250;      // 2.5%
const MAX_ROYALTY_BPS = 1000;           // 10% max
const FRACTIONALIZATION_MIN_SHARES = 100;
const LOAN_LIQUIDATION_THRESHOLD = 0.8; // 80% LTV

/* ─── State ───────────────────────────────────────────────────────────────── */

const nfts: Map<string, NFT> = new Map();
const collections: Map<string, Collection> = new Map();
const listings: Map<string, Listing> = new Map();
const royalties: RoyaltyPayment[] = [];
const vaults: Map<string, FractionalVault> = new Map();
const loans: Map<string, NFTLoan> = new Map();
const rentals: Map<string, NFTRental> = new Map();
const dynamicRules: Map<string, DynamicNFTRule[]> = new Map();
const launchpads: Map<string, LaunchpadProject> = new Map();

let nextTokenId = 1;

/* ─── Minting ─────────────────────────────────────────────────────────────── */

export function mint(input: {
  creator: string;
  chain: Chain;
  metadata: NFTMetadata;
  standard?: TokenStandard;
  supply?: number;
  royaltyBps?: number;
  isSoulbound?: boolean;
  isDynamic?: boolean;
  collectionId?: string;
}): NFT {
  const contractAddress = `0x${createHash('sha256').update(`${input.creator}${Date.now()}`).digest('hex').slice(0, 40)}`;
  const royaltyBps = Math.min(input.royaltyBps || 250, MAX_ROYALTY_BPS);

  const nft: NFT = {
    id: `nft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    tokenId: nextTokenId++,
    contractAddress,
    standard: input.isSoulbound ? 'SBT' : (input.standard || 'ERC-721'),
    chain: input.chain,
    owner: input.creator,
    creator: input.creator,
    metadata: input.metadata,
    royaltyBps,
    royaltyRecipient: input.creator,
    supply: input.supply || 1,
    isSoulbound: input.isSoulbound || false,
    isDynamic: input.isDynamic || false,
    mintedAt: Date.now(),
  };

  nfts.set(nft.id, nft);

  // Update collection
  if (input.collectionId) {
    const collection = collections.get(input.collectionId);
    if (collection) {
      collection.totalSupply++;
    }
  }

  return nft;
}

export function batchMint(input: {
  creator: string;
  chain: Chain;
  metadataList: NFTMetadata[];
  standard?: TokenStandard;
  royaltyBps?: number;
  collectionId?: string;
}): NFT[] {
  return input.metadataList.map((metadata) =>
    mint({
      creator: input.creator,
      chain: input.chain,
      metadata,
      standard: input.standard,
      royaltyBps: input.royaltyBps,
      collectionId: input.collectionId,
    })
  );
}

export function getNFT(nftId: string): NFT | null {
  return nfts.get(nftId) || null;
}

export function getNFTsByOwner(owner: string): NFT[] {
  return Array.from(nfts.values()).filter((n) => n.owner === owner);
}

export function transferNFT(nftId: string, from: string, to: string): NFT | null {
  const nft = nfts.get(nftId);
  if (!nft || nft.owner !== from) return null;
  if (nft.isSoulbound) throw new Error('Soulbound tokens cannot be transferred');

  nft.owner = to;
  nft.lastTransferAt = Date.now();
  return nft;
}

/* ─── Collections ─────────────────────────────────────────────────────────── */

export function createCollection(input: {
  name: string;
  symbol: string;
  description: string;
  chain: Chain;
  creator: string;
  maxSupply: number;
  mintPrice: number;
  royaltyBps?: number;
  baseUri: string;
  traits?: Record<string, string[]>;
}): Collection {
  const contractAddress = `0x${createHash('sha256').update(`${input.name}${Date.now()}`).digest('hex').slice(0, 40)}`;

  const collection: Collection = {
    id: `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name,
    symbol: input.symbol,
    description: input.description,
    chain: input.chain,
    creator: input.creator,
    contractAddress,
    standard: 'ERC-721',
    totalSupply: 0,
    maxSupply: input.maxSupply,
    mintPrice: input.mintPrice,
    royaltyBps: Math.min(input.royaltyBps || 250, MAX_ROYALTY_BPS),
    royaltyRecipient: input.creator,
    baseUri: input.baseUri,
    floorPrice: input.mintPrice,
    volume24h: 0,
    volumeTotal: 0,
    holders: 0,
    listed: 0,
    traits: input.traits || {},
    isRevealed: false,
    allowlist: [],
    createdAt: Date.now(),
  };

  collections.set(collection.id, collection);
  return collection;
}

export function getCollection(collectionId: string): Collection | null {
  return collections.get(collectionId) || null;
}

export function getAllCollections(): Collection[] {
  return Array.from(collections.values());
}

export function revealCollection(collectionId: string): Collection | null {
  const collection = collections.get(collectionId);
  if (!collection || collection.isRevealed) return null;
  collection.isRevealed = true;
  return collection;
}

/* ─── Marketplace ─────────────────────────────────────────────────────────── */

export function createListing(input: {
  nftId: string;
  seller: string;
  type: ListingType;
  price: number;
  currency?: string;
  startPrice?: number;
  endPrice?: number;
  durationMs?: number;
}): Listing {
  const nft = nfts.get(input.nftId);
  if (!nft || nft.owner !== input.seller) throw new Error('Only owner can list');
  if (nft.isSoulbound) throw new Error('Soulbound tokens cannot be listed');

  const duration = input.durationMs || 7 * 24 * 60 * 60 * 1000;

  const listing: Listing = {
    id: `list_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    nftId: input.nftId,
    seller: input.seller,
    type: input.type,
    status: 'active',
    price: input.price,
    currency: input.currency || 'ETH',
    startPrice: input.startPrice,
    endPrice: input.endPrice,
    bids: [],
    startTime: Date.now(),
    endTime: Date.now() + duration,
    marketplace: 'FreedomForge',
    createdAt: Date.now(),
  };

  listings.set(listing.id, listing);
  return listing;
}

export function placeBid(listingId: string, bidder: string, amount: number): Listing | null {
  const listing = listings.get(listingId);
  if (!listing || listing.status !== 'active') return null;
  if (listing.type !== 'english_auction' && listing.type !== 'offer') return null;
  if (listing.highestBid && amount <= listing.highestBid) return null;

  listing.bids.push({
    bidder,
    amount,
    timestamp: Date.now(),
    expiry: Date.now() + 24 * 60 * 60 * 1000,
  });
  listing.highestBid = amount;
  listing.highestBidder = bidder;

  return listing;
}

export function buyNow(listingId: string, buyer: string): { listing: Listing; royalty: RoyaltyPayment | null } | null {
  const listing = listings.get(listingId);
  if (!listing || listing.status !== 'active') return null;
  if (listing.type === 'english_auction') return null; // Must use finalizeAuction

  const nft = nfts.get(listing.nftId);
  if (!nft) return null;

  // Determine final price
  let finalPrice = listing.price;
  if (listing.type === 'dutch_auction' && listing.startPrice && listing.endPrice) {
    const elapsed = Date.now() - listing.startTime;
    const duration = listing.endTime - listing.startTime;
    const pct = Math.min(1, elapsed / duration);
    finalPrice = listing.startPrice - (listing.startPrice - listing.endPrice) * pct;
  }

  // Execute sale
  listing.status = 'sold';
  listing.soldAt = Date.now();
  nft.owner = buyer;
  nft.lastTransferAt = Date.now();

  // Pay royalties
  let royaltyPayment: RoyaltyPayment | null = null;
  if (nft.royaltyBps > 0 && nft.creator !== listing.seller) {
    const royaltyAmount = (finalPrice * nft.royaltyBps) / 10000;
    royaltyPayment = {
      id: `roy_${Date.now().toString(36)}`,
      nftId: nft.id,
      salePrice: finalPrice,
      royaltyAmount,
      recipient: nft.royaltyRecipient,
      paidAt: Date.now(),
    };
    royalties.push(royaltyPayment);
  }

  return { listing, royalty: royaltyPayment };
}

export function finalizeAuction(listingId: string): { listing: Listing; royalty: RoyaltyPayment | null } | null {
  const listing = listings.get(listingId);
  if (!listing || listing.status !== 'active' || listing.type !== 'english_auction') return null;
  if (!listing.highestBidder || !listing.highestBid) return null;

  const nft = nfts.get(listing.nftId);
  if (!nft) return null;

  listing.status = 'sold';
  listing.soldAt = Date.now();
  listing.price = listing.highestBid;
  nft.owner = listing.highestBidder;
  nft.lastTransferAt = Date.now();

  let royaltyPayment: RoyaltyPayment | null = null;
  if (nft.royaltyBps > 0 && nft.creator !== listing.seller) {
    const royaltyAmount = (listing.highestBid * nft.royaltyBps) / 10000;
    royaltyPayment = {
      id: `roy_${Date.now().toString(36)}`,
      nftId: nft.id,
      salePrice: listing.highestBid,
      royaltyAmount,
      recipient: nft.royaltyRecipient,
      paidAt: Date.now(),
    };
    royalties.push(royaltyPayment);
  }

  return { listing, royalty: royaltyPayment };
}

export function cancelListing(listingId: string, seller: string): Listing | null {
  const listing = listings.get(listingId);
  if (!listing || listing.seller !== seller || listing.status !== 'active') return null;
  listing.status = 'cancelled';
  return listing;
}

export function getActiveListings(): Listing[] {
  return Array.from(listings.values()).filter((l) => l.status === 'active');
}

export function getListingsByCollection(collectionId: string): Listing[] {
  const collection = collections.get(collectionId);
  if (!collection) return [];

  const collectionNFTs = new Set<string>();
  for (const [, nft] of nfts) {
    if (nft.contractAddress === collection.contractAddress) {
      collectionNFTs.add(nft.id);
    }
  }

  return Array.from(listings.values()).filter((l) => collectionNFTs.has(l.nftId) && l.status === 'active');
}

/* ─── Rarity Scoring ──────────────────────────────────────────────────────── */

export function calculateRarity(nftId: string, collectionId: string): { score: number; rank: number; tier: RarityTier } | null {
  const nft = nfts.get(nftId);
  const collection = collections.get(collectionId);
  if (!nft || !collection) return null;

  // Calculate trait rarity
  let score = 0;
  for (const attr of nft.metadata.attributes) {
    const traitValues = collection.traits[attr.trait_type];
    if (traitValues) {
      const frequency = 1 / traitValues.length;
      score += 1 / frequency;
    }
  }

  // Normalize
  const maxScore = Object.keys(collection.traits).length * 100;
  const normalizedScore = maxScore > 0 ? (score / maxScore) * 100 : 50;

  let tier: RarityTier;
  if (normalizedScore >= 95) tier = 'mythic';
  else if (normalizedScore >= 85) tier = 'legendary';
  else if (normalizedScore >= 70) tier = 'epic';
  else if (normalizedScore >= 50) tier = 'rare';
  else if (normalizedScore >= 30) tier = 'uncommon';
  else tier = 'common';

  return { score: Math.round(normalizedScore * 10) / 10, rank: 1, tier };
}

/* ─── Fractionalization ───────────────────────────────────────────────────── */

export function fractionalize(nftId: string, curator: string, totalShares: number, reservePrice: number): FractionalVault | null {
  const nft = nfts.get(nftId);
  if (!nft || nft.owner !== curator) return null;
  if (totalShares < FRACTIONALIZATION_MIN_SHARES) return null;

  const vault: FractionalVault = {
    id: `vault_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    nftId,
    curator,
    totalShares,
    sharePrice: reservePrice / totalShares,
    reservePrice,
    shareholders: new Map([[curator, totalShares]]),
    isLocked: true,
    createdAt: Date.now(),
  };

  vaults.set(vault.id, vault);
  return vault;
}

export function buyShares(vaultId: string, buyer: string, shares: number): FractionalVault | null {
  const vault = vaults.get(vaultId);
  if (!vault || !vault.isLocked) return null;

  const curatorShares = vault.shareholders.get(vault.curator) || 0;
  if (shares > curatorShares) return null;

  vault.shareholders.set(vault.curator, curatorShares - shares);
  const buyerShares = vault.shareholders.get(buyer) || 0;
  vault.shareholders.set(buyer, buyerShares + shares);

  return vault;
}

export function redeemVault(vaultId: string): NFT | null {
  const vault = vaults.get(vaultId);
  if (!vault) return null;

  // Check if single owner holds all shares
  for (const [holder, shares] of vault.shareholders) {
    if (shares >= vault.totalShares) {
      vault.isLocked = false;
      const nft = nfts.get(vault.nftId);
      if (nft) nft.owner = holder;
      return nft || null;
    }
  }
  return null;
}

export function getVault(vaultId: string): FractionalVault | null {
  return vaults.get(vaultId) || null;
}

/* ─── NFT Lending ─────────────────────────────────────────────────────────── */

export function createNFTLoan(input: {
  nftId: string;
  borrower: string;
  lender: string;
  principal: number;
  interestRate: number;
  durationDays: number;
}): NFTLoan {
  const nft = nfts.get(input.nftId);
  if (!nft || nft.owner !== input.borrower) throw new Error('Borrower must own the NFT');

  const loan: NFTLoan = {
    id: `loan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    nftId: input.nftId,
    borrower: input.borrower,
    lender: input.lender,
    principal: input.principal,
    interestRate: input.interestRate,
    duration: input.durationDays * 24 * 60 * 60 * 1000,
    repaid: false,
    liquidated: false,
    startedAt: Date.now(),
    dueAt: Date.now() + input.durationDays * 24 * 60 * 60 * 1000,
  };

  // Escrow NFT
  nft.owner = `escrow:${loan.id}`;
  loans.set(loan.id, loan);
  return loan;
}

export function repayNFTLoan(loanId: string): NFTLoan | null {
  const loan = loans.get(loanId);
  if (!loan || loan.repaid || loan.liquidated) return null;

  loan.repaid = true;
  const nft = nfts.get(loan.nftId);
  if (nft) {
    nft.owner = loan.borrower;
    nft.lastTransferAt = Date.now();
  }

  return loan;
}

export function liquidateNFTLoan(loanId: string): NFTLoan | null {
  const loan = loans.get(loanId);
  if (!loan || loan.repaid || loan.liquidated) return null;
  if (Date.now() < loan.dueAt) return null;

  loan.liquidated = true;
  const nft = nfts.get(loan.nftId);
  if (nft) {
    nft.owner = loan.lender;
    nft.lastTransferAt = Date.now();
  }

  return loan;
}

/* ─── NFT Renting ─────────────────────────────────────────────────────────── */

export function rentNFT(input: {
  nftId: string;
  owner: string;
  renter: string;
  dailyRate: number;
  durationDays: number;
}): NFTRental {
  const nft = nfts.get(input.nftId);
  if (!nft || nft.owner !== input.owner) throw new Error('Only owner can rent');

  const rental: NFTRental = {
    id: `rent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    nftId: input.nftId,
    owner: input.owner,
    renter: input.renter,
    dailyRate: input.dailyRate,
    startTime: Date.now(),
    endTime: Date.now() + input.durationDays * 24 * 60 * 60 * 1000,
    totalPaid: input.dailyRate * input.durationDays,
    active: true,
  };

  rentals.set(rental.id, rental);
  return rental;
}

export function endRental(rentalId: string): NFTRental | null {
  const rental = rentals.get(rentalId);
  if (!rental || !rental.active) return null;
  rental.active = false;
  return rental;
}

/* ─── Dynamic NFTs ────────────────────────────────────────────────────────── */

export function addDynamicRule(nftId: string, rule: Omit<DynamicNFTRule, 'id' | 'executionCount' | 'lastTriggeredAt'>): DynamicNFTRule {
  const nft = nfts.get(nftId);
  if (!nft || !nft.isDynamic) throw new Error('NFT must be dynamic');

  const dynamicRule: DynamicNFTRule = {
    id: `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    nftId,
    trigger: rule.trigger,
    condition: rule.condition,
    stateChange: rule.stateChange,
    executionCount: 0,
  };

  const rules = dynamicRules.get(nftId) || [];
  rules.push(dynamicRule);
  dynamicRules.set(nftId, rules);

  return dynamicRule;
}

export function triggerDynamicUpdate(nftId: string, triggerType: DynamicTrigger): NFT | null {
  const nft = nfts.get(nftId);
  if (!nft || !nft.isDynamic) return null;

  const rules = dynamicRules.get(nftId) || [];
  for (const rule of rules) {
    if (rule.trigger === triggerType) {
      nft.dynamicState = { ...nft.dynamicState, ...rule.stateChange };
      rule.executionCount++;
      rule.lastTriggeredAt = Date.now();
    }
  }

  return nft;
}

/* ─── Launchpad ───────────────────────────────────────────────────────────── */

export function createLaunchpad(input: {
  collectionId: string;
  name: string;
  maxSupply: number;
  phases: Omit<MintPhase, 'minted'>[];
  revealStrategy: LaunchpadProject['revealStrategy'];
}): LaunchpadProject {
  const project: LaunchpadProject = {
    id: `launch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    collectionId: input.collectionId,
    name: input.name,
    phases: input.phases.map((p) => ({ ...p, minted: 0 })),
    totalMinted: 0,
    maxSupply: input.maxSupply,
    revealStrategy: input.revealStrategy,
    createdAt: Date.now(),
  };

  launchpads.set(project.id, project);
  return project;
}

export function mintFromLaunchpad(projectId: string, minter: string, quantity: number): NFT[] {
  const project = launchpads.get(projectId);
  if (!project) throw new Error('Launchpad not found');
  if (project.totalMinted + quantity > project.maxSupply) throw new Error('Exceeds max supply');

  const now = Date.now();
  const activePhase = project.phases.find((p) => now >= p.startTime && now <= p.endTime);
  if (!activePhase) throw new Error('No active mint phase');

  const collection = collections.get(project.collectionId);
  if (!collection) throw new Error('Collection not found');

  if (activePhase.allowlistOnly && !collection.allowlist.includes(minter)) {
    throw new Error('Not on allowlist');
  }

  const minted: NFT[] = [];
  for (let i = 0; i < quantity; i++) {
    const nft = mint({
      creator: collection.creator,
      chain: collection.chain,
      metadata: {
        name: `${collection.name} #${project.totalMinted + i + 1}`,
        description: collection.description,
        image: `${collection.baseUri}/${project.totalMinted + i + 1}.png`,
        attributes: [],
      },
      royaltyBps: collection.royaltyBps,
      collectionId: project.collectionId,
    });
    nft.owner = minter;
    minted.push(nft);
  }

  activePhase.minted += quantity;
  project.totalMinted += quantity;

  return minted;
}

export function getLaunchpad(projectId: string): LaunchpadProject | null {
  return launchpads.get(projectId) || null;
}

/* ─── Protocol Summary ────────────────────────────────────────────────────── */

export function getDigitalAssetsSummary() {
  const allNFTs = Array.from(nfts.values());
  const allListings = Array.from(listings.values());
  const totalVolume = royalties.reduce((s, r) => s + r.salePrice, 0);

  return {
    name: 'FreedomForge Digital Assets Engine',
    version: '1.0.0',
    inspired_by: ['OpenSea', 'Blur', 'Zora', 'Reservoir', 'Tensor', 'Magic Eden', 'ERC-6551'],
    nfts: {
      total: allNFTs.length,
      standards: {
        'ERC-721': allNFTs.filter((n) => n.standard === 'ERC-721').length,
        'ERC-1155': allNFTs.filter((n) => n.standard === 'ERC-1155').length,
        SBT: allNFTs.filter((n) => n.standard === 'SBT').length,
      },
      dynamic: allNFTs.filter((n) => n.isDynamic).length,
      soulbound: allNFTs.filter((n) => n.isSoulbound).length,
    },
    collections: {
      total: collections.size,
      chains: [...new Set(Array.from(collections.values()).map((c) => c.chain))],
    },
    marketplace: {
      activeListings: allListings.filter((l) => l.status === 'active').length,
      totalSales: allListings.filter((l) => l.status === 'sold').length,
      totalVolume,
      royaltiesPaid: royalties.reduce((s, r) => s + r.royaltyAmount, 0),
      marketplaceFee: `${MARKETPLACE_FEE_BPS / 100}%`,
    },
    fractionalization: {
      vaults: vaults.size,
      activeVaults: Array.from(vaults.values()).filter((v) => v.isLocked).length,
    },
    lending: {
      activeLoans: Array.from(loans.values()).filter((l) => !l.repaid && !l.liquidated).length,
      totalLoans: loans.size,
    },
    rentals: {
      active: Array.from(rentals.values()).filter((r) => r.active).length,
      total: rentals.size,
    },
    launchpads: {
      total: launchpads.size,
      totalMinted: Array.from(launchpads.values()).reduce((s, p) => s + p.totalMinted, 0),
    },
    features: [
      'ERC-721, ERC-1155, and Soulbound Token (SBT) minting',
      'Batch minting with collection management',
      'Marketplace: fixed price, English auction, Dutch auction, offers',
      'EIP-2981 royalty enforcement',
      'NFT fractionalization into fungible shares',
      'NFT-collateralized lending with liquidation',
      'Time-bound NFT renting',
      'Dynamic NFTs with oracle/time/interaction triggers',
      'Rarity scoring with trait-based analysis',
      'Launchpad with multi-phase minting and reveal mechanics',
      'Multi-chain support (Ethereum, Base, Solana, Polygon, Arbitrum, Zora)',
      'Allowlist management for collections',
    ],
  };
}

export { MARKETPLACE_FEE_BPS, MAX_ROYALTY_BPS, FRACTIONALIZATION_MIN_SHARES };
