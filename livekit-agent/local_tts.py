"""
Local Piper TTS Plugin for LiveKit Agents 1.3.x
"""

import asyncio
import logging
import subprocess
import tempfile
import os

from livekit.agents import tts, APIConnectOptions

logger = logging.getLogger("local_tts")

VOICE_MODEL = os.path.expanduser("~/tony-agent/voices/en_GB-alan-medium.onnx")


class LocalPiperTTS(tts.TTS):
    """Local TTS using Piper"""

    def __init__(self, voice_model: str = VOICE_MODEL, sample_rate: int = 22050):
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=sample_rate,
            num_channels=1,
        )
        self.voice_model = voice_model

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = None,
    ) -> tts.ChunkedStream:
        return PiperSynthesizeStream(
            tts=self,
            input_text=text,
            conn_options=conn_options or APIConnectOptions(),
            voice_model=self.voice_model,
        )


class PiperSynthesizeStream(tts.ChunkedStream):
    def __init__(
        self,
        *,
        tts: LocalPiperTTS,
        input_text: str,
        conn_options: APIConnectOptions,
        voice_model: str,
    ):
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._voice_model = voice_model

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        """Generate audio using Piper TTS and emit via AudioEmitter."""
        text = self._input_text
        logger.info(f"Synthesizing: {text}")

        loop = asyncio.get_event_loop()
        audio_data = await loop.run_in_executor(None, self._synthesize, text)

        if audio_data:
            # For non-streaming TTS, initialize with stream=True to enable segments
            output_emitter.initialize(
                request_id="piper",
                sample_rate=22050,
                num_channels=1,
                mime_type="audio/pcm",
                stream=True,
            )
            output_emitter.start_segment(segment_id="segment_0")
            output_emitter.push(audio_data)
            output_emitter.end_segment()
            output_emitter.flush()
            logger.info(f"Emitted {len(audio_data)} bytes of audio")
        else:
            logger.error("No audio data generated")

    def _synthesize(self, text: str) -> bytes | None:
        """Run Piper TTS synchronously."""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            output_path = f.name

        try:
            piper_path = os.path.expanduser("~/tony-agent/venv/bin/piper")
            proc = subprocess.run(
                [piper_path, "--model", self._voice_model, "--output_file", output_path],
                input=text.encode(),
                capture_output=True,
                timeout=30
            )

            if proc.returncode != 0:
                logger.error(f"Piper error: {proc.stderr.decode()}")
                return None

            import wave
            with wave.open(output_path, "rb") as wav:
                audio = wav.readframes(wav.getnframes())
                logger.info(f"Generated {len(audio)} bytes of audio")
                return audio

        except Exception as e:
            logger.error(f"TTS error: {e}")
            return None
        finally:
            if os.path.exists(output_path):
                os.unlink(output_path)
