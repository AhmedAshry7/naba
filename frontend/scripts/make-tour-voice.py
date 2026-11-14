"""Generate the guided tour's narration as MP3s with the same neural voice as the intro (edge-tts).

Run:   python scripts/make-tour-voice.py            (all clips)
       python scripts/make-tour-voice.py --resume   (only the missing ones)
Output: public/intro/tour/tour-<scene>-<line>.mp3   (the tour plays them automatically)

Keep LINES in sync with the cue texts in src/components/Tour.tsx. Only these public lines are sent
to Microsoft's speech service.
"""
import asyncio
import pathlib
import sys

import edge_tts

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
VOICE = ARGS[0] if ARGS else "en-US-AvaMultilingualNeural"  # same voice as make-voice.py
RATE = "+25%"
RESUME = "--resume" in sys.argv

LINES = {
    (0, 0): "Let's start with earthquakes. This is Panama.",
    (0, 1): "Here is the ground on 2 October, before.",
    (0, 2): "Then a magnitude 7.7 quake hit. The green shows the ground moved up to 1.2 metres.",
    (1, 0): "Next, floods. This is the Okavango Delta.",
    (1, 1): "In June, nearly half of it was open water, about 48 percent.",
    (1, 2): "By October, only 14 percent was left. The water is shrinking.",
    (2, 0): "Last, forest fires. This is Big Sur, in California.",
    (2, 1): "Before, the forest is untouched.",
    (2, 2): "Radar sees through smoke, and maps a burn scar of about 31 square kilometres.",
    (2, 3): "Now it's your turn to explore!",
}

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "intro" / "tour"


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    failed = []
    for (scene, n), text in LINES.items():
        path = OUT / f"tour-{scene}-{n}.mp3"
        if RESUME and path.exists() and path.stat().st_size > 1000:
            print("have ", path.name, "(skipping)")
            continue
        for attempt in range(1, 7):
            try:
                await asyncio.wait_for(edge_tts.Communicate(text, VOICE, rate=RATE).save(str(path)), timeout=25)
                print("saved", path.name, "-", text)
                break
            except Exception as e:
                print(f"  {path.name} attempt {attempt}/6 failed ({type(e).__name__}); retrying...")
                path.unlink(missing_ok=True)
                await asyncio.sleep(2 * attempt)
        else:
            failed.append(path.name)
    print("\nAll done." if not failed else f"\nStill missing: {', '.join(failed)} - run with --resume")


asyncio.run(main())
