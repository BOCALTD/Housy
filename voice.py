import json, soundfile as sf, numpy as np
from kokoro import KPipeline
lines = json.load(open("script.json"))
pipe = KPipeline(lang_code="a")
out = {}
for voice in ["af_heart", "am_michael", "bm_george", "bf_emma"]:
    p = pipe if voice[0] == "a" else KPipeline(lang_code="b")
    out[voice] = {}
    import os; os.makedirs(f"out/{voice}", exist_ok=True)
    for lid, _, say in lines:
        parts, phon = [], []
        for gs, ps, audio in p(say, voice=voice, speed=1.0):
            parts.append(audio.numpy() if hasattr(audio, "numpy") else np.asarray(audio)); phon.append(ps)
        a = np.concatenate(parts)
        sf.write(f"out/{voice}/{lid}.wav", a, 24000)
        out[voice][lid] = {"seconds": round(len(a) / 24000, 3), "phonemes": " ".join(phon)}
        print(voice, lid, out[voice][lid])
json.dump(out, open("out/voice.json", "w"), indent=1, ensure_ascii=False)
