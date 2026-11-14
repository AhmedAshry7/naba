/** Prefer a child-sounding voice (e.g. Microsoft Ana), then bright young-sounding English voices. */
export function pickKidVoice(): SpeechSynthesisVoice | null {
  const vs = window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang))
  const prefs = [/ana/i, /jenny/i, /aria/i, /michelle|sonia|natasha/i, /google us english/i, /samantha|zira|female/i]
  for (const re of prefs) { const m = vs.find((v) => re.test(v.name)); if (m) return m }
  return vs[0] ?? null
}
