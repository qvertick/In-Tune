export class LatestAudio {
  private ring: Float32Array;
  private written = 0;
  private available = 0;
  private lastSent = 0;
  constructor(
    public readonly sampleRate: number,
    private streaming = false,
  ) {
    if (
      !Number.isFinite(sampleRate) ||
      sampleRate < 8000 ||
      sampleRate > 192000
    )
      throw new Error("Неподдерживаемая частота микрофона.");
    this.ring = new Float32Array(Math.ceil(sampleRate * 4));
  }
  append(samples: Float32Array, endFrame = this.written + samples.length) {
    if (endFrame - samples.length !== this.written) {
      this.written = endFrame - samples.length;
      this.available = 0;
      this.lastSent = this.written;
    }
    for (const sample of samples)
      this.ring[this.written++ % this.ring.length] = sample;
    this.available = Math.min(
      this.ring.length,
      this.available + samples.length,
    );
  }
  clear() {
    this.available = 0;
    this.lastSent = this.written;
  }
  take() {
    const length = this.streaming
      ? Math.min(
          Math.round(this.sampleRate),
          this.available,
          this.written - this.lastSent,
        )
      : Math.round(this.sampleRate * 3.2);
    if (
      this.available < length ||
      this.written - this.lastSent <
        this.sampleRate * (this.streaming ? 0.5 : 1.2) ||
      length < this.sampleRate * (this.streaming ? 0.5 : 0)
    )
      return null;
    const samples = new Float32Array(length);
    const start = this.written - length;
    for (let i = 0; i < length; i++)
      samples[i] = this.ring[(start + i) % this.ring.length];
    this.lastSent = this.written;
    return {
      samples,
      startSample: Math.round((start * 16000) / this.sampleRate),
    };
  }
  get bufferedSeconds() {
    return this.available / this.sampleRate;
  }
}

export async function resample(samples: Float32Array, sampleRate: number) {
  if (sampleRate === 16000) return samples;
  // OfflineAudioContext applies the browser's resampling filter, including anti-aliasing.
  const context = new OfflineAudioContext(
    1,
    Math.round((samples.length * 16000) / sampleRate),
    16000,
  );
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(new Float32Array(samples), 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  try {
    return new Float32Array((await context.startRendering()).getChannelData(0));
  } finally {
    source.disconnect();
  }
}

export function pcm16(samples: Float32Array) {
  const data = new ArrayBuffer(samples.length * 2);
  const view = new DataView(data);
  samples.forEach((value, index) => {
    const bounded = Math.max(
      -1,
      Math.min(1, Number.isFinite(value) ? value : 0),
    );
    view.setInt16(
      index * 2,
      Math.round(bounded * (bounded < 0 ? 32768 : 32767)),
      true,
    );
  });
  return data;
}
