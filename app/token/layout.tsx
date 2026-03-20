import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '$FORGE Token — FreedomForge Utility & Governance Token',
  description:
    '$FORGE is the ERC-20 utility and governance token powering FreedomForge Max. Stake for premium AI access, earn weekly revenue share from autonomous trading, and govern the future of decentralized AI intelligence.',
  keywords: [
    '$FORGE token',
    'FreedomForge token',
    'AI utility token',
    'AI governance token',
    'ERC-20 AI token',
    'AI staking',
    'DeFi AI token',
    'autonomous AI token',
    'crypto AI trading token',
    'multi-model AI token',
    'AI revenue sharing',
    'prediction market token',
    'decentralized AI governance',
    'FORGE crypto',
  ],
  openGraph: {
    title: '$FORGE — The Token Powering Autonomous AI Intelligence',
    description:
      'Stake $FORGE for premium multi-model AI access, earn 20% of autonomous trading profits weekly, and govern the most comprehensive AI intelligence stack.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '$FORGE Token | FreedomForge Max',
    description:
      'Utility & governance token: premium AI access, revenue sharing, multi-chain deployment. 1B fixed supply.',
  },
};

export default function TokenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
