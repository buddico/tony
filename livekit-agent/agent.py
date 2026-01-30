"""
Tony - AI Voice Receptionist using LiveKit Agents
Fully Local: Whisper STT + Ollama LLM + Piper TTS
"""

import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from livekit.agents import JobContext, WorkerOptions, cli
from livekit.agents.voice import Agent, AgentSession
from livekit.plugins import openai as lk_openai
from livekit.plugins import silero

from local_stt import LocalWhisperSTT
from local_tts import LocalPiperTTS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tony")

SYSTEM_PROMPT = """You are Tony, the friendly AI receptionist for Stroud Green Medical Clinic.
Keep responses concise (1-2 sentences). Be warm and professional.
Never provide medical advice - direct medical questions to clinicians.
When the call starts, greet the caller warmly."""


async def entrypoint(ctx: JobContext):
    logger.info(f"Tony starting for room: {ctx.room.name}")

    # Initialize components
    stt = LocalWhisperSTT(model_size="base.en")
    llm = lk_openai.LLM(
        model="qwen2.5:7b",
        base_url="http://localhost:11434/v1",
        api_key="ollama",
    )
    tts = LocalPiperTTS()
    vad = silero.VAD.load()

    # Connect to the room
    await ctx.connect()

    # NEW API (LiveKit agents 1.3.x): Use AgentSession
    agent = Agent(instructions=SYSTEM_PROMPT)
    session = AgentSession(vad=vad, stt=stt, llm=llm, tts=tts)
    await session.start(agent, room=ctx.room)

    # Wait for session to be ready before greeting
    await asyncio.sleep(0.5)
    await session.say("Hello, Stroud Green Medical Clinic, Tony speaking. How may I help?")
    logger.info("Tony ready and greeting sent")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
