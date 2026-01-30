"""
Local Whisper STT Plugin for LiveKit Agents 1.3.x
"""

import asyncio
import logging
import numpy as np
from livekit.agents import stt, APIConnectOptions
from livekit.agents.stt import SpeechEvent, SpeechEventType, SpeechData
from livekit.agents.utils import AudioBuffer
from livekit import rtc
from faster_whisper import WhisperModel

logger = logging.getLogger("local_stt")


class LocalWhisperSTT(stt.STT):
    """Local Whisper STT using faster-whisper"""

    def __init__(
        self,
        model_size: str = "base.en",
        device: str = "cpu",
        compute_type: str = "int8",
        language: str = "en",
    ):
        super().__init__(
            capabilities=stt.STTCapabilities(streaming=False, interim_results=False)
        )
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.language = language
        self._model: WhisperModel | None = None

    def _ensure_model(self):
        if self._model is None:
            logger.info(f"Loading Whisper model: {self.model_size}")
            self._model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type
            )
            logger.info("Whisper model loaded")

    async def _recognize_impl(
        self,
        buffer: AudioBuffer,
        *,
        language: str | None = None,
        conn_options: APIConnectOptions = None,
    ) -> SpeechEvent:
        """Recognize speech from audio buffer."""
        self._ensure_model()

        # Handle both single frame and list of frames
        if isinstance(buffer, rtc.AudioFrame):
            frames = [buffer]
        else:
            frames = buffer

        if not frames:
            return SpeechEvent(
                type=SpeechEventType.FINAL_TRANSCRIPT,
                alternatives=[SpeechData(text="", language=self.language)],
            )

        # Combine all audio frames
        audio_bytes = b"".join([frame.data.tobytes() for frame in frames])
        audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        # Run transcription in executor to avoid blocking
        loop = asyncio.get_event_loop()
        segments, info = await loop.run_in_executor(
            None,
            lambda: self._model.transcribe(
                audio_np,
                language=language or self.language,
                beam_size=1,
                vad_filter=True,
            )
        )

        text = " ".join([seg.text for seg in segments]).strip()
        logger.info(f"Transcribed: {text}")

        return SpeechEvent(
            type=SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[SpeechData(text=text, language=info.language)],
        )
