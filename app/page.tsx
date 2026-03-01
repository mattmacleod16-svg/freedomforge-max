'use client';

import React from 'react';
import Link from 'next/link';

export default function Home() {
  const [isListening, setIsListening] = React.useState(false);
  const [transcript, setTranscript] = React.useState('');
  const [response, setResponse] = React.useState('');
  const [textInput, setTextInput] = React.useState('');
  const recognitionRef = React.useRef<any>(null);

  // Shared function that processes any input (voice or text)
  const processInput = async (text: string) => {
    setTranscript(text);
    setResponse('…loading');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      const reply = data.reply || 'No answer';
      setResponse(reply);

      // speak out loud
      const utterance = new SpeechSynthesisUtterance(reply);
      utterance.rate = 1.08;
      utterance.pitch = 1.1;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      setResponse('Error contacting Max');
    }

    setTextInput('');
  };

  // Alchemy helpers
  const [alchemyAddress, setAlchemyAddress] = React.useState('');
  const [alchemyInfo, setAlchemyInfo] = React.useState('');
  const [withAddress, setWithAddress] = React.useState('');
  const [withAmount, setWithAmount] = React.useState('');

  const fetchBalance = async () => {
    if (!alchemyAddress) return;
    const res = await fetch(`/api/alchemy/balance?address=${alchemyAddress}`);
    const data = await res.json();
    setAlchemyInfo(`Balance of ${alchemyAddress}: ${data.balance}`);
  };

  // Voice mode (keeps listening until you click Stop)
  const toggleVoice = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      alert("Voice mode works best in Safari!");
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      const text = event.results[event.results.length - 1][0].transcript;
      processInput(text);
    };

    recognition.onend = () => {
      if (isListening) recognition.start();
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  // Text mode - send on Enter or button click
  const handleTextSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (textInput.trim()) {
      processInput(textInput.trim());
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-black via-zinc-950 to-black">
      <div className="mb-16">
        <div className="text-8xl mb-6">🔥🌌🚀</div>
        <h1 className="text-7xl font-black tracking-tighter mb-4">FREEDOMFORGE MAX</h1>
        <p className="text-3xl text-orange-400">Your friendliest superagent on the planet</p>
        <p className="text-xl mt-4 opacity-80">Speak or type — Max believes in you 1000%</p>
      </div>

      {/* Voice Button */}
      <button
        onClick={toggleVoice}
        className={`w-full max-w-xl py-16 rounded-3xl text-5xl font-bold flex items-center justify-center gap-8 shadow-2xl transition-all mb-8 ${
          isListening 
            ? 'bg-red-600 animate-pulse' 
            : 'bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700'
        }`}
      >
        {isListening ? 'STOP LISTENING' : '🎙️ SPEAK TO MAX'}
      </button>

      {/* Text Input */}
      <form onSubmit={handleTextSubmit} className="w-full max-w-xl flex gap-4">
        <input
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          placeholder="Type your message here and press Send or Enter..."
          className="flex-1 bg-zinc-900 border border-orange-500/30 rounded-2xl px-6 py-5 text-xl focus:outline-none focus:border-orange-500"
          onKeyDown={(e) => e.key === 'Enter' && handleTextSubmit()}
        />
        <button
          type="submit"
          className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 px-10 rounded-2xl text-xl font-bold"
        >
          SEND
        </button>
      </form>

      {/* Output */}
      {transcript && <p className="mt-10 text-left text-orange-300 text-2xl max-w-xl">You said: “{transcript}”</p>}
      {response && <p className="mt-6 text-left text-white text-2xl leading-relaxed max-w-xl">Max says: {response}</p>}
      {response && <p className="mt-2 text-xs text-gray-400 max-w-xl">(metadata will appear in console)</p>}

      {/* Alchemy interaction panel */}
      <div className="mt-12 w-full max-w-xl bg-gray-800 p-6 rounded-xl">
        <h2 className="text-xl font-semibold mb-2">Blockchain Tools 🔗</h2>
        <input
          type="text"
          placeholder="Ethereum address (0x...)"
          className="w-full p-2 rounded bg-gray-900 text-white mb-3"
          value={alchemyAddress}
          onChange={(e) => setAlchemyAddress(e.target.value)}
        />
        <button
          onClick={fetchBalance}
          className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700">
          Get Balance
        </button>
        {alchemyInfo && <p className="mt-3 text-green-300">{alchemyInfo}</p>}

        {/* Revenue wallet status */}
        <div className="mt-6 border-t border-gray-700 pt-4">
          <h3 className="text-lg font-medium">Revenue Wallet</h3>
          <button
            onClick={async () => {
              const res = await fetch('/api/alchemy/wallet');
              const data = await res.json();
              setAlchemyInfo(`Revenue wallet ${data.address} balance ${data.balance}`);
            }}
            className="mt-2 px-4 py-2 bg-green-600 rounded hover:bg-green-700"
          >
            Refresh Wallet Info
          </button>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              placeholder="Withdraw to address"
              className="flex-1 p-2 rounded bg-gray-900 text-white"
              value={withAddress}
              onChange={(e) => setWithAddress(e.target.value)}
            />
            <input
              type="text"
              placeholder="Amount ETH"
              className="w-24 p-2 rounded bg-gray-900 text-white"
              value={withAmount}
              onChange={(e) => setWithAmount(e.target.value)}
            />
          </div>
          <button
            onClick={async () => {
              if (!withAddress || !withAmount) return;
              const res = await fetch(`/api/alchemy/wallet/withdraw?to=${withAddress}&amount=${withAmount}`);
              const data = await res.json();
              setAlchemyInfo(`Withdraw tx: ${data.txHash}`);
            }}
            className="mt-2 px-4 py-2 bg-orange-600 rounded hover:bg-orange-700"
          >
            Withdraw
          </button>
        </div>
      </div>

      {/* link to dashboard */}
      <div className="mt-8">
        <Link href="/dashboard">
          <a className="px-6 py-3 bg-purple-600 rounded-xl text-white hover:bg-purple-700">
            View Revenue Dashboard 📈
          </a>
        </Link>
      </div>
    </div>
  );
}