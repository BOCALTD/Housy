import json, os, numpy as np, soundfile as sf
from kokoro import KPipeline
lines = json.load(open("script.json"))
pipes = {"a": KPipeline(lang_code="a"), "b": KPipeline(lang_code="b")}
out = {}
for voice in ["af_heart", "am_michael", "bm_george", "bf_emma"]:
    p = pipes[voice[0]]
    out[voice] = {}
    os.makedirs(f"out/{voice}", exist_ok=True)
    for lid, _, say in lines:
        parts, phon, words, offset = [], [], [], 0.0
        for r in p(say, voice=voice, speed=1.0):
            a = r.audio.numpy() if hasattr(r.audio, "numpy") else np.asarray(r.audio)
            for t in (r.tokens or []):
                if t.start_ts is not None and t.end_ts is not None and t.text.strip():
                    words.append([t.text, round(offset + t.start_ts, 3), round(offset + t.end_ts, 3)])
            parts.append(a); phon.append(r.phonemes); offset += len(a) / 24000
        a = np.concatenate(parts)
        sf.write(f"out/{voice}/{lid}.wav", a, 24000)
        out[voice][lid] = {"seconds": round(len(a) / 24000, 3), "phonemes": " ".join(phon), "words": words}
        print(voice, lid, out[voice][lid]["seconds"], out[voice][lid]["phonemes"])
json.dump(out, open("out/voice.json", "w"), indent=1, ensure_ascii=False)
