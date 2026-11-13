"""Generate the intro narration as natural-sounding MP3s using Microsoft's neural voices (edge-tts).

Setup (once):   pip install edge-tts
Run:            python scripts/make-voice.py            (makes all 8 clips)
                python scripts/make-voice.py --resume   (only the missing ones, after a network hiccup)
                python scripts/make-voice.py en-US-JennyNeural
Output:         public/intro/voice/cue-0.mp3 ... cue-7.mp3  (the intro picks them up automatically)

Only the eight public script lines below are sent to Microsoft's speech service.
Other good voices: en-US-AvaMultilingualNeural, en-US-AndrewNeural, en-US-EmmaNeural, en-GB-SoniaNeural
"""
import asyncio
import pathlib
import sys

import edge_tts

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
VOICE = ARGS[0] if ARGS else "en-US-AvaMultilingualNeural"
RATE = "+25%"  # speaking speed; raise for faster, lower for slower
RESUME = "--resume" in sys.argv  # only make clips that are missing

# What the captions show (kept in sync with src/intro/script.ts)
LINES = [
    "Earth is changing every day.",
    "Optical satellites watch it using light.",
    "But clouds block the light, and data is lost.",
    "NISAR changes that.",
    "NISAR, a NASA-ISRO radar satellite, sees through clouds.",
    "Its microwaves pass through clouds, day or night.",
    "It detects ground changes of just a few centimetres.",
    "This turns radar into Earth's news, before it breaks.",
]

# How the voice should SAY tricky words (spelled the way they sound). Edit here if a word still sounds off.
SAY = {
    "NASA-ISRO": "NASA and Iss-roh",
    "NISAR": "Nee-sar",
}


def spoken(text: str) -> str:
    for word, sound in SAY.items():
        text = text.replace(word, sound)
    return text


OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "intro" / "voice"


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    failed = []
    for i, text in enumerate(LINES):
        path = OUT / f"cue-{i}.mp3"
        if RESUME and path.exists() and path.stat().st_size > 1000:
            print("have ", path.name, "(skipping)")
            continue
        for attempt in range(1, 7):
            try:
                await asyncio.wait_for(edge_tts.Communicate(spoken(text), VOICE, rate=RATE).save(str(path)), timeout=25)
                print("saved", path.name, "-", text)
                break
            except Exception as e:  # network timeouts are common; wait and retry
                print(f"  {path.name} attempt {attempt}/6 failed ({type(e).__name__}); retrying...")
                path.unlink(missing_ok=True)
                await asyncio.sleep(2 * attempt)
        else:
            failed.append(path.name)
    print("\nAll done." if not failed else f"\nStill missing: {', '.join(failed)} - run: python scripts/make-voice.py --resume")


asyncio.run(main())
