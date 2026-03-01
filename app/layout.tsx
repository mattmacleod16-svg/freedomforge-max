import './globals.css';
import { Toaster } from 'sonner';
import { SpeedInsights } from '@vercel/speed-insights/next';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-black text-white">
        {children}
        <Toaster position="top-center" richColors />
        <SpeedInsights />
      </body>
    </html>
  );
}