import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession } from '@/lib/auth/session';
import { executeTrade, type TradeOrder } from '@/lib/trading/engine';

export async function POST(request: Request) {
  try {
    const jar = await cookies();
    const token = jar.get('ff_session')?.value;
    if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const session = await verifySession(token);
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const body = await request.json();
    const { exchange, symbol, side, type, amount, price, stopLoss, takeProfit } = body;

    if (!exchange || !symbol || !side || !type || !amount) {
      return NextResponse.json({ error: 'Missing required fields: exchange, symbol, side, type, amount' }, { status: 400 });
    }

    if (!['coinbase', 'kraken'].includes(exchange)) {
      return NextResponse.json({ error: 'Exchange must be coinbase or kraken' }, { status: 400 });
    }

    if (!['buy', 'sell'].includes(side)) {
      return NextResponse.json({ error: 'Side must be buy or sell' }, { status: 400 });
    }

    const order: TradeOrder = {
      exchange, symbol, side, type,
      amount: Number(amount),
      price: price ? Number(price) : undefined,
      stopLoss: stopLoss ? Number(stopLoss) : undefined,
      takeProfit: takeProfit ? Number(takeProfit) : undefined,
    };

    const result = await executeTrade(order);
    return NextResponse.json({ status: 'ok', trade: result });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
