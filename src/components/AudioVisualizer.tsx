import { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
  isSpeaking?: boolean;
  isConnecting?: boolean;
}

export function AudioVisualizer({ isActive, isSpeaking, isConnecting }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    let phase = 0;
    let dotPhase = 0;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Background
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, width, height);

      const centerY = height / 2;

      if (isConnecting) {
        // Pulsing dots animation for "Please hold"
        ctx.fillStyle = '#f59e0b'; // Amber color
        const numDots = 5;
        const dotSpacing = 30;
        const startX = (width - (numDots - 1) * dotSpacing) / 2;

        for (let i = 0; i < numDots; i++) {
          const delay = i * 0.3;
          const scale = 0.5 + 0.5 * Math.sin(dotPhase - delay);
          const radius = 6 * scale;
          ctx.beginPath();
          ctx.arc(startX + i * dotSpacing, centerY, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        dotPhase += 0.08;
      } else if (isActive) {
        // Animated waveform
        ctx.beginPath();
        ctx.strokeStyle = isSpeaking ? '#10b981' : '#3b82f6';
        ctx.lineWidth = 3;

        for (let x = 0; x < width; x++) {
          const frequency = isSpeaking ? 0.03 : 0.02;
          const amplitude = isSpeaking ? 25 : 15;
          const y =
            centerY +
            Math.sin(x * frequency + phase) * amplitude +
            Math.sin(x * frequency * 2 + phase * 1.5) * (amplitude * 0.5);

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.stroke();
        phase += 0.1;
      } else {
        // Flat line when inactive
        ctx.beginPath();
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2;
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isActive, isSpeaking, isConnecting]);

  const getStatusText = () => {
    if (isConnecting) return 'Please hold...';
    if (isActive) {
      return isSpeaking ? 'Tony is speaking...' : 'Listening...';
    }
    return 'Click Start to begin';
  };

  return (
    <div className="w-full bg-slate-100 rounded-lg p-4">
      <canvas
        ref={canvasRef}
        width={400}
        height={100}
        className="w-full"
        style={{ maxHeight: '100px' }}
      />
      <div className={`text-center text-sm mt-2 ${isConnecting ? 'text-amber-600 font-medium' : 'text-slate-500'}`}>
        {getStatusText()}
      </div>
    </div>
  );
}
