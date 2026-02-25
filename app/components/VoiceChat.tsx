'use client';

import { useState } from 'react';
import { Mic, MicOff, Flame } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

export default function VoiceChat() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');

  const toggleVoice = async () => {
    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      toast.error("Voice works best in Safari!");
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = 'en-US';

    recognition.onresult = async (event: any) => {
      const text = event.results[0][0].transcript;
      setTranscript(text);
      setIsListening(false);

      toast.success("Max is thinking... 🔥");

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      const data = await res.json();
      setResponse(data.reply);

      const utterance = new SpeechSynthesisUtterance(data.reply);
      utterance.rate = 1.08;
      utterance.pitch = 1.1;
      window.speechSynthesis.speak(utterance);
    };

    recognition.start();
    setIsListening(true);
    toast("🎙️ Listening... Speak now, legend!");
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <motion.button
        onClick={toggleVoice}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className={`w-full py-20 rounded-3xl text-5xl font-bold flex items-center justify-center gap-8 shadow-2xl transition-all ${
          isListening 
            ? 'bg-red-600 animate-pulse' 
            : 'bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700'
        }`}
      >
        {isListening ? <MicOff className="w-16 h-16" /> : <Mic className="w-16 h-16" />}
        {isListening ? 'LISTENING...' : 'SPEAK TO MAX'}
      </motion.button>

      {transcript && <p className="mt-10 text-left text-orange-300 text-2xl">You said: “{transcript}”</p>}
      {response && <p className="mt-6 text-left text-white text-2xl leading-relaxed">Max says: {response}</p>}

      <div className="flex justify-center mt-12">
        <Flame className="w-12 h-12 text-orange-500 animate-pulse" />
      </div>
    </div>
  );
}