import './globals.css';
import { Toaster } from 'sonner';
import type { Metadata, Viewport } from 'next';
import GlobalNav from './components/GlobalNav';
import { ErrorBoundary } from './components/ErrorBoundary';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://freedomforge.one';
const SITE_NAME = 'FreedomForge Max';
const SITE_DESCRIPTION =
  'Autonomous AI intelligence stack integrating 20+ AI providers, 50+ models, and multi-model consensus for prediction, trading, and on-chain operations. The future of decentralized autonomous intelligence.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Autonomous Intelligence Stack`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    'AI platform',
    'autonomous intelligence',
    'multi-model AI',
    'AI trading',
    'prediction market',
    'FreedomForge',
    'GPT-4',
    'Claude',
    'Gemini',
    'Grok',
    'Llama',
    'DeepSeek',
    'AI orchestrator',
    'decentralized AI',
    'blockchain AI',
    'machine learning',
    'AI consensus',
    'autonomous agent',
    'open source AI',
    'on-chain AI',
    'AI models',
    'multi-model',
    'AI infrastructure',
    'best AI app 2026',
    'AI finance app',
    'AI investment app',
    'AI portfolio manager',
    'on-device AI',
    'AI app store',
    'generative AI app',
    'AI crypto trading',
    'AI prediction market app',
    'Apple Foundation Models',
    'AI iOS app',
    'autonomous trading AI',
    'multi-model consensus AI',
    'AI market intelligence',
  ],
  authors: [{ name: 'FreedomForge Max' }],
  creator: 'FreedomForge Max',
  publisher: 'FreedomForge Max',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Every AI Model. One Platform.`,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: '/freedomforge-icon-1024.png',
        width: 1024,
        height: 1024,
        alt: 'FreedomForge Max — Autonomous Intelligence Stack',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — Autonomous Intelligence Stack`,
    description: SITE_DESCRIPTION,
    images: ['/freedomforge-icon-1024.png'],
    creator: '@FreedomForgeMax',
  },
  alternates: {
    canonical: SITE_URL,
  },
  category: 'technology',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#030108' },
    { media: '(prefers-color-scheme: light)', color: '#030108' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, iOS',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.9',
      ratingCount: '147',
    },
    featureList: [
      '20+ AI Model Providers',
      '50+ AI Models',
      'Multi-Model Consensus',
      'Autonomous Trading',
      'Prediction Markets',
      'On-Chain Operations',
      'Real-Time Intelligence',
      'Risk Management',
      'Portfolio Optimization',
      'Congressional Trade Tracking',
      'Mining Operations Monitor',
      'DePIN Network Validator',
      'AI Shopping Intelligence',
      'Patent Research',
      'Personal AI Genie',
      'Multi-Exchange Trading Engine',
      'ViaBTC Mining Integration',
    ],
  };

  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/freedomforge-icon-1024.png`,
    description: SITE_DESCRIPTION,
    sameAs: [],
  };

  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" href="/freedomforge-icon-192.png" type="image/png" />
        <link rel="apple-touch-icon" sizes="192x192" href="/freedomforge-icon-192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/freedomforge-icon-512.png" />
        <link rel="apple-touch-icon" sizes="1024x1024" href="/freedomforge-icon-1024.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="FreedomForge" />
        <meta name="mobile-web-app-capable" content="yes" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
      </head>
      <body className="min-h-screen bg-black text-white">
        <GlobalNav />
        <ErrorBoundary>{children}</ErrorBoundary>
        <Toaster position="top-center" richColors />
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{});}`,
          }}
        />
      </body>
    </html>
  );
}
