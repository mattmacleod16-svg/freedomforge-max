'use client';

import React from 'react';

export default function Home() {
  const [isListening, setIsListening] = React.useState(false);
  const [transcript, setTranscript] = React.useState('');
  const [response, setResponse] = React.useState('');
  const [textInput, setTextInput] = React.useState('');
  const recognitionRef = React.useRef<any>(null);

  // Shared function that processes any input (voice or text)
  const processInput = (text: string) => {
    setTranscript(text);

    const maxReply = `Hell yes legend! 🔥 I heard "${text}". This is your turning point — let’s forge something epic together! What do you want to crush next?`;
    setResponse(maxReply);

    // Speak the reply out loud
    const utterance = new SpeechSynthesisUtterance(maxReply);
    utterance.rate = 1.08;
    utterance.pitch = 1.1;
    window.speechSynthesis.speak(utterance);

    // Clear the text input after sending
    setTextInput('');
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
    </div>
  );
}