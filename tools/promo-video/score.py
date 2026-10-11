"""宣传片配乐：用 numpy 现场合成，不依赖任何采样或版权音乐。

120 BPM（一小节 2 秒），D 大调。段落与画面一一对应：
  0–6s   开场：低沉的 Bm 铺底，碎片汇聚时噪声上扬
  6s     品牌出现：重击 + 和声落到 D
  8–44s  钢琴/钟琴琶音与铺底，12s 起加入低音和轻拍，每 6 秒一次过场呼吸
  41–44s 上行音效铺垫结尾
  44–52s 收尾和弦长音，自然衰减

用法：python3 score.py output.wav
"""
import sys
import wave

import numpy as np

SR = 48000
DURATION = 52.5
BAR = 2.0
N = int(SR * DURATION)
rng = np.random.default_rng(20261011)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def place(buf, sig, start, gain=1.0, pan=0.0):
    """Mix a mono or stereo signal into the stereo buffer at `start` seconds."""
    i = int(start * SR)
    if i >= N:
        return
    if sig.ndim == 1:
        left = np.sqrt(0.5 * (1 - pan))
        right = np.sqrt(0.5 * (1 + pan))
        sig = np.stack([sig * left, sig * right], axis=1) * np.sqrt(2)
    j = min(N, i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def spectral(sig, lo=None, hi=None, slope=6.0):
    """Gentle FFT band filter: smooth roll-off outside [lo, hi] Hz."""
    spec = np.fft.rfft(sig)
    f = np.fft.rfftfreq(len(sig), 1 / SR)
    w = np.ones_like(f)
    if hi:
        w *= 1 / np.sqrt(1 + (f / hi) ** (2 * slope / 6))
    if lo:
        w *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * slope / 6))
    return np.fft.irfft(spec * w, n=len(sig))


def envelope(n, attack, release, total):
    t = np.arange(n) / SR
    env = np.minimum(1, t / max(attack, 1e-4))
    env *= np.clip((total - t) / max(release, 1e-4), 0, 1)
    return env


# ---------- instruments ----------
def pad(notes, dur, attack=1.4, release=1.6, bright=0.32):
    """Warm additive pad: soft saw partials, three detuned voices per note."""
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in notes:
        f0 = midi(m)
        for detune in (-0.006, 0.0, 0.0055):
            f = f0 * (1 + detune)
            phase = rng.uniform(0, 2 * np.pi)
            for k in range(1, 9):
                if f * k > 9000:
                    break
                amp = (1 / k) * np.exp(-(k - 1) * (1 - bright) * 1.1)
                out += amp * np.sin(2 * np.pi * f * k * t + phase * k)
    # slow breathing of the upper partials
    out *= 1 + 0.08 * np.sin(2 * np.pi * 0.21 * t)
    out *= envelope(n, attack, release, dur + release)
    return out / (len(notes) * 3)


def bell(m, length=1.8, index=1.6):
    """Soft FM bell for the arpeggio."""
    n = int(length * SR)
    t = np.arange(n) / SR
    f = midi(m)
    mod = index * np.exp(-t / 0.12) * np.sin(2 * np.pi * f * 2.0 * t)
    sig = np.sin(2 * np.pi * f * t + mod) + 0.18 * np.sin(2 * np.pi * f * 3.0 * t) * np.exp(-t / 0.08)
    env = np.minimum(1, t / 0.004) * np.exp(-t / 0.42)
    return sig * env


def bass(m, dur):
    n = int((dur + 0.3) * SR)
    t = np.arange(n) / SR
    f = midi(m)
    sig = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t) + 0.08 * np.sin(2 * np.pi * 3 * f * t)
    return sig * envelope(n, 0.08, 0.3, dur + 0.3)


def thump(gain=1.0):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 52 + 70 * np.exp(-t / 0.03)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * np.exp(-t / 0.13) * np.minimum(1, t / 0.002) * gain


def tick():
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    noise = spectral(rng.standard_normal(n), lo=6000, hi=14000)
    return noise * np.exp(-t / 0.018)


def impact(length=4.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = 34 + 46 * np.exp(-t / 0.18)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 1.1)
    body = spectral(rng.standard_normal(n), hi=900) * np.exp(-t / 0.35) * 0.6
    air = spectral(rng.standard_normal(n), lo=2500, hi=9000) * np.exp(-t / 0.6) * 0.12
    return (sub + body + air) * np.minimum(1, t / 0.003)


def swell(length, lo=400, hi=7000, curve=3.0):
    """Reverse-cymbal style swell that ends exactly at `length`."""
    n = int(length * SR)
    t = np.arange(n) / SR
    noise = spectral(rng.standard_normal(n), lo=lo, hi=hi)
    return noise * (t / length) ** curve


def riser(length):
    n = int(length * SR)
    t = np.arange(n) / SR
    x = t / length
    f = 180 * 2 ** (2.6 * x)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.35 + np.sin(2 * np.pi * np.cumsum(f * 1.5) / SR) * 0.2
    noise = spectral(rng.standard_normal(n), lo=800, hi=9000) * 0.9
    trem = 0.75 + 0.25 * np.sin(2 * np.pi * np.cumsum(2 + 14 * x ** 2) / SR)
    return (tone + noise) * x ** 2.4 * trem


