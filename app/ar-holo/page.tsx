'use client';
import { useEffect, useRef, useState } from 'react';

export default function ARHoloExperience() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [session, setSession] = useState<any | null>(null);
  const hitTestSourceRef = useRef<any>(null);

  useEffect(() => {
    const initAR = async () => {
      if (!navigator.xr) return alert('WebXR AR not supported on this device');
      const xrSession = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'local-floor'],
        optionalFeatures: ['plane-detection']
      });
      setSession(xrSession);

      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) videoRef.current.srcObject = stream;

      const gl = canvasRef.current!.getContext('webgl2')!;
      const xrLayer = new (window as any).XRWebGLLayer(xrSession, gl);
      xrSession.updateRenderState({ baseLayer: xrLayer });

      const referenceSpace = await xrSession.requestReferenceSpace('local-floor');
      const hitTestSource = await xrSession.requestHitTestSource({ space: referenceSpace });
      hitTestSourceRef.current = hitTestSource;
    };
    initAR();
  }, []);

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
      <button 
        onClick={() => session?.end()} 
        className="holo-glass absolute bottom-8 left-1/2 -translate-x-1/2 px-10 py-5 text-2xl neon-magenta-text"
      >
        Exit AR Mode
      </button>
    </div>
  );
}