def reverb(sig, seconds=3.2, decay=2.6, hi=5200, mix=0.32):
    """Stereo convolution reverb with a synthetic decaying-noise impulse response."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(sig)
    for ch in range(2):
        ir = spectral(rng.standard_normal(n), lo=180, hi=hi) * np.exp(-6.9 * t / decay)
        ir[: int(0.012 * SR)] = 0
        ir /= np.sqrt(np.sum(ir**2))
        size = 1 << int(np.ceil(np.log2(len(sig) + n)))
        wet = np.fft.irfft(np.fft.rfft(sig[:, ch], size) * np.fft.rfft(ir, size), size)[: len(sig)]
        out[:, ch] = wet
    return sig * (1 - mix) + out * mix * 2.2


# ---------- arrangement ----------
dry = np.zeros((N, 2))      # bells, ticks: lightly reverberated
wash = np.zeros((N, 2))     # pads: lush reverb
hits = np.zeros((N, 2))     # impacts and swells: big reverb
low = np.zeros((N, 2))      # bass, thumps: no reverb

CHORDS = {
    "D": ([50, 57, 61, 64, 66], 38, [74, 69, 76, 78, 81, 76, 73, 69]),
    "Bm": ([47, 54, 57, 61, 62], 35, [71, 74, 78, 73, 76, 74, 71, 69]),
    "G": ([43, 55, 59, 62, 66, 69], 31, [71, 74, 79, 78, 74, 71, 69, 74]),
    "A": ([45, 57, 61, 64, 71], 33, [73, 76, 81, 76, 73, 71, 69, 76]),
}
PROGRESSION = ["D", "Bm", "G", "A"]

# intro: dark, unresolved
place(wash, pad([47, 54, 61, 62], 6.0, attack=2.6, release=1.2, bright=0.18), 0.0, 0.55)
place(wash, pad([35, 42], 6.0, attack=3.0, release=0.6, bright=0.1), 0.0, 0.35)
place(hits, swell(1.45, lo=300, hi=8000, curve=3.2), 4.55, 0.22)

# body: one chord per bar from the logo hit to the end card
bar_starts = np.arange(6.0, 44.0, BAR)
for b, start in enumerate(bar_starts):
    name = PROGRESSION[b % 4]
    voicing, root, arp = CHORDS[name]
    place(wash, pad(voicing, BAR, attack=0.5 if b else 0.05, release=1.4, bright=0.3 + 0.1 * (start > 24)), start, 0.5)
    if start >= 12:
        place(low, bass(root, BAR - 0.05), start, 0.15)
    # arpeggio: quarters while the logo settles, eighths through the features, held back before the finale riser
    if 8 <= start < 42:
        step = 0.5 if start < 12 else 0.25
        for i, when in enumerate(np.arange(start, start + BAR - 1e-6, step)):
            note = arp[i % len(arp)]
            accent = 1.0 if i % 4 == 0 else 0.72
            place(dry, bell(note), when, 0.14 * accent, pan=0.35 if i % 2 else -0.35)
            if start >= 24 and i % 4 == 2:
                place(dry, bell(note + 12, length=1.2, index=0.8), when + 0.125, 0.035, pan=0.6)
    elif 42 <= start < 44:
        for i, when in enumerate(np.arange(start, start + 1.5, 0.125)):
            place(dry, bell(arp[i % len(arp)] + (12 if i > 7 else 0), length=0.9), when, 0.07 + 0.04 * i / 12, pan=0.4 if i % 2 else -0.4)

# pulse: soft heartbeat on beats 1 and 3, airy ticks on the off-beats in the second half
for beat in np.arange(12.0, 42.0, 1.0):
    place(low, thump(), beat, 0.2)
for off in np.arange(24.25, 42.0, 0.5):
    place(dry, tick(), off, 0.05, pan=0.25)

# scene cuts: a breath before each new chapter
for cut in (12.0, 18.0, 24.0, 30.0, 36.0, 40.0):
    place(hits, swell(0.9, lo=600, hi=9000, curve=2.6), cut - 0.9, 0.09)

# big moments
place(hits, impact(5.0), 6.0, 0.7)
place(hits, riser(3.0), 41.0, 0.32)
place(hits, impact(6.0), 44.0, 0.8)

# finale chord: D add9 spread wide, ringing out
place(wash, pad([38, 50, 57, 62, 64, 66, 69, 74], 6.4, attack=0.05, release=2.2, bright=0.36), 44.0, 0.62)
for i, note in enumerate([74, 78, 81, 86, 88]):
    place(dry, bell(note, length=3.5, index=0.9), 44.0 + i * 0.32, 0.08, pan=-0.5 + i * 0.25)
place(low, bass(38, 4.0), 44.0, 0.18)

mix = reverb(dry, seconds=2.4, decay=2.0, mix=0.3)
mix += reverb(wash, seconds=4.0, decay=3.4, hi=4200, mix=0.45)
mix += reverb(hits, seconds=4.5, decay=3.8, hi=6000, mix=0.4)
mix += low
# keep the sub region clean: nothing useful lives below ~30 Hz on laptop or phone speakers
mix = np.stack([spectral(mix[:, ch], lo=32, slope=18) for ch in range(2)], axis=1)

# gentle bus compression: only the loudest peaks reach the soft knee; then fade the tail
mix /= np.max(np.abs(mix))
mix = np.tanh(mix * 1.2) / np.tanh(1.2)
t = np.arange(N) / SR
mix *= np.clip((DURATION - t) / 1.6, 0, 1)[:, None]
mix *= np.minimum(1, t / 0.05)[:, None]
mix /= np.max(np.abs(mix)) / 0.89

pcm = np.clip(mix + rng.uniform(-0.5, 0.5, mix.shape) / 32768, -1, 1)
pcm = (pcm * 32767).astype("<i2")
with wave.open(sys.argv[1] if len(sys.argv) > 1 else "score.wav", "wb") as out:
    out.setnchannels(2)
    out.setsampwidth(2)
    out.setframerate(SR)
    out.writeframes(pcm.tobytes())
